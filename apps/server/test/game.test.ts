import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer, type Server } from 'node:http';
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

const live = process.env.GAME_TEST_DATABASE === '1';
let pool: Pool;
let admin: Pool | undefined;
let schema: string;
let issuerServer: Server;
let apiServer: Server;
let base: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server?: Server) {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}
async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function matchPair() {
  const created = await call('alice', 'POST', '/matches', {});
  assert.equal(created.status, 201, JSON.stringify(created.data));
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
    for (const file of ['001_players.sql', '002_game_storage.sql']) {
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
  apiServer = createServer(createApp({ host: '127.0.0.1', port: 3001, webOrigin: 'http://localhost:5173',
    auth0: { issuerBaseURL: issuer, audience: 'https://sword-api' }, databaseUrl: null }, createPlayerStore(pool), createGameStore(pool)));
  base = await listen(apiServer);
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
  await close(apiServer); await close(issuerServer);
  if (pool) await pool.end();
  if (admin) {
    try {
      if (!/^sword_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Unexpected test schema; cleanup refused.');
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally { await admin.end(); }
  }
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
