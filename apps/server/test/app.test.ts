import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { readConfig, type Config } from '../src/config.js';
import { createPlayerStore } from '../src/db/players.js';
import { createPool } from '../src/db/pool.js';
import { isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { createSpeechService } from '../src/story/speech.js';
import { MOSS_COMMAND_REPLIES } from '@sword/protocol';

let issuerServer: Server;
let apiServer: Server;
let issuer: string;
let base: string;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let pool: Pool;
const audience = 'https://sword-api';

async function start(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop(server: Server) {
  await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
}
async function token(subject: string, options: { audience?: string; issuer?: string; expired?: boolean; badSignature?: boolean } = {}) {
  const signingKey = options.badSignature ? (await generateKeyPair('RS256')).privateKey : keys.privateKey;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 3600 : '5m')
    .sign(signingKey);
}
async function request(path: string, accessToken?: string, body?: unknown, method?: string) {
  return fetch(`${base}${path}`, {
    method: method ?? (body ? 'PUT' : 'GET'),
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

before(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  issuerServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}jwks`, id_token_signing_alg_values_supported: ['RS256'] }));
    } else if (req.url === '/jwks') res.end(JSON.stringify({ keys: [jwk] }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  issuer = `${await start(issuerServer)}/`;
  const database = newDb();
  const sql = await readFile(new URL('../migrations/001_players.sql', import.meta.url), 'utf8');
  database.public.none(sql);
  pool = new (database.adapters.createPg().Pool)() as unknown as Pool;
  const config: Config = {
    host: '127.0.0.1', port: 3001, webOrigin: 'http://localhost:5173',
    auth0: { issuerBaseURL: issuer, audience }, databaseUrl: null,
  };
  const speech = createSpeechService({ apiKey: 'private-speech-test-key', voiceId: 'testVoice1234567890', model: 'eleven_flash_v2_5', dailyCharacters: 1000 },
    { fetch: async () => new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } }) });
  apiServer = createServer(createApp(config, createPlayerStore(pool), null, null, undefined, speech));
  base = await start(apiServer);
});

after(async () => {
  if (apiServer) await stop(apiServer);
  if (issuerServer) await stop(issuerServer);
  if (pool) await pool.end();
});

test('health works without a token', async () => {
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('voice audio requires player authentication and accepts only bounded text, never keys or voice overrides', async () => {
  assert.equal((await request('/api/voice/speak', undefined, { text: 'Good hit!' }, 'POST')).status, 401);
  const accessToken = await token('auth0|voice-player');
  for (const body of [{ text: 'x'.repeat(801) }, { text: 'Hi', voiceId: 'another-voice' }, { text: '' }]) {
    assert.equal((await request('/api/voice/speak', accessToken, body, 'POST')).status, 400);
  }
  const response = await request('/api/voice/speak', accessToken, { text: 'Good hit!' }, 'POST');
  assert.equal(response.status, 200); assert.match(response.headers.get('Content-Type')!, /^audio\/mpeg/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.has('xi-api-key'), false);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([73, 68, 51]));
});

test('built-in Moss speech works before login, but the public route rejects arbitrary speech', async () => {
  const known = await request('/voice/speak', undefined, { text: 'Good hit!' }, 'POST');
  assert.equal(known.status, 200); assert.match(known.headers.get('Content-Type')!, /^audio\/mpeg/);
  const command = await request('/voice/speak', undefined, { text: MOSS_COMMAND_REPLIES.bot }, 'POST');
  assert.equal(command.status, 200); assert.match(command.headers.get('Content-Type')!, /^audio\/mpeg/);
  assert.equal((await request('/voice/speak', undefined, { text: 'Generate arbitrary expensive speech' }, 'POST')).status, 400);
});

test('protected routes reject missing and malformed tokens', async () => {
  for (const accessToken of [undefined, 'not-a-token']) {
    const response = await request('/api/me', accessToken);
    assert.equal(response.status, 401);
  }
});

test('JWT validation rejects wrong audience, issuer, expired tokens, and bad signatures', async () => {
  for (const options of [{ audience: 'https://another-api' }, { issuer: 'https://another-issuer/' }, { expired: true }, { badSignature: true }]) {
    assert.equal((await request('/api/auth/me', await token('auth0|alice', options))).status, 401);
  }
});

test('a valid user token identifies the user; machine tokens cannot become players', async () => {
  const response = await request('/api/auth/me', await token('auth0|alice'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { subject: 'auth0|alice' });
  assert.equal((await request('/api/auth/me', await token('example@clients'))).status, 403);
});

test('profile writes are validated, parameterized, and owned by the authenticated player', async () => {
  const alice = await token('auth0|alice');
  const bob = await token('auth0|bob');
  assert.equal((await request('/api/me', alice)).status, 404);
  const created = await request('/api/me', alice, { displayName: '  Nico  ' });
  assert.equal(created.status, 200);
  const first = (await created.json()).player;
  assert.equal(first.displayName, 'Nico');
  assert.equal((await request('/api/me', bob)).status, 404);
  assert.equal((await request('/api/me', bob, { displayName: 'Bob', auth0Sub: 'auth0|alice' })).status, 400);
  assert.equal((await request('/api/me', alice, { displayName: '   ' })).status, 400);
  assert.equal((await request('/api/me', alice, { displayName: 'a'.repeat(41) })).status, 400);
  const suspiciousName = "Nico'); DROP TABLE players; --";
  const changed = await request('/api/me', alice, { displayName: suspiciousName });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).player.id, first.id);
  assert.equal((await request('/api/me', bob, { displayName: 'Bob' })).status, 200);
  const ownProfile = await request('/api/me?auth0Sub=auth0%7Cbob', alice);
  assert.equal((await ownProfile.json()).player.displayName, suspiciousName);
  const rows = await pool.query('SELECT auth0_sub FROM players');
  assert.equal(rows.rows.length, 2);
});

test('missing configuration fails closed and database outages do not leak error details', async () => {
  const config = readConfig({});
  const unconfigured = createServer(createApp(config, null));
  const url = await start(unconfigured);
  try {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/api/me`)).status, 503);
  } finally { await stop(unconfigured); }
  const unavailable = createServer(createApp({ ...config, auth0: { issuerBaseURL: issuer, audience } }, {
    find: async () => { throw new Error('secret-password-and-query'); },
    save: async () => { throw new Error('secret-password-and-query'); },
  }));
  const unavailableUrl = await start(unavailable);
  try {
    const response = await fetch(`${unavailableUrl}/api/me`, { headers: { Authorization: `Bearer ${await token('auth0|alice')}` } });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('secret-password'), false);
  } finally { await stop(unavailable); }
});

test('configuration rejects partial Auth0 setup and incomplete production setup', () => {
  assert.throws(() => readConfig({ AUTH0_AUDIENCE: audience }));
  assert.throws(() => readConfig({ AUTH0_ISSUER_BASE_URL: 'http://not-https/', AUTH0_AUDIENCE: audience }));
  assert.throws(() => readConfig({ NODE_ENV: 'production' }));
  assert.throws(() => readConfig({ SERVE_WEB: 'true' }));
  assert.throws(() => readConfig({ SERVE_WEB: 'true', PUBLIC_APP_URL: 'http://unsecured.example' }));
  assert.equal(readConfig({ SERVE_WEB: 'true', RENDER_EXTERNAL_URL: 'https://sword.example', WEB_ORIGIN: 'http://localhost:5173' }).webOrigin, 'https://sword.example');
  assert.equal(readConfig({}).webOrigin, 'http://localhost:5173');
});

test('Tiger Cloud connections retain certificate verification when the URL omits its CA setting', async () => {
  const candidate = createPool('postgresql://test:unused@example.test.tsdb.cloud.timescale.com:5432/test?sslmode=require');
  try {
    const url = new URL(candidate.options.connectionString!);
    assert.equal(url.searchParams.get('sslmode'), 'verify-full');
    const caPath = url.searchParams.get('sslrootcert');
    assert.ok(caPath && isAbsolute(caPath) && existsSync(caPath));
  } finally { await candidate.end(); }

  const explicit = createPool('postgresql://test:unused@example.test.tsdb.cloud.timescale.com:5432/test?sslrootcert=custom.pem');
  try {
    assert.equal(new URL(explicit.options.connectionString!).searchParams.get('sslrootcert'), 'custom.pem');
  } finally { await explicit.end(); }

  const otherProvider = createPool('postgresql://test:unused@localhost:5432/test');
  try {
    assert.equal(new URL(otherProvider.options.connectionString!).searchParams.has('sslrootcert'), false);
  } finally { await otherProvider.end(); }
});
