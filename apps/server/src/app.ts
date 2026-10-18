import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { auth } from 'express-oauth2-jwt-bearer';
import { z } from 'zod';
import type { Config } from './config.js';
import type { PlayerStore } from './db/players.js';
import type { GameStore } from './game/store.js';
import { gameRoutes } from './game/routes.js';
import { ApiError } from './game/errors.js';
import type { RealtimeHub } from './game/realtime.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBotStories } from './story/bot-stories.js';
import { isPublicMossLine, type QuestGenerator } from '@sword/protocol';
import { createSpeechService, type SpeechService } from './story/speech.js';

const profileSchema = z.object({ displayName: z.string().trim().min(1).max(40) }).strict();

export function createApp(config: Config, players: PlayerStore | null, game: GameStore | null = null, realtime: RealtimeHub | null = null, generateStory?: QuestGenerator, voiceService?: SpeechService) {
  const app = express();
  const botStory = createBotStories(generateStory);
  const speech = voiceService ?? createSpeechService(config.elevenlabs ?? null);
  app.disable('x-powered-by');
  const authOrigin = config.auth0 ? new URL(config.auth0.issuerBaseURL).origin : null;
  const socketOrigin = config.webOrigin.replace(/^http/, 'ws');
  app.use(helmet(config.serveWeb ? {
    // Auth0 must retain its opener to report popup completion or cancellation.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: { directives: {
    connectSrc: ["'self'", socketOrigin, ...(authOrigin ? [authOrigin] : [])],
    frameSrc: ["'self'", ...(authOrigin ? [authOrigin] : [])],
    imgSrc: ["'self'", 'data:', 'blob:'],
    mediaSrc: ["'self'", 'blob:'],
    upgradeInsecureRequests: config.webOrigin.startsWith('https:') ? [] : null,
  } } } : undefined));
  app.use(cors({ origin: [config.webOrigin] }));
  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok', service: 'sword-server',
      configuration: {
        authentication: config.auth0 ? 'configured' : 'not-configured',
        database: players ? 'configured' : 'not-configured',
      },
    });
  });

  const api = express.Router();
  // Only known game dialogue is available without login; this is not an anonymous TTS proxy.
  app.post('/voice/speak', express.json({ limit: '4kb' }), async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const parsed = z.object({ text: z.string().trim().min(1).max(800) }).strict().safeParse(request.body);
    if (!parsed.success || !isPublicMossLine(parsed.data.text)) {
      throw new ApiError(400, 'unknown_voice_line', 'Choose a built-in Moss dialogue line.');
    }
    const audio = await speech.synthesize(`public:${request.ip}`, parsed.data.text);
    response.type('audio/mpeg').send(audio);
  });
  api.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  if (config.auth0) {
    api.use(auth({ ...config.auth0, tokenSigningAlg: 'RS256' }));
  } else {
    api.use((_request, response) => {
      response.status(503).json({ error: 'authentication_not_configured', message: 'Configure Auth0 in apps/server/.env first.' });
    });
  }
  api.use((request, response, next) => {
    const subject = request.auth?.payload.sub;
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 255) {
      response.status(401).json({ error: 'invalid_identity' }); return;
    }
    if (subject.endsWith('@clients') || request.auth?.payload.gty === 'client-credentials') {
      response.status(403).json({ error: 'player_login_required', message: 'Use a player login token, not a machine-to-machine token.' }); return;
    }
    response.locals.subject = subject;
    next();
  });
  api.get('/auth/me', (_request, response) => {
    response.json({ subject: response.locals.subject });
  });
  api.post('/quests/story', express.json({ limit: '1kb' }), async (request, response) => {
    const parsed = z.object({ sessionId: z.uuid(), roundNumber: z.number().int().min(1).max(10000) }).strict().safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'invalid_quest', 'Send a bot session UUID and round number.');
    response.json(await botStory(response.locals.subject, parsed.data.sessionId, parsed.data.roundNumber));
  });
  api.post('/voice/speak', express.json({ limit: '4kb' }), async (request, response) => {
    const parsed = z.object({ text: z.string().trim().min(1).max(800) }).strict().safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, 'invalid_voice_text', 'Send only 1–800 characters of dialogue.');
    const audio = await speech.synthesize(response.locals.subject, parsed.data.text);
    response.type('audio/mpeg').send(audio);
  });
  api.post('/realtime-ticket', async (request, response) => {
    if (!realtime) throw new ApiError(503, 'realtime_unavailable', 'Online play is unavailable. Check the server configuration.');
    response.json(await realtime.issueTicket(response.locals.subject, Number(request.auth?.payload.exp) * 1000));
  });
  api.post('/matches/:matchId/leave', async (request, response) => {
    if (!game) throw new ApiError(503, 'database_not_configured', 'Configure the database first.');
    const parsed = z.uuid().safeParse(request.params.matchId);
    if (!parsed.success) throw new ApiError(400, 'invalid_match_id', 'Use a valid match UUID.');
    if (realtime) await realtime.leave(response.locals.subject, parsed.data);
    else await game.closeMatch(response.locals.subject, parsed.data);
    response.json({ left: true });
  });
  api.use('/me', (_request, response, next) => {
    if (!players) { response.status(503).json({ error: 'database_not_configured' }); return; }
    next();
  });
  api.get('/me', async (_request, response) => {
    const player = await players!.find(response.locals.subject as string);
    if (!player) {
      response.status(404).json({ error: 'profile_not_found', message: 'Create your profile with PUT /api/me and a displayName.' }); return;
    }
    response.json({ player });
  });
  api.put('/me', express.json({ limit: '2kb' }), async (request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'invalid_profile', message: 'Send only displayName: 1 to 40 characters after trimming.' }); return;
    }
    // Ownership comes only from the verified token, never from the request body.
    const player = await players!.save(response.locals.subject as string, parsed.data.displayName);
    response.json({ player });
  });
  api.use(gameRoutes(game));
  app.use('/api', api);
  // Never return the website shell for an unknown API route.
  app.use('/api', (_request, response) => { response.status(404).json({ error: 'not_found' }); });
  if (config.serveWeb) {
    const webPath = fileURLToPath(new URL('../../web/dist-hosted/', import.meta.url));
    if (!existsSync(`${webPath}/index.html`)) throw new Error('Hosted website is missing. Run npm run build:hosted from the repository root first.');
    app.use(express.static(webPath, { setHeaders(response, path) {
      response.setHeader('Cache-Control', path.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
    } }));
  }
  app.use((_request, response) => { response.status(404).json({ error: 'not_found' }); });
  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    if (status === 401) {
      response.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'unauthorized', message: 'A valid access token for Sword API is required.' });
    } else if (status === 400 || status === 413 || status === 415) {
      response.status(status).json({ error: 'invalid_request' });
    } else {
      // Do not return SQL errors, credentials, or JWTs to clients or logs.
      response.status(503).json({ error: 'service_unavailable', message: 'Check database setup and service availability.' });
    }
  };
  app.use(errorHandler);
  return app;
}
