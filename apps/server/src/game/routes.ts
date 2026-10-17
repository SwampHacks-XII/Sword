import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { ApiError } from './errors.js';
import type { GameStore } from './store.js';
import { assignmentSchema, cameraBatchSchema, finishSchema, inputSchema, joinSchema, pageSchema, swordBatchSchema, swordSchema } from './schemas.js';

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Request fields do not match the documented format.');
  return parsed.data;
}
export function gameRoutes(store: GameStore | null) {
  const router = Router();
  router.use(['/matches', '/swords'], (_request, _response, next) => {
    if (!store) throw new ApiError(503, 'database_not_configured', 'Configure the database first.');
    next();
  });
  router.use(express.json({ limit: '128kb' }));
  router.get('/swords', async (_request, response) => {
    response.json({ swords: await store!.listSwords(response.locals.subject) });
  });
  router.post('/swords', async (request, response) => {
    response.status(201).json({ sword: await store!.registerSword(response.locals.subject, parse(swordSchema, request.body)) });
  });
  router.get('/matches', async (request, response) => {
    const page = parse(pageSchema.omit({ playerId: true }), request.query);
    response.json({ matches: await store!.listMatches(response.locals.subject, page), ...page });
  });
  router.post('/matches', async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    response.status(201).json({ match: await store!.createMatch(response.locals.subject) });
  });
  router.post('/matches/join', async (request, response) => {
    response.json({ match: await store!.joinMatch(response.locals.subject, parse(joinSchema, request.body).joinCode) });
  });
  router.param('matchId', (_request, _response, next, value: string) => {
    if (!z.uuid().safeParse(value).success) { next(new ApiError(400, 'invalid_match_id', 'Use a valid match UUID.')); return; }
    next();
  });
  router.get('/matches/:matchId', async (request, response) => {
    response.json({ match: await store!.getMatch(response.locals.subject, request.params.matchId as string) });
  });
  router.put('/matches/:matchId/sword', async (request, response) => {
    response.json({ match: await store!.assignSword(response.locals.subject, request.params.matchId as string, parse(assignmentSchema, request.body).swordId) });
  });
  router.post('/matches/:matchId/start', async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    response.json({ match: await store!.startMatch(response.locals.subject, request.params.matchId as string) });
  });
  router.post('/matches/:matchId/finish', async (request, response) => {
    const input = parse(finishSchema, request.body ?? {});
    response.json({ match: await store!.finishMatch(response.locals.subject, request.params.matchId as string, input.winnerPlayerId) });
  });
  router.post('/matches/:matchId/sword-samples', async (request, response) => {
    response.status(201).json(await store!.saveSwordSamples(response.locals.subject, request.params.matchId as string, parse(swordBatchSchema, request.body)));
  });
  router.post('/matches/:matchId/camera-samples', async (request, response) => {
    response.status(201).json(await store!.saveCameraSamples(response.locals.subject, request.params.matchId as string, parse(cameraBatchSchema, request.body)));
  });
  for (const kind of ['sword', 'camera'] as const) {
    router.get(`/matches/:matchId/${kind}-samples`, async (request, response) => {
      const page = parse(pageSchema, request.query);
      response.json({ samples: await store!.readSamples(response.locals.subject, request.params.matchId as string, kind, page), ...page });
    });
  }
  router.post('/matches/:matchId/events', async (request, response) => {
    response.status(201).json(await store!.appendInput(response.locals.subject, request.params.matchId as string, parse(inputSchema, request.body)));
  });
  router.get('/matches/:matchId/events', async (request, response) => {
    const page = parse(pageSchema, request.query);
    response.json({ events: await store!.readEvents(response.locals.subject, request.params.matchId as string, page), ...page });
  });
  return router;
}
