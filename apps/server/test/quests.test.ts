import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fallbackQuest, isQuestStory, prepareQuest, type QuestStory } from '@sword/protocol';
import { createGeminiGenerator, GeminiError } from '../src/story/gemini.js';
import { createBotStories } from '../src/story/bot-stories.js';
import { readConfig } from '../src/config.js';

const story: QuestStory = { title: 'The dancing hens', briefing: 'Your evil twin has enchanted the chickens to dance all night. Stop them before the village runs out of sleepy eggs!', source: 'gemini' };
const config = { project: 'test-project', location: 'global', model: 'gemini-3.5-flash-lite', dailyLimit: 10 };
const context = { roundNumber: 1, previousBriefings: [] };
const response = (value: unknown = story, finishReason = 'STOP') => Response.json({ candidates: [{ finishReason,
  content: { parts: [{ text: JSON.stringify(value) }] } }] });
const signal = () => new AbortController().signal;

test('Gemini sends a bounded structured request to Google using server credentials', async () => {
  let calls = 0;
  const generate = createGeminiGenerator(config, { headers: async () => new Headers({ Authorization: 'Bearer test-only' }),
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-only');
      const body = JSON.parse(init?.body as string);
      assert.equal(body.generationConfig.maxOutputTokens, 256);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'MINIMAL');
      assert.equal(JSON.stringify(body).includes('test-only'), false);
      return response();
    } });
  assert.deepEqual(await generate(context, signal()), story);
  assert.equal(calls, 1);
});

test('invalid, blocked, truncated and 50-word model responses become safe local stories', async () => {
  for (const [value, finish] of [[{ title: 'Too long', briefing: Array(50).fill('word').join(' ') }, 'STOP'],
    [null, 'STOP'], [story, 'MAX_TOKENS'], [story, 'SAFETY']] as const) {
    const generate = createGeminiGenerator(config, { headers: async () => new Headers(), fetch: async () => response(value, finish) });
    await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'response');
    const prepared = prepareQuest(context, generate);
    assert.equal((await prepared.get()).source, 'fallback');
    prepared.dispose();
  }
});

test('credential, permission, quota, and network failures never expose raw provider errors', async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    const generate = createGeminiGenerator(config, { headers: async () => new Headers(), fetch: async () => new Response('private provider text', { status }) });
    await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && !error.message.includes('private'));
  }
  const generate = createGeminiGenerator(config, { headers: async () => { throw new Error('private refresh token'); } });
  await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'credentials' && !error.message.includes('private'));
});

test('generation timeout includes ADC lookup; requests are not retried and daily budget is bounded', async () => {
  let calls = 0;
  const generate = createGeminiGenerator({ ...config, dailyLimit: 1 }, { timeoutMs: 10,
    headers: () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'timeout');
  await assert.rejects(generate(context, signal()), (error: unknown) => error instanceof GeminiError && error.reason === 'limit');
  assert.equal(calls, 1);
});

test('prefetch is reused, concurrent readers share one story, and rematches avoid previous stories', async () => {
  let calls = 0;
  const prepared = prepareQuest(context, async () => { calls++; return story; });
  const [a, b] = await Promise.all([prepared.get(), prepared.get()]);
  assert.deepEqual(a, story); assert.strictEqual(a, b); assert.equal(calls, 1);
  const next = prepareQuest({ roundNumber: 2, previousBriefings: [story.briefing] }, async () => story);
  const second = await next.get();
  assert.notEqual(second.briefing, story.briefing); assert.equal(second.source, 'fallback');
  assert.equal(isQuestStory(second), true);
  assert.notEqual(fallbackQuest(1).briefing, fallbackQuest(2).briefing);
  prepared.dispose(); next.dispose();
});

test('slow generation cannot hold the quest screen or replace its already displayed fallback', async () => {
  let finish!: (value: QuestStory) => void;
  const prepared = prepareQuest(context, () => new Promise(resolve => { finish = resolve; }), 15);
  const start = performance.now();
  const chosen = await prepared.get();
  assert.equal(chosen.source, 'fallback'); assert.ok(performance.now() - start < 500);
  finish(story); await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(await prepared.get(), chosen); assert.deepEqual(prepared.peek(), chosen);
  prepared.dispose();
});

test('bot requests are idempotent per authenticated user/session/round and bound new requests', async () => {
  let calls = 0;
  const bot = createBotStories(async ({ roundNumber }) => { calls++; return { ...story, briefing: `${story.briefing} Round ${roundNumber}.` }; });
  const [a, b] = await Promise.all([bot('alice', 'session', 1), bot('alice', 'session', 1)]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  assert.notEqual((await bot('alice', 'session', 2)).story.briefing, a.story.briefing);
  assert.equal(calls, 2);
  await assert.rejects(bot('bob', 'session', 2));
  for (let i = 0; i < 8; i++) await bot('alice', `session-${i}`, 1);
  await assert.rejects(bot('alice', 'over-limit', 1));
  assert.equal(calls, 10);
});

test('Gemini is opt-in and configuration rejects unsafe endpoints or invalid limits', () => {
  assert.equal(readConfig({}).gemini, null);
  assert.equal(readConfig({ GEMINI_ENABLED: 'true', GOOGLE_CLOUD_PROJECT: 'test-project' }).gemini?.model, config.model);
  for (const vars of [{ GOOGLE_CLOUD_LOCATION: 'example.com' }, { GEMINI_MODEL: '../../private' }, { GEMINI_DAILY_REQUEST_LIMIT: '-1' }]) {
    assert.throws(() => readConfig({ GEMINI_ENABLED: 'true', GOOGLE_CLOUD_PROJECT: 'test-project', ...vars }));
  }
});
