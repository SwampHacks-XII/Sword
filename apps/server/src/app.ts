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

const profileSchema = z.object({ displayName: z.string().trim().min(1).max(40) }).strict();

export function createApp(config: Config, players: PlayerStore | null, game: GameStore | null = null) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
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
