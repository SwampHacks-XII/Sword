import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { isQuestStory, type QuestGenerator } from '@sword/protocol';
import { readGeminiConfig } from '../config.js';
import { GeminiError, type GeminiConfig } from './gemini.js';

const contextSchema = z.object({
  roundNumber: z.number().int().min(1).max(1_000_000_000),
  previousBriefings: z.array(z.string().max(600)).max(8),
}).strict();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);

export function readQuestRelayConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = tokenSchema.safeParse(env.QUEST_RELAY_TOKEN?.trim());
  if (!token.success) throw new Error('Set QUEST_RELAY_TOKEN to a private 32–256 character token.');
  const gemini = readGeminiConfig({ ...env, GEMINI_ENABLED: 'true' });
  if (!gemini || gemini.relay) throw new Error('The quest helper needs its attached Google identity, not another relay URL.');
  const port = z.coerce.number().int().min(1).max(65535).safeParse(env.PORT || 8080);
  if (!port.success) throw new Error('Set PORT to a valid port number.');
  return { token: token.data, gemini: gemini as GeminiConfig, port: port.data };
}

/** This service cannot accept arbitrary prompts, model overrides, or Google credentials. */
export function createQuestRelayApp(token: string, generate: QuestGenerator) {
  if (!tokenSchema.safeParse(token).success) throw new Error('Invalid quest helper token configuration.');
  const expected = createHash('sha256').update(token).digest();
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'moss-quest-relay' }));
  app.post('/generate', (request, response, next) => {
    const provided = request.get('X-Sword-Quest-Token') || '';
    if (provided.length > 256 || !timingSafeEqual(expected, createHash('sha256').update(provided).digest())) {
      response.status(401).json({ error: 'unauthorized', message: 'Quest helper authentication failed.' }); return;
    }
    next();
  }, express.json({ limit: '8kb' }), async (request, response) => {
    const parsed = contextSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_context', message: 'Send a round number and up to eight previous briefings.' }); return;
    }
    const controller = new AbortController();
    const cancel = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', cancel);
    try {
      const story = await generate(parsed.data, controller.signal);
      if (!isQuestStory(story) || story.source !== 'gemini') throw new GeminiError('response');
      if (!response.destroyed) response.json({ title: story.title, briefing: story.briefing, source: 'gemini' });
    } catch (error) {
      const failure = error instanceof GeminiError ? error : new GeminiError('unavailable');
      if (!response.destroyed) response.status(failure.reason === 'limit' || failure.reason === 'quota' ? 429 : 503)
        .json({ error: `gemini_${failure.reason}`, message: failure.message });
    } finally { response.off('close', cancel); }
  });
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    const status = error?.type === 'entity.too.large' ? 413 : error?.type === 'entity.parse.failed' ? 400 : 500;
    response.status(status).json({ error: 'invalid_request', message: 'The quest helper could not process this request.' });
  };
  app.use(errors);
  return app;
}
