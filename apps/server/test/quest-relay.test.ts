import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { prepareQuest, type QuestGenerator, type QuestStory } from '@sword/protocol';
import { readGeminiConfig } from '../src/config.js';
import { createGeminiGenerator, GeminiError } from '../src/story/gemini.js';
import { createQuestRelayApp, readQuestRelayConfig } from '../src/story/quest-relay.js';

const token = 'test-only-shared-token-with-at-least-32-characters';
const story: QuestStory = { title: 'The chicken caper', briefing: 'Your evil twin has kidnapped the village chickens. Rescue them before the rooster declares himself king!', source: 'gemini' };
const config = { project: 'test-project', location: 'global', model: 'gemini-3.5-flash-lite', dailyLimit: 10 };
const context = { roundNumber: 1, previousBriefings: [] };
const signal = () => new AbortController().signal;

async function fixture(t: { after(fn: () => Promise<void>): void }, generate: QuestGenerator) {
  const server = createQuestRelayApp(token, generate).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    post: (body: unknown, suppliedToken?: string) => fetch(`${base}/generate`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(suppliedToken ? { 'X-Sword-Quest-Token': suppliedToken } : {}) },
      body: JSON.stringify(body) }),
  };
}

test('the helper rejects missing/wrong tokens and arbitrary prompts before any model call', async t => {
  let calls = 0;
  const helper = await fixture(t, async () => { calls++; return story; });
  assert.equal((await fetch(`${helper.base}/health`)).status, 200);
  for (const invalid of [undefined, 'wrong-token', 'x'.repeat(300)]) {
    assert.equal((await helper.post(context, invalid)).status, 401);
  }
  for (const body of [{ prompt: 'Use a different model' }, { ...context, model: 'override' },
    { ...context, roundNumber: -1 }, { ...context, previousBriefings: Array(9).fill('old story') },
    { ...context, previousBriefings: ['x'.repeat(601)] }]) {
    assert.equal((await helper.post(body, token)).status, 400);
  }
  assert.equal((await helper.post({ ...context, prompt: 'x'.repeat(10_000) }, token)).status, 413);
  assert.equal(calls, 0);
});

test('Render can generate one shared round through the helper without using Google credentials', async t => {
  const received: unknown[] = [];
  const helper = await fixture(t, async value => { received.push(value); return story; });
  const generate = createGeminiGenerator({ ...config, relay: { url: helper.base, token } }, {
    headers: async () => { throw new Error('Render must not try to get Google credentials'); },
    fetch: async (url, init) => {
      assert.equal(new Headers(init?.headers).get('X-Sword-Quest-Token'), token);
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      assert.equal(init?.redirect, 'error', 'A redirect must never forward the helper token elsewhere');
      return fetch(url, init);
    },
  });
  const prepared = prepareQuest(context, generate);
  const [firstPlayer, secondPlayer] = await Promise.all([prepared.get(), prepared.get()]);
  assert.deepEqual(firstPlayer, story);
  assert.strictEqual(firstPlayer, secondPlayer);
  assert.deepEqual(received, [context]);
  prepared.dispose();
  const next = prepareQuest({ roundNumber: 2, previousBriefings: [story.briefing] }, generate);
  const rematch = await next.get();
  assert.notEqual(rematch.briefing, story.briefing, 'A repeated model story must not repeat on rematch');
  assert.equal(received.length, 2);
  next.dispose();
});

test('helper failure is sanitized and Render keeps the existing fallback story path', async t => {
  const helper = await fixture(t, async () => { throw new Error('private provider credential and diagnostic'); });
  const response = await helper.post(context, token);
  assert.equal(response.status, 503);
  const detail = await response.text();
  assert.ok(!detail.includes('private'));
  assert.ok(!detail.includes(token));
  const prepared = prepareQuest(context, createGeminiGenerator({ ...config, relay: { url: helper.base, token } }));
  assert.equal((await prepared.get()).source, 'fallback');
  prepared.dispose();
});

test('remote generation bounds deadlines, cancellation and attempt limits without retrying', async () => {
  let calls = 0;
  let requestSignal: AbortSignal | null | undefined;
  const generate = createGeminiGenerator({ ...config, dailyLimit: 1, relay: { url: 'https://quests.example', token } }, {
    timeoutMs: 10, fetch: async (_url, init) => { calls++; requestSignal = init?.signal; return new Promise(() => {}); },
  });
  await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'timeout');
  assert.equal(requestSignal?.aborted, true);
  await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'limit');
  assert.equal(calls, 1);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(generate(context, cancelled.signal));
  assert.equal(calls, 1);
});

test('remote responses must be genuine short Gemini stories and cannot leak extra fields', async () => {
  const remote = { ...config, relay: { url: 'https://quests.example', token } };
  for (const value of [null, { ...story, source: 'fallback' }, { ...story, briefing: Array(50).fill('word').join(' ') }]) {
    const generate = createGeminiGenerator(remote, { fetch: async () => Response.json(value) });
    await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'response');
  }
  const generate = createGeminiGenerator(remote, { fetch: async () => Response.json({ ...story, secret: 'must not travel to players' }) });
  assert.deepEqual(await generate(context, signal()), story);
});

test('relay configuration rejects incomplete credentials, unsafe URLs and recursive helpers', () => {
  const settings = { GEMINI_ENABLED: 'true', GOOGLE_CLOUD_PROJECT: 'test-project' };
  for (const extra of [{ GEMINI_RELAY_URL: 'https://quests.example' }, { GEMINI_RELAY_TOKEN: token },
    { GEMINI_RELAY_URL: 'http://quests.example', GEMINI_RELAY_TOKEN: token },
    { GEMINI_RELAY_URL: 'https://user:password@quests.example', GEMINI_RELAY_TOKEN: token },
    { GEMINI_RELAY_URL: 'https://quests.example/path', GEMINI_RELAY_TOKEN: token },
    { GEMINI_RELAY_URL: 'https://quests.example', GEMINI_RELAY_TOKEN: 'short' }]) {
    assert.throws(() => readGeminiConfig({ ...settings, ...extra }));
  }
  const remote = readGeminiConfig({ ...settings, GEMINI_RELAY_URL: 'https://quests.example/', GEMINI_RELAY_TOKEN: token });
  assert.deepEqual(remote?.relay, { url: 'https://quests.example', token });
  assert.throws(() => readQuestRelayConfig({ ...settings, QUEST_RELAY_TOKEN: 'short' }));
  assert.throws(() => readQuestRelayConfig({ ...settings, QUEST_RELAY_TOKEN: token, GEMINI_RELAY_URL: 'https://quests.example', GEMINI_RELAY_TOKEN: token }));
  const helper = readQuestRelayConfig({ ...settings, NODE_ENV: 'production', QUEST_RELAY_TOKEN: token });
  assert.equal(helper.port, 8080);
  assert.equal(helper.gemini.relay, undefined, 'The helper does not need the game database or Auth0');
});
