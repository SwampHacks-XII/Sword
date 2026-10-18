import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer, request as httpsRequest } from 'node:https';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createPlayerStore } from '../src/db/players.js';
import { createGameStore } from '../src/game/store.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { createRealtimeHub, type RealtimeHub } from '../src/game/realtime.js';
import { WebSocket } from 'ws';
import { getSpell, isQuestStory, type MatchState, type ServerMessage, type QuestGenerator } from '@sword/protocol';

const live = process.env.GAME_TEST_DATABASE === '1';
const hosted = Boolean(process.env.GAME_TEST_CERT);
let testCa: Buffer;
let origin = 'http://localhost:5173';
let pool: Pool;
let admin: Pool | undefined;
let schema: string;
let issuerServer: Server;
let apiServer: Server;
let realtime: RealtimeHub;
const sockets = new Set<WebSocket>();
let base: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let storyCalls = 0;
let holdStory = false;
let releaseStory: (() => void) | undefined;
const generateStory: QuestGenerator = async ({ roundNumber }) => {
  storyCalls++;
  if (holdStory) await new Promise<void>(resolve => { releaseStory = resolve; });
  await new Promise(resolve => setTimeout(resolve, 20));
  return { title: 'Mischief in the meadow', briefing: `Your evil twin has enchanted ${roundNumber} chickens to sing at midnight. Stop them before the sleepy village runs out of pillows!`, source: 'gemini' };
};

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `${hosted && server === apiServer ? 'https' : 'http'}://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function testFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!url.startsWith('https:')) return fetch(url, init);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { ca: testCa, method: init.method, headers: init.headers as Record<string, string> }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode,
        headers: response.headers as Record<string, string> })));
    });
    request.on('error', reject);
    request.end(init.body as string | undefined);
  });
}
async function close(server?: Server) {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}
async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await testFetch(`${base}/api${path}`, {
    method, headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function matchPair() {
  const created = await call('alice', 'POST', '/matches', {});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match(created.data.match.joinCode, /^\d{4}$/);
  const joined = await call('bob', 'POST', '/matches/join', { joinCode: created.data.match.joinCode });
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  return created.data.match.id as string;
}
async function sword(user: string, matchId: string) {
  const created = await call(user, 'POST', '/swords', { deviceId: `test-${randomUUID()}`, label: 'Test sword' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.sword.id as string;
  const assigned = await call(user, 'PUT', `/matches/${matchId}/sword`, { swordId: id });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  return id;
}
function sample() {
  return { sampleId: randomUUID(), capturedAt: new Date().toISOString(), orientation: [0, 0, 0, 1],
    acceleration: [0, 9.81, 0], angularVelocity: [0, 0, 0], deviceTimeMs: 100,
    coordinateFrame: 'sword-y-up' };
}

before(async () => {
  if (live) {
    await import('dotenv/config');
    if (!process.env.DATABASE_URL) throw new Error('Live database tests need local DATABASE_URL configuration.');
    schema = `sword_test_${randomBytes(8).toString('hex')}`;
    admin = createPool(process.env.DATABASE_URL);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(process.env.DATABASE_URL);
    pool.options.options = `-c search_path=${schema},public`;
    await migrate(pool);
  } else {
    const database = newDb();
    for (const file of ['001_players.sql', '002_game_storage.sql', '004_rematches_and_room_codes.sql']) {
      database.public.none(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    }
    pool = new (database.adapters.createPg().Pool)() as unknown as Pool;
  }
  const keys = await generateKeyPair('RS256');
  const key = { ...await exportJWK(keys.publicKey), kid: 'game-test', alg: 'RS256', use: 'sig' };
  let issuer: string;
  issuerServer = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/.well-known/openid-configuration') response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}jwks` }));
    else if (request.url === '/jwks') response.end(JSON.stringify({ keys: [key] }));
    else { response.statusCode = 404; response.end('{}'); }
  });
  issuer = `${await listen(issuerServer)}/`;
  const players = createPlayerStore(pool);
  const game = createGameStore(pool);
  // Reserve an ephemeral port before configuring the same-origin hosted application.
  const reservation = createServer();
  const reservedUrl = await listen(reservation);
  const port = (reservation.address() as AddressInfo).port;
  await close(reservation);
  origin = hosted ? reservedUrl.replace('http:', 'https:') : 'http://localhost:5173';
  realtime = createRealtimeHub(game, players, origin, { disconnectGraceMs: 2000, generateStory });
  const app = createApp({ host: '127.0.0.1', port, webOrigin: origin, serveWeb: hosted,
    auth0: { issuerBaseURL: issuer, audience: 'https://sword-api' }, databaseUrl: null }, players, game, realtime, generateStory);
  if (hosted) {
    testCa = await readFile(process.env.GAME_TEST_CERT!);
    apiServer = createSecureServer({ cert: testCa, key: await readFile(process.env.GAME_TEST_KEY!) }, app);
  } else apiServer = createServer(app);
  realtime.attach(apiServer);
  apiServer.listen(port, '127.0.0.1'); await once(apiServer, 'listening');
  base = hosted ? origin : reservedUrl;
  for (const user of ['alice', 'bob', 'carol', 'no-profile']) {
    tokens[user] = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'game-test' })
      .setIssuer(issuer).setAudience('https://sword-api').setSubject(`test|${user}`).setIssuedAt().setExpirationTime('10m').sign(keys.privateKey);
    if (user !== 'no-profile') {
      const profile = await call(user, 'PUT', '/me', { displayName: user });
      assert.equal(profile.status, 200);
      ids[user] = profile.data.player.id;
    }
  }
});
after(async () => {
  for (const socket of sockets) socket.terminate();
  await realtime?.close();
  await close(apiServer); await close(issuerServer);
  if (pool) await pool.end();
  if (admin) {
    try {
      if (!/^sword_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unexpected test schema; cleanup refused.');
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally { await admin.end(); }
  }
});

type WireMessage = ServerMessage | { type: 'session.ready' } | { type: 'room.ready' };
async function socketClient(user: string, matchId?: string, suppliedTicket?: string) {
  const ticket = suppliedTicket ?? (await call(user, 'POST', '/realtime-ticket')).data.ticket;
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime`, { origin, ...(hosted ? { ca: testCa } : {}) });
  sockets.add(ws);
  ws.on('error', () => {});
  ws.on('close', () => sockets.delete(ws));
  const messages: WireMessage[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const wait = (predicate: (message: WireMessage) => boolean, from = 0) => new Promise<WireMessage>((resolve, reject) => {
    const existing = messages.slice(from).find(predicate);
    if (existing) { resolve(existing); return; }
    const timer = setTimeout(() => { ws.off('message', check); reject(new Error('Expected game message was not received.')); }, 10_000);
    function check() {
      const found = messages.slice(from).find(predicate);
      if (found) { clearTimeout(timer); ws.off('message', check); resolve(found); }
    }
    ws.on('message', check);
  });
  const send = (message: unknown) => ws.send(JSON.stringify(message));
  await once(ws, 'open');
  send({ type: 'session.auth', ticket });
  if (!suppliedTicket) {
    await wait(m => m.type === 'session.ready');
    if (matchId) { send({ type: 'room.subscribe', matchId }); await wait(m => m.type === 'room.ready'); }
  }
  return { ws, messages, wait, send,
    latestMatch: (): MatchState | undefined => {
      const latest = [...messages].reverse().find(m => m.type === 'match.state' && m.match);
      return latest?.type === 'match.state' ? latest.match ?? undefined : undefined;
    },
  };
}

test('live tickets require authentication, are single-use, and cannot reveal another room', async () => {
  assert.equal((await testFetch(`${base}/api/realtime-ticket`, { method: 'POST' })).status, 401);
  assert.equal((await call('no-profile', 'POST', '/realtime-ticket')).status, 409);
  const ticket = (await call('alice', 'POST', '/realtime-ticket')).data.ticket;
  const first = await socketClient('alice', undefined, ticket);
  await first.wait(m => m.type === 'session.ready');
  const second = await socketClient('alice', undefined, ticket);
  const [code] = await once(second.ws, 'close');
  assert.equal(code, 1008);
  first.ws.close();
  const matchId = await matchPair();
  const outsider = await socketClient('carol');
  outsider.send({ type: 'room.subscribe', matchId });
  const denied = await outsider.wait(m => m.type === 'error');
  assert.equal(denied.type === 'error' && denied.message, 'Match not found for this player.');
  assert.equal(outsider.messages.some(m => m.type === 'lobby.state'), false);
  outsider.ws.close();
});

test('online combat saves its winner; rematch returns both players to the same lobby with history intact', async () => {
  const matchId = await matchPair();
  const original = (await call('alice', 'GET', `/matches/${matchId}`)).data.match;
  const assignedSword = await sword('alice', matchId);
  const a = await socketClient('alice', matchId);
  const b = await socketClient('bob', matchId);
  try {
    await a.wait(m => m.type === 'lobby.state' && m.lobby?.players.filter(p => p.connected).length === 2);
    assert.equal(a.messages.some(m => m.type === 'lobby.state' && m.lobby?.players.some(p => p.name === 'Swamp Bot')), false);
    b.send({ type: 'match.start' });
    await b.wait(m => m.type === 'error' && m.message.includes('host'));
    a.send({ type: 'quest.begin' });
    const firstQuest = await a.wait(m => m.type === 'quest.state' && !!m.quest?.story);
    const firstStory = firstQuest.type === 'quest.state' ? firstQuest.quest!.story! : null!;
    assert.equal(isQuestStory(firstStory), true);
    a.send({ type: 'quest.accept' }); b.send({ type: 'quest.accept' });
    await a.wait(m => m.type === 'match.state' && m.match?.phase === 'fighting');
    await b.wait(m => m.type === 'match.state' && m.match?.phase === 'fighting');
    assert.deepEqual(a.latestMatch(), b.latestMatch());
    // A USB sword's pose reaches both players in place of the keyboard animation; bad poses are rejected.
    a.send({ type: 'sword.pose', q: [0.5, 0.5, 0.5, 0.5] });
    await b.wait(m => m.type === 'sword.pose' && m.slot === 'p1' && m.q.every(n => n === 0.5));
    const poseFrom = a.messages.length;
    a.send({ type: 'sword.pose', q: [2, 0, 0, 0] });
    await a.wait(m => m.type === 'error' && m.message === 'Invalid game message.', poseFrom);
    a.send({ type: 'dev.sword', input: { kind: 'button', color: 'red', slot: 'p2' } });
    await a.wait(m => m.type === 'error' && m.message === 'Invalid game message.');
    const bobBefore = b.latestMatch()!.fighters.p2;
    for (let cast = 0; cast < 40 && a.latestMatch()!.phase === 'fighting'; cast++) {
      let from = a.messages.length;
      a.send({ type: 'spell.choose', difficulty: 'hard' });
      await a.wait(m => m.type === 'match.state' && m.match?.fighters.p1.castPhase === 'enter', from);
      const spell = getSpell(a.latestMatch()!.fighters.p1.spellId!);
      from = a.messages.length;
      for (const color of spell.combo) a.send({ type: 'dev.sword', input: { kind: 'button', color } });
      await a.wait(m => m.type === 'match.state' && m.match?.fighters.p1.castPhase === 'motion', from);
      from = a.messages.length;
      a.send({ type: 'dev.sword', input: { kind: 'gesture', gesture: spell.gesture } });
      await a.wait(m => m.type === 'match.state' && m.match?.fighters.p1.castPhase === 'armed', from);
      from = a.messages.length;
      a.send({ type: 'dev.sword', input: { kind: 'trigger' } });
      await a.wait(m => m.type === 'match.state' && m.match?.fighters.p1.castPhase === 'choose', from);
      if (cast === 0) {
        await b.wait(m => m.type === 'match.state' && !!m.match && m.match.fighters.p2.hp < 100);
        const beforeHeal = b.latestMatch()!.fighters.p2.hp;
        const healFrom = b.messages.length;
        b.send({ type: 'player.heal', slot: 'p1' });
        await b.wait(m => m.type === 'error' && m.message === 'Invalid game message.', healFrom);
        b.send({ type: 'player.heal' });
        await b.wait(m => m.type === 'match.state' && m.match?.fighters.p2.healUsesRemaining === 1, healFrom);
        const healed = b.latestMatch()!.fighters.p2;
        assert.ok(healed.hp - beforeHeal >= 10 && healed.hp - beforeHeal <= 20);
        const cooldownFrom = b.messages.length;
        b.send({ type: 'player.heal' });
        b.send({ type: 'device.check' });
        await b.wait(m => m.type === 'error' && m.message.includes('Keyboard practice'), cooldownFrom);
        assert.equal(b.latestMatch()!.fighters.p2.hp, healed.hp);
        assert.equal(b.latestMatch()!.fighters.p2.healUsesRemaining, 1);
        assert.equal(a.latestMatch()!.fighters.p1.healUsesRemaining, 2);
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    const ended = await b.wait(m => m.type === 'match.state' && m.match?.phase === 'over');
    assert.equal(ended.type === 'match.state' && ended.match?.winner, 'p1');
    assert.deepEqual(a.latestMatch(), b.latestMatch());
    assert.equal(b.latestMatch()!.fighters.p2.entered, bobBefore.entered);
    let stored;
    for (let attempt = 0; attempt < 40; attempt++) {
      stored = (await call('alice', 'GET', `/matches/${matchId}`)).data.match;
      if (stored.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(stored.status, 'completed');
    assert.equal(stored.winnerPlayerId, ids.alice);
    const fromA = a.messages.length; const fromB = b.messages.length;
    a.send({ type: 'match.rematch' }); b.send({ type: 'match.rematch' });
    for (const [client, from] of [[a, fromA], [b, fromB]] as const) {
      await client.wait(m => m.type === 'match.state' && m.match === null, from);
      const lobby = await client.wait(m => m.type === 'lobby.state' && m.lobby?.players.length === 2, from);
      assert.equal(lobby.type === 'lobby.state' && lobby.lobby?.code, original.joinCode);
    }
    const rematch = (await call('bob', 'GET', `/matches/${matchId}`)).data.match;
    assert.equal(rematch.roundNumber, 2); assert.equal(rematch.status, 'waiting');
    assert.equal(rematch.id, matchId); assert.equal(rematch.joinCode, original.joinCode);
    assert.deepEqual(rematch.players.map((p: { playerId: string }) => p.playerId), original.players.map((p: { playerId: string }) => p.playerId));
    assert.equal(rematch.players[0].swordId, assignedSword);
    const rounds = await pool.query('SELECT * FROM match_rounds WHERE match_id = $1', [matchId]);
    assert.equal(rounds.rows.length, 1); assert.equal(rounds.rows[0].winner_player_id, ids.alice);
    const restartFrom = b.messages.length;
    a.send({ type: 'quest.begin' });
    const secondQuest = await b.wait(m => m.type === 'quest.state' && !!m.quest?.story, restartFrom);
    assert.equal(secondQuest.type === 'quest.state' && secondQuest.quest?.roundNumber, 2);
    assert.notEqual(secondQuest.type === 'quest.state' && secondQuest.quest?.story?.briefing, firstStory.briefing);
    a.send({ type: 'quest.accept' }); b.send({ type: 'quest.accept' });
    const restarted = await b.wait(m => m.type === 'match.state' && m.match?.phase === 'fighting', restartFrom);
    assert.equal(restarted.type === 'match.state' && restarted.match?.fighters.p1.hp, 100);
    assert.equal(restarted.type === 'match.state' && restarted.match?.fighters.p2.hp, 100);
    assert.equal(restarted.type === 'match.state' && restarted.match?.fighters.p2.healUsesRemaining, 2);
    assert.equal(restarted.type === 'match.state' && restarted.match?.fighters.p2.healReadyAt, null);
    assert.equal(restarted.type === 'match.state' && restarted.match?.fighters.p1.castPhase, 'choose');
    await call('alice', 'POST', `/matches/${matchId}/leave`, {});
  } finally { a.ws.close(); b.ws.close(); }
});

test('against a player with a physical sword, damage waits for their sword to report the IR shot', async () => {
  const matchId = await matchPair();
  const a = await socketClient('alice', matchId);
  const b = await socketClient('bob', matchId);
  try {
    await a.wait(m => m.type === 'lobby.state' && m.lobby?.players.filter(p => p.connected).length === 2);
    b.send({ type: 'sword.link', connected: true });
    a.send({ type: 'quest.begin' });
    await a.wait(m => m.type === 'quest.state' && !!m.quest?.story);
    a.send({ type: 'quest.accept' }); b.send({ type: 'quest.accept' });
    await b.wait(m => m.type === 'match.state' && m.match?.phase === 'fighting');
    let from = a.messages.length;
    a.send({ type: 'spell.choose', difficulty: 'easy' });
    await a.wait(m => m.type === 'match.state' && m.match?.fighters.p1.castPhase === 'enter', from);
    const spell = getSpell(a.latestMatch()!.fighters.p1.spellId!);
    from = a.messages.length;
    for (const color of spell.combo) a.send({ type: 'dev.sword', input: { kind: 'button', color } });
    a.send({ type: 'dev.sword', input: { kind: 'gesture', gesture: spell.gesture } });
    a.send({ type: 'dev.sword', input: { kind: 'trigger', shot: 42 } });
    await a.wait(m => m.type === 'match.event' && m.event.kind === 'cast', from);
    // No simulated hit, and a token Alice never fired does nothing.
    b.send({ type: 'sword.hit', shot: 41 });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(b.latestMatch()!.fighters.p2.hp, 100);
    b.send({ type: 'sword.hit', shot: 42 });
    const hit = await a.wait(m => m.type === 'match.event' && m.event.kind === 'hit', from);
    assert.equal(hit.type === 'match.event' && hit.event.kind === 'hit' && hit.event.victim, 'p2');
    b.send({ type: 'sword.hit', shot: 42 });
    await b.wait(m => m.type === 'match.state' && !!m.match && m.match.fighters.p2.hp < 100);
    const hp = b.latestMatch()!.fighters.p2.hp;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(b.latestMatch()!.fighters.p2.hp, hp);
    await call('alice', 'POST', `/matches/${matchId}/leave`, {});
  } finally { a.ws.close(); b.ws.close(); }
});

test('quest briefings wait for both players, survive reconnects, and cannot be skipped by starting combat early', async () => {
  const callsBefore = storyCalls;
  const matchId = await matchPair();
  const a = await socketClient('alice', matchId);
  const b = await socketClient('bob', matchId);
  let rejoined: Awaited<ReturnType<typeof socketClient>> | undefined;
  try {
    b.send({ type: 'quest.begin' });
    await b.wait(m => m.type === 'error' && m.message.includes('host'));
    a.send({ type: 'quest.begin' });
    const stories = [];
    for (const client of [a, b]) {
      const message = await client.wait(m => m.type === 'quest.state' && !!m.quest?.story);
      stories.push(message.type === 'quest.state' && message.quest?.story);
    }
    assert.deepEqual(stories[0], stories[1]);
    a.send({ type: 'quest.accept' });
    await b.wait(m => m.type === 'quest.state' && m.quest?.accepted.includes('p1') === true);
    a.send({ type: 'match.start' });
    await a.wait(m => m.type === 'error' && m.message.includes('accept the quest'));
    assert.equal((await call('alice', 'GET', `/matches/${matchId}`)).data.match.status, 'waiting');
    assert.equal(a.latestMatch(), undefined);
    b.ws.close();
    await a.wait(m => m.type === 'lobby.state' && m.lobby?.players.some(p => !p.connected) === true);
    rejoined = await socketClient('bob', matchId);
    const restored = await rejoined.wait(m => m.type === 'quest.state' && m.quest?.accepted.includes('p1') === true);
    assert.deepEqual(restored.type === 'quest.state' && restored.quest?.story, stories[0]);
    assert.equal(storyCalls - callsBefore, 1);
    rejoined.send({ type: 'quest.accept' });
    for (const client of [a, rejoined]) await client.wait(m => m.type === 'match.state' && m.match?.phase === 'fighting');
    assert.deepEqual(a.latestMatch(), rejoined.latestMatch());
    assert.equal((await call('bob', 'GET', `/matches/${matchId}`)).data.match.status, 'active');
    await call('alice', 'POST', `/matches/${matchId}/leave`, {});
  } finally { a.ws.close(); b.ws.close(); rejoined?.ws.close(); }
});

test('slow Gemini does not block room commands; both players receive the same fallback and late output is ignored', async () => {
  holdStory = true;
  const matchId = await matchPair();
  const a = await socketClient('alice', matchId);
  const b = await socketClient('bob', matchId);
  holdStory = false;
  try {
    a.send({ type: 'quest.begin' });
    await a.wait(m => m.type === 'quest.state' && m.quest?.story === null);
    a.send({ type: 'quest.accept' });
    await a.wait(m => m.type === 'error' && m.message.includes('Moss is finishing'));
    // This command must be processed before the model/fallback resolves.
    a.send({ type: 'device.check' });
    await a.wait(m => m.type === 'error' && m.message.includes('Keyboard practice'));
    assert.equal(a.messages.some(m => m.type === 'quest.state' && !!m.quest?.story), false);
    const first = await a.wait(m => m.type === 'quest.state' && m.quest?.story?.source === 'fallback');
    const second = await b.wait(m => m.type === 'quest.state' && m.quest?.story?.source === 'fallback');
    assert.deepEqual(first, second);
    releaseStory?.();
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(a.messages.some(m => m.type === 'quest.state' && m.quest?.story?.source === 'gemini'), false);
    await call('alice', 'POST', `/matches/${matchId}/leave`, {});
  } finally { holdStory = false; releaseStory?.(); a.ws.close(); b.ws.close(); }
});

test('bot story API requires login, validates requests and reuses one story per user/session/round', async () => {
  assert.equal((await testFetch(`${base}/api/quests/story`, { method: 'POST' })).status, 401);
  assert.equal((await call('alice', 'POST', '/quests/story', { prompt: 'custom' })).status, 400);
  const body = { sessionId: randomUUID(), roundNumber: 1 };
  const callsBefore = storyCalls;
  const [a, b] = await Promise.all([call('alice', 'POST', '/quests/story', body), call('alice', 'POST', '/quests/story', body)]);
  assert.equal(a.status, 200); assert.deepEqual(a.data, b.data); assert.equal(storyCalls - callsBefore, 1);
  assert.equal(isQuestStory(a.data.story), true);
  const next = await call('alice', 'POST', '/quests/story', { ...body, roundNumber: 2 });
  assert.equal(next.status, 200); assert.notEqual(next.data.story.briefing, a.data.story.briefing);
  assert.equal((await call('bob', 'POST', '/quests/story', { ...body, roundNumber: 2 })).status, 409);
});

test('online disconnects are visible, reconnects restore the room, and leaving closes it for both', async () => {
  const matchId = await matchPair();
  const a = await socketClient('alice', matchId);
  const b = await socketClient('bob', matchId);
  b.ws.close();
  await a.wait(m => m.type === 'lobby.state' && m.lobby?.players.some(p => p.slot === 'p2' && !p.connected) === true);
  const rejoined = await socketClient('bob', matchId);
  await rejoined.wait(m => m.type === 'lobby.state' && m.lobby?.you === 'p2');
  assert.equal((await call('carol', 'POST', `/matches/${matchId}/leave`, {})).status, 404);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/leave`, {})).status, 200);
  await a.wait(m => m.type === 'room.closed');
  await rejoined.wait(m => m.type === 'room.closed');
  assert.equal((await call('alice', 'GET', `/matches/${matchId}`)).data.match.status, 'completed');
  a.ws.close(); rejoined.ws.close();
});

test('live sockets reject a different website origin', async () => {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime`, { origin: 'https://other.example', ...(hosted ? { ca: testCa } : {}) });
  ws.on('error', () => {});
  const status = await new Promise<number>(resolve => {
    ws.on('unexpected-response', (_request, response) => { resolve(response.statusCode!); response.resume(); ws.terminate(); });
  });
  assert.equal(status, 403);
});

test('match membership is private; two players and the host control the lifecycle', async () => {
  assert.equal((await call('no-profile', 'POST', '/matches', {})).status, 409);
  const created = await call('alice', 'POST', '/matches', {});
  const match = created.data.match;
  assert.equal((await call('alice', 'POST', `/matches/${match.id}/start`, {})).status, 409);
  assert.equal((await call('carol', 'GET', `/matches/${match.id}`)).status, 404);
  assert.equal((await call('bob', 'POST', '/matches/join', { joinCode: match.joinCode })).status, 200);
  const repeated = await call('bob', 'POST', '/matches/join', { joinCode: match.joinCode });
  assert.equal(repeated.data.match.players.length, 2);
  assert.equal((await call('carol', 'POST', '/matches/join', { joinCode: match.joinCode })).status, 409);
  assert.equal((await call('bob', 'POST', `/matches/${match.id}/start`, {})).status, 403);
  assert.equal((await call('alice', 'POST', `/matches/${match.id}/start`, {})).data.match.status, 'active');
  assert.equal((await call('alice', 'POST', `/matches/${match.id}/finish`, { winnerPlayerId: ids.carol })).status, 400);
  assert.equal((await call('alice', 'POST', `/matches/${match.id}/finish`, { winnerPlayerId: ids.bob })).data.match.winnerPlayerId, ids.bob);
  assert.equal((await call('alice', 'GET', `/matches/${match.id}`)).data.match.status, 'completed');
  const outsiderMatches = (await call('carol', 'GET', '/matches')).data.matches;
  assert.equal(outsiderMatches.some((row: { id: string }) => row.id === match.id), false);
});

test('both players store sword readings; ownership, batches, filtering and retry deduplication work', async () => {
  const matchId = await matchPair();
  const a = await sword('alice', matchId); const b = await sword('bob', matchId);
  assert.equal((await call('alice', 'PUT', `/matches/${matchId}/sword`, { swordId: b })).status, 404);
  const reading = sample();
  const body = { swordId: a, samples: [reading] };
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/sword-samples`, body)).status, 403);
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/sword-samples`, body)).data.accepted, 1);
  const retry = await call('alice', 'POST', `/matches/${matchId}/sword-samples`, body);
  assert.equal(retry.status, 201);
  // pg-mem returns the conflicting row for DO NOTHING RETURNING; PostgreSQL
  // correctly returns no rows. Verify the receipt count against the real DB.
  if (live) assert.equal(retry.data.duplicates, 1);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/sword-samples`, { swordId: b, samples: [sample()] })).data.accepted, 1);
  const list = await call('alice', 'GET', `/matches/${matchId}/sword-samples`);
  assert.equal(list.data.samples.length, 2);
  assert.deepEqual(new Set(list.data.samples.map((r: { playerId: string }) => r.playerId)), new Set([ids.alice, ids.bob]));
  assert.equal((await call('bob', 'GET', `/matches/${matchId}/sword-samples?playerId=${ids.alice}`)).data.samples.length, 1);
  assert.equal((await call('carol', 'GET', `/matches/${matchId}/sword-samples`)).status, 404);
  const invalid = await call('alice', 'POST', `/matches/${matchId}/sword-samples`, { swordId: a, samples: [sample(), { ...sample(), orientation: [0, 0, 0, 0] }] });
  assert.equal(invalid.status, 400);
  assert.equal((await call('alice', 'GET', `/matches/${matchId}/sword-samples`)).data.samples.length, 2);
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/sword-samples`, { ...body, playerId: ids.bob })).status, 400);
  assert.equal((await call('alice', 'GET', `/matches/${matchId}/sword-samples?limit=101`)).status, 400);
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/sword-samples`, { swordId: a, samples: [{ ...sample(), capturedAt: '2100-01-01T00:00:00Z' }] })).status, 400);
});

test('camera tracking supports both players and a host-operated shared camera', async () => {
  const matchId = await matchPair();
  const tracking = { sampleId: randomUUID(), capturedAt: new Date().toISOString(), confidence: 0.95, imagePoint: [0.4, 0.6], coordinateFrame: 'image-normalized', frameNumber: 1 };
  const body = { cameraId: 'shared-camera', trackedPlayerId: ids.bob, samples: [tracking] };
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/camera-samples`, body)).data.accepted, 1);
  const retry = await call('alice', 'POST', `/matches/${matchId}/camera-samples`, body);
  assert.equal(retry.status, 201);
  if (live) assert.equal(retry.data.duplicates, 1);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/camera-samples`, { ...body, trackedPlayerId: ids.alice })).status, 403);
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/camera-samples`, { ...body, trackedPlayerId: ids.carol })).status, 404);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/camera-samples`, { cameraId: 'own-camera', samples: [{ ...tracking, sampleId: randomUUID() }] })).data.accepted, 1);
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/camera-samples`, { cameraId: 'host-camera', samples: [{ ...tracking, sampleId: randomUUID() }] })).data.accepted, 1);
  const rows = (await call('bob', 'GET', `/matches/${matchId}/camera-samples`)).data.samples;
  assert.equal(rows.length, 3);
  assert.deepEqual(new Set(rows.map((r: { playerId: string }) => r.playerId)), new Set([ids.alice, ids.bob]));
  assert.equal((await call('bob', 'GET', `/matches/${matchId}/camera-samples?playerId=${ids.bob}`)).data.samples.length, 2);
  assert.equal(rows.some((r: { uploadedByPlayerId: string }) => r.uploadedByPlayerId === ids.alice), true);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/camera-samples`, { ...body, samples: [{ ...tracking, confidence: 2 }] })).status, 400);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/camera-samples`, { ...body, samples: [{ confidence: 1, coordinateFrame: 'unknown' }] })).status, 400);
  assert.equal((await call('carol', 'GET', `/matches/${matchId}/camera-samples`)).status, 404);
});

test('device reports are unverified; completed matches reject new recordings', async () => {
  const matchId = await matchPair(); const a = await sword('alice', matchId);
  const input = await call('alice', 'POST', `/matches/${matchId}/events`, { type: 'ir-hit', shotId: 'shot-1', attackerSlot: 2 });
  assert.equal(input.status, 201); assert.equal(input.data.verified, false);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/events`, { type: 'match-finished' })).status, 400);
  await call('alice', 'POST', `/matches/${matchId}/start`, {});
  await call('alice', 'POST', `/matches/${matchId}/finish`, {});
  assert.equal((await call('alice', 'POST', `/matches/${matchId}/sword-samples`, { swordId: a, samples: [sample()] })).status, 409);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/camera-samples`, { cameraId: 'camera', samples: [{ confidence: 1, imagePoint: [0, 0], coordinateFrame: 'image-normalized' }] })).status, 409);
  assert.equal((await call('bob', 'POST', `/matches/${matchId}/events`, { type: 'button', button: 'red' })).status, 409);
  const history = await call('bob', 'GET', `/matches/${matchId}/events`);
  assert.equal(history.data.events.some((e: { type: string }) => e.type === 'match-finished'), true);
});

test('concurrent joins never create a third player', async () => {
  const match = (await call('alice', 'POST', '/matches', {})).data.match;
  const results = await Promise.all(['bob', 'carol'].map(user => call(user, 'POST', '/matches/join', { joinCode: match.joinCode })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await call('alice', 'GET', `/matches/${match.id}`)).data.match.players.length, 2);
});

test('live migrations are repeatable and sensor tables are Timescale hypertables', { skip: !live }, async () => {
  assert.deepEqual(await migrate(pool), []);
  const tables = await pool.query('SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema = $1', [schema]);
  assert.deepEqual(tables.rows.map(r => r.hypertable_name).sort(), ['camera_samples', 'sword_samples']);
});

test('four-digit codes preserve leading zeroes, retry collisions, and become reusable only after a room closes', async () => {
  const occupied = new Set((await pool.query('SELECT join_code FROM matches WHERE room_open = TRUE')).rows.map(r => r.join_code));
  const available = Array.from({ length: 1000 }, (_, i) => i.toString().padStart(4, '0')).filter(code => !occupied.has(code));
  const [codeA, codeB] = available; assert.ok(codeA && codeB);
  let attempts = 0;
  const game = createGameStore(pool, { generateRoomCode: () => { attempts++; return attempts < 3 ? codeA : codeB; } });
  const first = await game.createMatch('test|alice');
  assert.equal(first.joinCode, codeA); assert.ok(first.joinCode.startsWith('0'));
  const second = await game.createMatch('test|bob');
  assert.equal(second.joinCode, codeB); assert.equal(attempts, 3);
  assert.equal((await call('carol', 'POST', '/matches/join', { joinCode: '17' })).status, 400);
  assert.equal((await call('carol', 'POST', '/matches/join', { joinCode: 'ABCD' })).status, 400);
  await game.closeMatch('test|alice', first.id);
  const reused = await createGameStore(pool, { generateRoomCode: () => codeA }).createMatch('test|carol');
  assert.notEqual(reused.id, first.id); assert.equal(reused.joinCode, codeA);
  assert.equal((await game.getMatch('test|alice', first.id)).roomOpen, false);
  await assert.rejects(createGameStore(pool, { generateRoomCode: () => codeB }).createMatch('test|alice'), /allocate a room code/);
});

test('hosted build serves HTML and assets with Auth0/WSS policy while API authentication stays enforced', { skip: !hosted }, async () => {
  const response = await testFetch(base);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/html/);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups',
    'The hosted page must retain its Auth0 popup instead of treating it as closed');
  const html = await response.text();
  const asset = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(asset);
  const bundle = await testFetch(`${base}${asset}`);
  assert.equal(bundle.status, 200);
  assert.equal((await bundle.text()).includes('same-origin'), true);
  for (const art of ['moss.svg', 'knight.svg', 'pixel-world.svg']) {
    const image = await testFetch(`${base}/art/${art}`);
    assert.equal(image.status, 200); assert.match(image.headers.get('content-type')!, /image\/svg\+xml/);
    assert.match(await image.text(), /<svg\s/);
  }
  const policy = response.headers.get('content-security-policy')!;
  assert.ok(policy.includes(origin.replace('https:', 'wss:')));
  assert.ok(policy.includes('frame-src'));
  assert.ok(policy.includes("media-src 'self' blob:"));
  assert.equal((await testFetch(`${base}/health`)).status, 200);
  const unknown = await call('alice', 'GET', '/does-not-exist');
  assert.equal(unknown.status, 404); assert.equal(unknown.data.error, 'not_found');
});
