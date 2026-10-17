import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeechService } from '../src/story/speech.js';
import { readConfig } from '../src/config.js';
import { ApiError } from '../src/game/errors.js';

const config = { apiKey: 'private-test-key', voiceId: 'testVoice1234567890', model: 'eleven_flash_v2_5', dailyCharacters: 10000 };
const mp3 = () => new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });

test('ElevenLabs uses server-only credentials and shares one generation between identical requests', async () => {
  let calls = 0;
  const service = createSpeechService(config, { fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/testVoice1234567890?output_format=mp3_44100_128');
    assert.equal(new Headers(init?.headers).get('xi-api-key'), config.apiKey);
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model_id, 'eleven_flash_v2_5'); assert.equal(body.text, 'Good hit!');
    assert.equal(JSON.stringify(body).includes(config.apiKey), false);
    return mp3();
  } });
  const [a, b] = await Promise.all([service.synthesize('alice', 'Good hit!'), service.synthesize('bob', ' Good  hit! ')]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  await service.synthesize('alice', 'Good hit!'); assert.equal(calls, 1);
});

test('daily character guard limits new generations while cached lines still work', async () => {
  let calls = 0;
  const service = createSpeechService({ ...config, dailyCharacters: 9 }, { fetch: async () => { calls++; return mp3(); } });
  await service.synthesize('alice', 'Good hit!');
  await assert.rejects(service.synthesize('alice', 'Another line!'), (error: unknown) => error instanceof ApiError && error.code === 'voice_budget');
  await service.synthesize('bob', 'Good hit!'); assert.equal(calls, 1);
});

test('missing keys, provider errors, wrong audio and failed requests safely fall back without disclosing provider data', async () => {
  await assert.rejects(createSpeechService(null).synthesize('alice', 'Hello'));
  for (const status of [401, 403, 404, 429, 500]) {
    const service = createSpeechService(config, { fetch: async () => new Response('secret provider body', { status }) });
    await assert.rejects(service.synthesize('alice', 'Hello'), (error: unknown) => error instanceof ApiError && !error.message.includes('secret'));
  }
  const wrong = createSpeechService(config, { fetch: async () => Response.json({ apiKey: 'secret' }) });
  await assert.rejects(wrong.synthesize('alice', 'Hello'));
  const keyId = createSpeechService(config, { fetch: async () => Response.json({ detail: { status: 'api_key_id_used_as_api_key', message: 'private provider body' } }, { status: 400 }) });
  await assert.rejects(keyId.synthesize('alice', 'Hello'), (error: unknown) => error instanceof ApiError && error.message.includes('key ID') && !error.message.includes('private provider'));
  let calls = 0;
  const failing = createSpeechService(config, { fetch: () => { calls++; throw new Error(config.apiKey); } });
  for (let i = 0; i < 2; i++) await assert.rejects(failing.synthesize('alice', 'Hello'), (error: unknown) => error instanceof ApiError && !error.message.includes(config.apiKey));
  assert.equal(calls, 2); // Failed promises cannot get stuck in the in-flight cache.
});

test('slow synthesis aborts and concurrent speech generation is bounded', async () => {
  const service = createSpeechService(config, { timeoutMs: 15, fetch: (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('Timeout')), { once: true });
  }) });
  const first = service.synthesize('alice', 'one'); const second = service.synthesize('bob', 'two'); const third = service.synthesize('carol', 'three');
  await assert.rejects(service.synthesize('dan', 'four'), (error: unknown) => error instanceof ApiError && error.code === 'voice_budget');
  const results = await Promise.allSettled([first, second, third]);
  assert.ok(results.every(result => result.status === 'rejected'));
});

test('voice configuration is optional; endpoints, model, and key values are validated without echoing secrets', () => {
  assert.equal(readConfig({}).elevenlabs, null);
  const env = { ELEVENLABS_ENABLED: 'true', ELEVENLABS_API_KEY: config.apiKey, ELEVENLABS_VOICE_ID: config.voiceId };
  assert.equal(readConfig(env).elevenlabs?.model, config.model);
  for (const vars of [{ ELEVENLABS_VOICE_ID: '../../private' }, { ELEVENLABS_API_KEY: '' }, { ELEVENLABS_DAILY_CHARACTER_LIMIT: '0' }]) {
    assert.throws(() => readConfig({ ...env, ...vars }), (error: unknown) => error instanceof Error && !error.message.includes(config.apiKey));
  }
});
