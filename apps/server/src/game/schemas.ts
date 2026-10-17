import { z } from 'zod';

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const quaternion = z.tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(q => Math.abs(Math.hypot(...q) - 1) < 0.05, 'Expected a normalized [x,y,z,w] quaternion')
  .transform(q => { const norm = Math.hypot(...q); return q.map(n => n / norm); });
const stamp = {
  sampleId: z.uuid().optional(),
  capturedAt: z.iso.datetime({ offset: true }).refine(value => {
    const time = Date.parse(value);
    return time >= Date.now() - 7 * 24 * 60 * 60 * 1000 && time <= Date.now() + 5 * 60 * 1000;
  }, 'Captured time must be within the past seven days and no more than five minutes ahead').optional(),
};
export const swordSchema = z.object({
  deviceId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  label: z.string().trim().min(1).max(40),
}).strict();
export const joinSchema = z.object({ joinCode: z.string().trim().toUpperCase().regex(/^[A-F0-9]{12}$/) }).strict();
export const assignmentSchema = z.object({ swordId: z.uuid() }).strict();
export const finishSchema = z.object({ winnerPlayerId: z.uuid().optional() }).strict();
export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  playerId: z.uuid().optional(),
}).strict();
export type Page = z.infer<typeof pageSchema>;
export const swordSampleSchema = z.object({
  ...stamp,
  orientation: quaternion,
  acceleration: vector3.optional(),
  angularVelocity: vector3.optional(),
  deviceTimeMs: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  sequenceNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  coordinateFrame: z.string().trim().min(1).max(64),
}).strict();
export const swordBatchSchema = z.object({
  swordId: z.uuid(), samples: z.array(swordSampleSchema).min(1).max(100),
}).strict();
export type SwordBatch = z.infer<typeof swordBatchSchema>;
export const cameraSampleSchema = z.object({
  ...stamp,
  confidence: z.number().min(0).max(1),
  imagePoint: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  positionMeters: vector3.optional(),
  orientation: quaternion.optional(),
  frameNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  coordinateFrame: z.string().trim().min(1).max(64),
}).strict().refine(sample => Boolean(sample.imagePoint || sample.positionMeters || sample.orientation), 'At least one tracking result is required');
export const cameraBatchSchema = z.object({
  cameraId: z.string().trim().min(1).max(64),
  trackedPlayerId: z.uuid().optional(),
  samples: z.array(cameraSampleSchema).min(1).max(100),
}).strict();
export type CameraBatch = z.infer<typeof cameraBatchSchema>;
export const inputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('button'), button: z.enum(['red', 'blue', 'green', 'yellow', 'trigger']) }).strict(),
  z.object({ type: z.literal('gesture'), gesture: z.string().trim().min(1).max(64) }).strict(),
  z.object({ type: z.literal('ir-hit'), shotId: z.string().min(1).max(64), attackerSlot: z.union([z.literal(1), z.literal(2)]) }).strict(),
]);
export type InputEvent = z.infer<typeof inputSchema>;
