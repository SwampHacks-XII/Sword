import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { GameRules, createPoseSimulator, otherSlot, swordIdFor, type PlayerSlot, type ServerMessage } from '@sword/protocol';
import type { PlayerStore } from '../db/players.js';
import type { GameStore } from './store.js';
import { ApiError } from './errors.js';

const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.auth'), ticket: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('room.subscribe'), matchId: z.uuid() }).strict(),
  z.object({ type: z.literal('match.start') }).strict(),
  z.object({ type: z.literal('lobby.leave') }).strict(),
  z.object({ type: z.literal('device.check') }).strict(),
  z.object({ type: z.literal('dev.sword'), input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('button'), color: z.enum(['red', 'blue', 'green', 'yellow']) }).strict(),
    z.object({ kind: z.literal('gesture'), gesture: z.enum(['swing_left', 'swing_right', 'wrist_rotate', 'upright']) }).strict(),
    z.object({ kind: z.literal('trigger') }).strict(),
  ]) }).strict(),
]);
type Snapshot = Awaited<ReturnType<GameStore['getMatch']>>;
interface Peer {
  ws: WebSocket; subject?: string; playerId?: string; slot?: PlayerSlot; room?: Room;
  sessionExpires: number; alive: boolean; count: number; rateSince: number; pending: number;
}
interface Room {
  id: string; snapshot: Snapshot; peers: Set<Peer>; rules: GameRules;
  poses: ReturnType<typeof createPoseSimulator>; hostSubject?: string;
  disconnectDeadline: number | null; shot: number; closing: boolean; closeSubject: string;
}

/** A single backend process owns online practice matches; PostgreSQL keeps session history. */
export function createRealtimeHub(game: GameStore, players: PlayerStore, origin: string,
  options: { disconnectGraceMs?: number } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const tickets = new Map<string, { subject: string; expires: number; sessionExpires: number }>();
  const peers = new Set<Peer>();
  const rooms = new Map<string, Room>();
  let tail = Promise.resolve();
  let stopping = false;
  let lastHeartbeat = Date.now();

  function send(peer: Peer, message: ServerMessage | { type: 'session.ready' | 'room.ready' }) {
    if (peer.ws.readyState !== WebSocket.OPEN) return;
    if (peer.ws.bufferedAmount > 256 * 1024) { peer.ws.terminate(); return; }
    peer.ws.send(JSON.stringify(message));
  }
  function enqueue(run: () => Promise<void>) {
    const task = tail.then(run);
    tail = task.catch(() => { /* Per-command handlers return safe errors. */ });
    return task;
  }
  function safeError(peer: Peer, error: unknown) {
    send(peer, { type: 'error', message: error instanceof ApiError ? error.message : 'The server could not complete that action. Please try again.' });
  }
  function broadcast(room: Room, message: ServerMessage) {
    for (const peer of room.peers) {
      if (message.type === 'lobby.state' && message.lobby) {
        send(peer, { type: 'lobby.state', lobby: { ...message.lobby, you: peer.slot!, mode: 'online' } });
      } else send(peer, message);
    }
    if (message.type === 'match.state' && message.match?.phase === 'over' && room.hostSubject) {
      const winner = room.snapshot.players.find(p => `p${p.slot}` === message.match!.winner)?.playerId;
      enqueue(async () => {
        try { room.snapshot = await game.finishMatch(room.hostSubject!, room.id, winner); }
        catch { broadcast(room, { type: 'error', message: 'The battle ended, but saving the result failed. Return to the menu and check the database connection.' }); }
      });
    }
  }
  async function closeRoom(room: Room, subject: string, message: string) {
    if (room.closing) return;
    room.closing = true;
    try { await game.closeMatch(subject, room.id); }
    catch (error) { room.closing = false; throw error; }
    broadcast(room, { type: 'room.closed', message });
    for (const peer of room.peers) { peer.room = undefined; peer.slot = undefined; }
    room.peers.clear();
    rooms.delete(room.id);
  }
  async function subscribe(peer: Peer, matchId: string) {
    if (peer.room && peer.room.id !== matchId) throw new ApiError(409, 'already_in_room', 'Leave your current room first.');
    const snapshot = await game.getMatch(peer.subject!, matchId);
    let room = rooms.get(matchId);
    if (!room) {
      if (snapshot.status !== 'waiting') {
        throw new ApiError(409, 'session_unavailable', 'That battle is no longer available. Create a new room.');
      }
      if (rooms.size >= 100) throw new ApiError(503, 'rooms_full', 'The server is busy. Try again shortly.');
      const host = snapshot.players.find(p => p.slot === 1)!;
      const fresh: Room = {
        id: matchId, snapshot, peers: new Set(), rules: null!, poses: createPoseSimulator(),
        disconnectDeadline: null, shot: 0, closing: false, closeSubject: peer.subject!,
      };
      fresh.rules = new GameRules(message => broadcast(fresh, message));
      fresh.rules.openLobby(snapshot.joinCode, 'p1', host.displayName);
      room = fresh;
      rooms.set(matchId, room);
    }
    if (room.closing) throw new ApiError(409, 'room_closing', 'That room is closing. Create a new room.');
    const member = snapshot.players.find(p => p.playerId === peer.playerId)!;
    if ([...room.peers].some(p => p !== peer && p.playerId === peer.playerId)) {
      throw new ApiError(409, 'already_connected', 'This account is already in the room. Use a different account for player 2.');
    }
    room.snapshot = snapshot;
    peer.slot = `p${member.slot}` as PlayerSlot;
    peer.room = room;
    room.peers.add(peer);
    if (member.slot === 1) room.hostSubject = peer.subject;
    for (const player of snapshot.players) {
      const slot = `p${player.slot}` as PlayerSlot;
      room.rules.addPlayer(slot, player.displayName);
      room.rules.setConnected(slot, [...room.peers].some(p => p.slot === slot));
    }
    if (room.peers.size === 2) room.disconnectDeadline = null;
    send(peer, { type: 'match.state', match: room.rules.snapshot() });
    send(peer, { type: 'room.ready' });
  }
  async function handle(peer: Peer, data: unknown) {
    const parsed = commandSchema.safeParse(data);
    if (!parsed.success) throw new ApiError(400, 'invalid_message', 'Invalid game message.');
    const command = parsed.data;
    if (!peer.subject) {
      if (command.type !== 'session.auth') { peer.ws.close(1008, 'Authentication required'); return; }
      const ticket = tickets.get(command.ticket);
      tickets.delete(command.ticket);
      if (!ticket || ticket.expires < Date.now()) { peer.ws.close(1008, 'Ticket expired or invalid'); return; }
      const player = await players.find(ticket.subject);
      if (!player) { peer.ws.close(1008, 'Create your profile first'); return; }
      peer.subject = ticket.subject;
      peer.playerId = player.id;
      peer.sessionExpires = ticket.sessionExpires;
      send(peer, { type: 'session.ready' });
      return;
    }
    if (command.type === 'session.auth') throw new ApiError(400, 'already_authenticated', 'Already authenticated.');
    if (command.type === 'room.subscribe') { await subscribe(peer, command.matchId); return; }
    const room = peer.room;
    if (!room || !peer.slot) throw new ApiError(409, 'room_required', 'Join a room first.');
    if (command.type === 'lobby.leave') { await closeRoom(room, peer.subject, 'A player left the room. You can create or join another game.'); return; }
    if (room.closing) return;
    if (command.type === 'device.check') {
      send(peer, { type: 'error', message: 'Keyboard practice is ready. Physical sword and camera checks become available when hardware is connected.' });
      return;
    }
    if (command.type === 'match.start') {
      if (peer.slot !== 'p1') throw new ApiError(403, 'host_required', 'Only the host can start the battle.');
      if (room.peers.size !== 2) throw new ApiError(409, 'players_disconnected', 'Both players must be connected to start.');
      if (room.rules.snapshot()) return;
      room.snapshot = await game.startMatch(peer.subject, room.id);
      room.rules.startMatch();
      return;
    }
    if (room.peers.size !== 2) throw new ApiError(409, 'opponent_disconnected', 'Waiting for your opponent to reconnect.');
    room.rules.tick();
    const slot = peer.slot;
    const swordId = swordIdFor(slot);
    if (command.input.kind === 'button') room.rules.handleSword({ type: 'sword.button', swordId, color: command.input.color });
    else if (command.input.kind === 'gesture') {
      room.poses.play(slot, command.input.gesture, Date.now());
      room.rules.handleSword({ type: 'sword.gesture', swordId, gesture: command.input.gesture });
    } else {
      const shotId = `${room.id}:${++room.shot}`;
      if (room.rules.handleSword({ type: 'sword.trigger', swordId, shotId }) === 'fired') {
        // Online keyboard practice simulates a receiver hit. Real IR reports need device authentication.
        room.rules.handleSword({ type: 'sword.hit', attackerSwordId: swordId, victimSwordId: swordIdFor(otherSlot(slot)), shotId });
      }
    }
  }

  wss.on('connection', ws => {
    const peer: Peer = { ws, sessionExpires: Date.now() + 5000, alive: true, count: 0, rateSince: Date.now(), pending: 0 };
    peers.add(peer);
    ws.on('pong', () => { peer.alive = true; });
    ws.on('error', () => { /* Never log credentials or message payloads. */ });
    ws.on('message', (raw, binary) => {
      if (Date.now() - peer.rateSince > 1000) { peer.count = 0; peer.rateSince = Date.now(); }
      if (binary || ++peer.count > 100 || peer.pending >= 20) { ws.close(1008, 'Too many or invalid messages'); return; }
      let data: unknown;
      try { data = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      peer.pending++;
      enqueue(async () => {
        try { if (ws.readyState === WebSocket.OPEN) await handle(peer, data); }
        catch (error) { safeError(peer, error); }
        finally { peer.pending--; }
      });
    });
    ws.on('close', () => {
      peers.delete(peer);
      enqueue(async () => {
        const room = peer.room;
        if (!room) return;
        room.peers.delete(peer);
        room.rules.setConnected(peer.slot!, false);
        room.disconnectDeadline ??= Date.now() + (options.disconnectGraceMs ?? 30_000);
      });
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of tickets) if (value.expires < now) tickets.delete(key);
    for (const peer of peers) {
      if (peer.sessionExpires < now) peer.ws.close(peer.subject ? 4001 : 1008, 'Session expired');
      if (now - lastHeartbeat > 20_000) {
        if (!peer.alive) peer.ws.terminate();
        else { peer.alive = false; peer.ws.ping(); }
      }
    }
    if (now - lastHeartbeat > 20_000) lastHeartbeat = now;
    for (const room of rooms.values()) {
      if (room.closing) continue;
      if (room.disconnectDeadline && room.disconnectDeadline < now) {
        room.disconnectDeadline = now + 5000;
        const subject = room.hostSubject ?? room.closeSubject;
        if (subject) enqueue(async () => {
          try { await closeRoom(room, subject, 'The connection was lost. Create a new room to play again.'); }
          catch { broadcast(room, { type: 'error', message: 'Could not close the disconnected session. Checking again shortly.' }); }
        });
      }
      if (room.peers.size === 2) room.rules.tick();
      if (room.rules.snapshot()?.phase === 'fighting') {
        for (const slot of ['p1', 'p2'] as const) broadcast(room, { type: 'sword.pose', slot, q: room.poses.sample(slot, now) });
      }
    }
  }, 33);
  timer.unref();

  return {
    leave(subject: string, matchId: string) {
      return enqueue(async () => {
        await game.getMatch(subject, matchId);
        const room = rooms.get(matchId);
        if (room) await closeRoom(room, subject, 'A player left the room. You can create or join another game.');
        else await game.closeMatch(subject, matchId);
      });
    },
    async issueTicket(subject: string, accessTokenExpires: number) {
      if (!await players.find(subject)) throw new ApiError(409, 'profile_required', 'Save your player name first.');
      if (tickets.size >= 1000) throw new ApiError(503, 'busy', 'The server is busy. Try again shortly.');
      const ticket = randomBytes(32).toString('hex');
      tickets.set(ticket, { subject, expires: Date.now() + 30_000,
        sessionExpires: Math.min(Number.isFinite(accessTokenExpires) ? accessTokenExpires : Infinity, Date.now() + 15 * 60_000) });
      return { ticket };
    },
    attach(server: Server) {
      server.on('upgrade', (request, socket, head) => {
        if (stopping || request.url !== '/realtime' || request.headers.origin !== origin || wss.clients.size >= 100) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
        }
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
      });
    },
    async close() {
      stopping = true;
      clearInterval(timer);
      tickets.clear();
      for (const peer of peers) peer.ws.terminate();
      await tail;
      rooms.clear();
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}
export type RealtimeHub = ReturnType<typeof createRealtimeHub>;
