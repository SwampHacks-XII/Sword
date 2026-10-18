import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { GameRules, PHYSICAL_SHOT_MS, createPoseSimulator, otherSlot, swordIdFor, type PlayerSlot, type Quat, type ServerMessage } from '@sword/protocol';
import type { PlayerStore } from '../db/players.js';
import type { GameStore } from './store.js';
import { ApiError } from './errors.js';
import { prepareQuest, type QuestGenerator } from '@sword/protocol';

/** Live sword poses older than this fall back to the keyboard animation. */
const LIVE_POSE_MS = 500;
const unit = z.number().min(-1.0001).max(1.0001);
/** How long a hit report can wait for its shot's "fired" message to arrive. */
const EARLY_HIT_MS = 2000;
/** The 1–255 token a physical sword puts in its IR signal. */
const token = z.number().int().min(1).max(255);
const poseSchema = z.object({ type: z.literal('sword.pose'), q: z.tuple([unit, unit, unit, unit]) }).strict();
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.auth'), ticket: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('room.subscribe'), matchId: z.uuid() }).strict(),
  z.object({ type: z.literal('match.start') }).strict(),
  z.object({ type: z.literal('match.rematch') }).strict(),
  z.object({ type: z.literal('quest.begin') }).strict(),
  z.object({ type: z.literal('quest.accept') }).strict(),
  z.object({ type: z.literal('spell.choose'), difficulty: z.enum(['easy', 'medium', 'hard']) }).strict(),
  z.object({ type: z.literal('player.heal') }).strict(),
  z.object({ type: z.literal('lobby.leave') }).strict(),
  z.object({ type: z.literal('device.check') }).strict(),
  z.object({ type: z.literal('dev.sword'), input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('button'), color: z.enum(['red', 'blue', 'green', 'yellow']) }).strict(),
    z.object({ kind: z.literal('gesture'), gesture: z.enum(['swing_left', 'swing_right', 'wrist_rotate', 'upright']) }).strict(),
    z.object({ kind: z.literal('trigger'), shot: token.optional() }).strict(),
  ]) }).strict(),
  z.object({ type: z.literal('sword.link'), connected: z.boolean(), number: z.union([z.literal(1), z.literal(2)]).optional() }).strict(),
  z.object({ type: z.literal('sword.hit'), shot: token }).strict(),
]);
type Snapshot = Awaited<ReturnType<GameStore['getMatch']>>;
interface Peer {
  ws: WebSocket; subject?: string; playerId?: string; slot?: PlayerSlot; room?: Room;
  sessionExpires: number; alive: boolean; count: number; rateSince: number; pending: number;
}
interface Room {
  id: string; snapshot: Snapshot; peers: Set<Peer>; rules: GameRules;
  poses: ReturnType<typeof createPoseSimulator>; livePoses: Partial<Record<PlayerSlot, { q: Quat; at: number }>>;
  /** Players with a physical sword; IR then decides hits against them. physicalShots: "<attacker slot>:<IR token>" -> shotId. */
  swords: Partial<Record<PlayerSlot, boolean>>; physicalShots: Map<string, string>;
  /** Hit reports that beat their own shot to the server (both travel sword -> browser -> server): key -> received at. */
  earlyHits: Map<string, number>;
  hostSubject?: string;
  disconnectDeadline: number | null; shot: number; closing: boolean; closeSubject: string;
  quest: Extract<ServerMessage, { type: 'quest.state' }>['quest'];
  briefing: ReturnType<typeof prepareQuest>; previousBriefings: string[];
}

/** A single backend process owns online practice matches; PostgreSQL keeps session history. */
export function createRealtimeHub(game: GameStore, players: PlayerStore, origin: string,
  options: { disconnectGraceMs?: number; generateStory?: QuestGenerator; storyWaitMs?: number } = {}) {
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
    room.briefing.dispose();
  }
  async function subscribe(peer: Peer, matchId: string) {
    if (peer.room && peer.room.id !== matchId) throw new ApiError(409, 'already_in_room', 'Leave your current room first.');
    const snapshot = await game.getMatch(peer.subject!, matchId);
    let room = rooms.get(matchId);
    if (!room) {
      if (snapshot.status !== 'waiting' || !snapshot.roomOpen) {
        throw new ApiError(409, 'session_unavailable', 'That battle is no longer available. Create a new room.');
      }
      if (rooms.size >= 100) throw new ApiError(503, 'rooms_full', 'The server is busy. Try again shortly.');
      const host = snapshot.players.find(p => p.slot === 1)!;
      const fresh: Room = {
        id: matchId, snapshot, peers: new Set(), rules: null!, poses: createPoseSimulator(), livePoses: {}, swords: {}, physicalShots: new Map(), earlyHits: new Map(),
        disconnectDeadline: null, shot: 0, closing: false, closeSubject: peer.subject!, quest: null,
        previousBriefings: [], briefing: prepareQuest({ roundNumber: snapshot.roundNumber, previousBriefings: [] }, options.generateStory, options.storyWaitMs),
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
    send(peer, { type: 'quest.state', quest: room.quest });
    send(peer, { type: 'room.ready' });
  }
  /**
   * Poses stream many times a second and never change the rules, so they skip the command queue
   * (a slow database call must not back them up). Outside battle they are dropped quietly.
   */
  function handlePose(peer: Peer, data: unknown): boolean {
    const pose = poseSchema.safeParse(data);
    if (!pose.success) return false;
    const room = peer.room;
    if (peer.subject && peer.slot && room && !room.closing && room.rules.snapshot()?.phase === 'fighting') {
      room.livePoses[peer.slot] = { q: pose.data.q, at: Date.now() };
    }
    return true;
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
    if (command.type === 'sword.link') {
      room.swords[peer.slot] = command.connected;
      room.rules.setPhysicalSword(peer.slot, command.connected ? command.number ?? null : null);
      const numbers = room.rules.lobby()?.players.map(p => p.physicalSword);
      // Each sword ignores IR carrying its own number, so matching numbers can never hit each other.
      if (command.connected && command.number && numbers?.filter(n => n === command.number).length === 2) {
        broadcast(room, { type: 'error', message: `Both players connected Sword ${command.number}. Flash one sword as SWORD_ID ${command.number === 1 ? 2 : 1} so they can hit each other.` });
      }
      return;
    }
    if (command.type === 'device.check') {
      send(peer, { type: 'error', message: 'Keyboard practice is ready. Physical sword and camera checks become available when hardware is connected.' });
      return;
    }
    if (command.type === 'quest.begin') {
      if (peer.slot !== 'p1') throw new ApiError(403, 'host_required', 'Only the host can begin the quest.');
      if (room.peers.size !== 2) throw new ApiError(409, 'players_disconnected', 'Both players must be connected to begin.');
      if (room.rules.snapshot() || room.quest) return;
      room.quest = { accepted: [], story: room.briefing.peek(), roundNumber: room.snapshot.roundNumber };
      const quest = room.quest;
      if (quest.story) room.previousBriefings = [...room.previousBriefings, quest.story.briefing].slice(-20);
      broadcast(room, { type: 'quest.state', quest: room.quest });
      // Model I/O must never block the command queue for this or any other room.
      if (!quest.story) void room.briefing.get().then(story => enqueue(async () => {
        if (stopping || room.closing || rooms.get(room.id) !== room || room.quest !== quest) return;
        quest.story = story;
        room.previousBriefings.push(story.briefing);
        room.previousBriefings = room.previousBriefings.slice(-20);
        broadcast(room, { type: 'quest.state', quest });
      }));
      return;
    }
    if (command.type === 'quest.accept') {
      if (!room.quest) return;
      if (!room.quest.story) throw new ApiError(409, 'story_preparing', 'Moss is finishing your quest. Try again in a moment.');
      if (room.peers.size !== 2) throw new ApiError(409, 'players_disconnected', 'Waiting for your fellow adventurer to reconnect.');
      if (!room.quest.accepted.includes(peer.slot)) room.quest.accepted.push(peer.slot);
      broadcast(room, { type: 'quest.state', quest: room.quest });
      if (room.quest.accepted.length === 2) {
        // Neither player enters combat until both have accepted the story briefing.
        try { room.snapshot = await game.startMatch(room.hostSubject!, room.id); }
        catch (error) {
          room.quest.accepted = room.quest.accepted.filter(slot => slot !== peer.slot);
          broadcast(room, { type: 'quest.state', quest: room.quest });
          throw error;
        }
        room.quest = null;
        broadcast(room, { type: 'quest.state', quest: null });
        room.rules.startMatch();
      }
      return;
    }
    if (command.type === 'match.start') {
      if (peer.slot !== 'p1') throw new ApiError(403, 'host_required', 'Only the host can start the battle.');
      if (room.peers.size !== 2) throw new ApiError(409, 'players_disconnected', 'Both players must be connected to start.');
      if (room.rules.snapshot()) return;
      if (room.quest) throw new ApiError(409, 'quest_pending', 'Both players must accept the quest first.');
      room.snapshot = await game.startMatch(peer.subject, room.id);
      room.rules.startMatch();
      return;
    }
    if (command.type === 'match.rematch') {
      if (room.peers.size !== 2) throw new ApiError(409, 'players_disconnected', 'Both players must be connected for a rematch.');
      if (!room.rules.snapshot() && room.snapshot.roundNumber > 1) return;
      if (room.rules.snapshot()?.phase !== 'over') throw new ApiError(409, 'round_not_finished', 'Finish this battle before requesting a rematch.');
      room.snapshot = await game.rematch(peer.subject, room.id);
      room.briefing.dispose();
      room.briefing = prepareQuest({ roundNumber: room.snapshot.roundNumber, previousBriefings: [...room.previousBriefings] }, options.generateStory, options.storyWaitMs);
      room.quest = null;
      broadcast(room, { type: 'quest.state', quest: null });
      room.poses = createPoseSimulator();
      room.livePoses = {};
      room.physicalShots.clear();
      room.earlyHits.clear();
      room.rules.returnToLobby();
      for (const slot of ['p1', 'p2'] as const) broadcast(room, { type: 'sword.pose', slot, q: [1, 0, 0, 0] });
      return;
    }
    if (room.peers.size !== 2) throw new ApiError(409, 'opponent_disconnected', 'Waiting for your opponent to reconnect.');
    room.rules.tick();
    const slot = peer.slot;
    const swordId = swordIdFor(slot);
    if (command.type === 'spell.choose') { room.rules.chooseSpell(slot, command.difficulty); return; }
    if (command.type === 'player.heal') { room.rules.heal(slot); return; }
    if (command.type === 'sword.hit') {
      // Reported by the victim's own sword, so a player can only ever report hits against themselves.
      const attacker = otherSlot(slot);
      const key = `${attacker}:${command.shot}`;
      const shotId = room.physicalShots.get(key);
      if (shotId) room.rules.handleSword({ type: 'sword.hit', attackerSwordId: swordIdFor(attacker), victimSwordId: swordId, shotId });
      else {
        // The attacker's "fired" message may still be on its way; the sword reports each shot only once.
        if (room.earlyHits.size > 50) room.earlyHits.clear();
        room.earlyHits.set(key, Date.now());
      }
      return;
    }
    if (command.input.kind === 'button') room.rules.handleSword({ type: 'sword.button', swordId, color: command.input.color });
    else if (command.input.kind === 'gesture') {
      room.poses.play(slot, command.input.gesture, Date.now());
      room.rules.handleSword({ type: 'sword.gesture', swordId, gesture: command.input.gesture });
    } else {
      const shotId = `${room.id}:${++room.shot}`;
      // A physical shot against a player with a sword lands only when that sword reports the IR.
      const realIr = command.input.shot !== undefined && !!room.swords[otherSlot(slot)];
      const key = `${slot}:${command.input.shot}`;
      if (realIr) room.physicalShots.set(key, shotId);
      const result = room.rules.handleSword({ type: 'sword.trigger', swordId, shotId, ...(realIr ? { ttlMs: PHYSICAL_SHOT_MS } : {}) });
      const early = room.earlyHits.get(key);
      room.earlyHits.delete(key);
      if (result === 'fired' && realIr && early !== undefined && Date.now() - early <= EARLY_HIT_MS) {
        room.rules.handleSword({ type: 'sword.hit', attackerSwordId: swordId, victimSwordId: swordIdFor(otherSlot(slot)), shotId });
      } else if (result === 'fired' && !realIr) {
        // Otherwise (keyboard practice, or an opponent without a sword) the hit is simulated.
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
      if (handlePose(peer, data)) return;
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
        room.swords[peer.slot!] = false; // A reconnecting browser announces its sword again.
        room.rules.setPhysicalSword(peer.slot!, null);
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
        for (const slot of ['p1', 'p2'] as const) {
          const live = room.livePoses[slot];
          const q = live && now - live.at < LIVE_POSE_MS ? live.q : room.poses.sample(slot, now);
          broadcast(room, { type: 'sword.pose', slot, q });
        }
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
      for (const room of rooms.values()) room.briefing.dispose();
      rooms.clear();
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}
export type RealtimeHub = ReturnType<typeof createRealtimeHub>;
