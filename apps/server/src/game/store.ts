import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ApiError } from './errors.js';
import type { CameraBatch, InputEvent, Page, SwordBatch } from './schemas.js';

type Database = Pick<PoolClient, 'query'>;
interface MatchRow extends QueryResultRow {
  id: string; join_code: string; host_player_id: string; status: 'waiting' | 'active' | 'completed';
  winner_player_id: string | null; created_at: Date; started_at: Date | null; finished_at: Date | null;
}
function matchView(row: MatchRow) {
  return { id: row.id, joinCode: row.join_code, hostPlayerId: row.host_player_id, status: row.status,
    winnerPlayerId: row.winner_player_id, createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null, finishedAt: row.finished_at?.toISOString() ?? null };
}
async function actor(db: Database, subject: string): Promise<string> {
  const result = await db.query<{ id: string }>('SELECT id FROM players WHERE auth0_sub = $1', [subject]);
  if (!result.rows[0]) throw new ApiError(409, 'profile_required', 'Create your profile with PUT /api/me first.');
  return result.rows[0].id;
}
async function membership(db: Database, matchId: string, playerId: string, lock = false): Promise<MatchRow> {
  const result = await db.query<MatchRow>(`SELECT m.* FROM matches m
    JOIN match_players p ON p.match_id = m.id WHERE m.id = $1 AND p.player_id = $2`, [matchId, playerId]);
  if (!result.rows[0]) throw new ApiError(404, 'match_not_found', 'Match not found for this player.');
  if (!lock) return result.rows[0];
  // Serialize joins, lifecycle changes, and recording writes for this match.
  const locked = await db.query<MatchRow>('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [matchId]);
  return locked.rows[0]!;
}
function requireOpen(match: MatchRow) {
  if (match.status === 'completed') throw new ApiError(409, 'match_completed', 'Completed matches are read-only.');
}
async function details(db: Database, match: MatchRow) {
  const players = await db.query<{ player_id: string; display_name: string; slot: number; sword_id: string | null; joined_at: Date }>(
    `SELECT p.player_id, u.display_name, p.slot, p.sword_id, p.joined_at FROM match_players p
     JOIN players u ON u.id = p.player_id WHERE p.match_id = $1 ORDER BY p.slot`, [match.id]);
  return { ...matchView(match), players: players.rows.map(p => ({ playerId: p.player_id, displayName: p.display_name,
    slot: p.slot, swordId: p.sword_id, joinedAt: p.joined_at.toISOString() })) };
}
async function event(db: Database, matchId: string, playerId: string, type: string, payload: unknown = {}) {
  const id = randomUUID();
  await db.query('INSERT INTO match_events (id, match_id, player_id, event_type, payload) VALUES ($1, $2, $3, $4, $5)',
    [id, matchId, playerId, type, JSON.stringify(payload)]);
  return id;
}
async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const value = await run(db); await db.query('COMMIT'); return value; }
  catch (error) {
    await db.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw new ApiError(409, 'conflict', 'That device or match slot is already registered.');
    }
    throw error;
  } finally { db.release(); }
}

export function createGameStore(pool: Pool) {
  return {
    async createMatch(subject: string) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        const result = await db.query<MatchRow>('INSERT INTO matches (id, join_code, host_player_id) VALUES ($1, $2, $3) RETURNING *',
          [randomUUID(), randomBytes(6).toString('hex').toUpperCase(), playerId]);
        const match = result.rows[0]!;
        await db.query('INSERT INTO match_players (match_id, player_id, slot) VALUES ($1, $2, 1)', [match.id, playerId]);
        await event(db, match.id, playerId, 'match-created');
        return details(db, match);
      });
    },
    async listMatches(subject: string, page: Page) {
      const playerId = await actor(pool, subject);
      const result = await pool.query<MatchRow>(`SELECT m.* FROM matches m JOIN match_players p ON p.match_id = m.id
        WHERE p.player_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2 OFFSET $3`, [playerId, page.limit, page.offset]);
      return result.rows.map(matchView);
    },
    async getMatch(subject: string, matchId: string) {
      return details(pool, await membership(pool, matchId, await actor(pool, subject)));
    },
    async joinMatch(subject: string, joinCode: string) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        const result = await db.query<MatchRow>('SELECT * FROM matches WHERE join_code = $1 FOR UPDATE', [joinCode]);
        const match = result.rows[0];
        if (!match) throw new ApiError(404, 'match_not_found', 'No match has that join code.');
        const members = await db.query<{ player_id: string; slot: number }>('SELECT player_id, slot FROM match_players WHERE match_id = $1', [match.id]);
        if (members.rows.some(p => p.player_id === playerId)) return details(db, match);
        if (match.status !== 'waiting') throw new ApiError(409, 'match_not_waiting', 'This match is not accepting players.');
        if (members.rows.length >= 2) throw new ApiError(409, 'match_full', 'This match already has two players.');
        const slot = members.rows.some(p => p.slot === 1) ? 2 : 1;
        await db.query('INSERT INTO match_players (match_id, player_id, slot) VALUES ($1, $2, $3)', [match.id, playerId, slot]);
        await event(db, match.id, playerId, 'player-joined');
        return details(db, match);
      });
    },
    async startMatch(subject: string, matchId: string) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        const match = await membership(db, matchId, playerId, true);
        if (match.host_player_id !== playerId) throw new ApiError(403, 'host_required', 'Only the match host can start it.');
        requireOpen(match);
        if (match.status === 'active') return details(db, match);
        const count = await db.query('SELECT player_id FROM match_players WHERE match_id = $1', [matchId]);
        if (count.rows.length !== 2) throw new ApiError(409, 'two_players_required', 'Two players must join before the match starts.');
        const result = await db.query<MatchRow>("UPDATE matches SET status = 'active', started_at = NOW() WHERE id = $1 RETURNING *", [matchId]);
        await event(db, matchId, playerId, 'match-started');
        return details(db, result.rows[0]!);
      });
    },
    async finishMatch(subject: string, matchId: string, winnerPlayerId?: string) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        const match = await membership(db, matchId, playerId, true);
        if (match.host_player_id !== playerId) throw new ApiError(403, 'host_required', 'Only the match host can finish it.');
        if (match.status === 'completed') return details(db, match);
        if (match.status !== 'active') throw new ApiError(409, 'match_not_active', 'Start the match before finishing it.');
        if (winnerPlayerId) {
          const winner = await db.query('SELECT player_id FROM match_players WHERE match_id = $1 AND player_id = $2', [matchId, winnerPlayerId]);
          if (!winner.rows[0]) throw new ApiError(400, 'invalid_winner', 'The winner must belong to this match.');
        }
        const result = await db.query<MatchRow>("UPDATE matches SET status = 'completed', finished_at = NOW(), winner_player_id = $2 WHERE id = $1 RETURNING *", [matchId, winnerPlayerId ?? null]);
        await event(db, matchId, playerId, 'match-finished', { winnerPlayerId: winnerPlayerId ?? null });
        return details(db, result.rows[0]!);
      });
    },
    async registerSword(subject: string, input: { deviceId: string; label: string }) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        const result = await db.query<{ id: string; device_id: string; label: string; created_at: Date }>(
          'INSERT INTO swords (id, owner_player_id, device_id, label) VALUES ($1, $2, $3, $4) RETURNING *',
          [randomUUID(), playerId, input.deviceId, input.label]);
        const sword = result.rows[0]!;
        return { id: sword.id, deviceId: sword.device_id, label: sword.label, createdAt: sword.created_at.toISOString() };
      });
    },
    async listSwords(subject: string) {
      const result = await pool.query<{ id: string; device_id: string; label: string; created_at: Date }>(
        'SELECT * FROM swords WHERE owner_player_id = $1 ORDER BY created_at DESC, id DESC', [await actor(pool, subject)]);
      return result.rows.map(sword => ({ id: sword.id, deviceId: sword.device_id, label: sword.label, createdAt: sword.created_at.toISOString() }));
    },
    async assignSword(subject: string, matchId: string, swordId: string) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        const match = await membership(db, matchId, playerId, true);
        if (match.status !== 'waiting') throw new ApiError(409, 'match_not_waiting', 'Assign swords before starting the match.');
        const sword = await db.query('SELECT id FROM swords WHERE id = $1 AND owner_player_id = $2', [swordId, playerId]);
        if (!sword.rows[0]) throw new ApiError(404, 'sword_not_found', 'Sword not found for this player.');
        await db.query('UPDATE match_players SET sword_id = $3 WHERE match_id = $1 AND player_id = $2', [matchId, playerId, swordId]);
        await event(db, matchId, playerId, 'sword-assigned', { swordId });
        return details(db, match);
      });
    },
    async saveSwordSamples(subject: string, matchId: string, batch: SwordBatch) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        requireOpen(await membership(db, matchId, playerId, true));
        const assigned = await db.query('SELECT sword_id FROM match_players WHERE match_id = $1 AND player_id = $2 AND sword_id = $3',
          [matchId, playerId, batch.swordId]);
        if (!assigned.rows[0]) throw new ApiError(403, 'sword_not_assigned', 'Use the sword assigned to your own match slot.');
        const values: unknown[] = [];
        const now = new Date().toISOString();
        const rows = batch.samples.map(({ sampleId, capturedAt, ...readings }) => {
          const start = values.length;
          values.push(sampleId ?? randomUUID(), capturedAt ?? now, matchId, playerId, batch.swordId, JSON.stringify(readings));
          return `(${Array.from({ length: 6 }, (_, i) => `$${start + i + 1}`).join(',')})`;
        });
        const result = await db.query<{ id: string; captured_at: Date }>(`INSERT INTO sword_samples
          (id, captured_at, match_id, player_id, sword_id, readings) VALUES ${rows.join(',')}
          ON CONFLICT (captured_at, id) DO NOTHING RETURNING id, captured_at`, values);
        return { accepted: result.rows.length, duplicates: batch.samples.length - result.rows.length,
          samples: result.rows.map(r => ({ sampleId: r.id, capturedAt: r.captured_at.toISOString() })) };
      });
    },
    async saveCameraSamples(subject: string, matchId: string, batch: CameraBatch) {
      return transaction(pool, async db => {
        const uploader = await actor(db, subject);
        const match = await membership(db, matchId, uploader, true);
        requireOpen(match);
        const trackedPlayer = batch.trackedPlayerId ?? uploader;
        if (trackedPlayer !== uploader && match.host_player_id !== uploader) {
          throw new ApiError(403, 'tracking_ownership', 'Only the host can upload shared-camera tracking for the other player.');
        }
        await membership(db, matchId, trackedPlayer);
        const values: unknown[] = [];
        const now = new Date().toISOString();
        const rows = batch.samples.map(({ sampleId, capturedAt, ...tracking }) => {
          const start = values.length;
          values.push(sampleId ?? randomUUID(), capturedAt ?? now, matchId, trackedPlayer, batch.cameraId, uploader, JSON.stringify(tracking));
          return `(${Array.from({ length: 7 }, (_, i) => `$${start + i + 1}`).join(',')})`;
        });
        const result = await db.query<{ id: string; captured_at: Date }>(`INSERT INTO camera_samples
          (id, captured_at, match_id, player_id, camera_id, uploaded_by_player_id, tracking) VALUES ${rows.join(',')}
          ON CONFLICT (captured_at, id) DO NOTHING RETURNING id, captured_at`, values);
        return { accepted: result.rows.length, duplicates: batch.samples.length - result.rows.length,
          samples: result.rows.map(r => ({ sampleId: r.id, capturedAt: r.captured_at.toISOString() })) };
      });
    },
    async readSamples(subject: string, matchId: string, kind: 'sword' | 'camera', page: Page) {
      await membership(pool, matchId, await actor(pool, subject));
      const table = kind === 'sword' ? 'sword_samples' : 'camera_samples';
      const result = await pool.query(`SELECT * FROM ${table} WHERE match_id = $1
        AND ($2::uuid IS NULL OR player_id = $2) ORDER BY captured_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [matchId, page.playerId ?? null, page.limit, page.offset]);
      return result.rows.map(row => ({ sampleId: row.id, capturedAt: row.captured_at.toISOString(), receivedAt: row.received_at.toISOString(),
        matchId: row.match_id, playerId: row.player_id,
        ...(kind === 'sword' ? { swordId: row.sword_id, readings: row.readings } :
          { cameraId: row.camera_id, uploadedByPlayerId: row.uploaded_by_player_id, tracking: row.tracking }) }));
    },
    async appendInput(subject: string, matchId: string, input: InputEvent) {
      return transaction(pool, async db => {
        const playerId = await actor(db, subject);
        requireOpen(await membership(db, matchId, playerId, true));
        return { id: await event(db, matchId, playerId, input.type, input), verified: false };
      });
    },
    async readEvents(subject: string, matchId: string, page: Page) {
      await membership(pool, matchId, await actor(pool, subject));
      const result = await pool.query(`SELECT * FROM match_events WHERE match_id = $1
        AND ($2::uuid IS NULL OR player_id = $2) ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [matchId, page.playerId ?? null, page.limit, page.offset]);
      return result.rows.map(row => ({ id: row.id, matchId: row.match_id, playerId: row.player_id,
        type: row.event_type, payload: row.payload, createdAt: row.created_at.toISOString() }));
    },
  };
}
export type GameStore = ReturnType<typeof createGameStore>;
