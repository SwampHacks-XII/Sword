import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export interface Player {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}
export interface PlayerStore {
  find(subject: string): Promise<Player | null>;
  save(subject: string, displayName: string): Promise<Player>;
}
interface PlayerRow {
  id: string;
  display_name: string;
  created_at: Date;
  updated_at: Date;
}
function toPlayer(row: PlayerRow): Player {
  return { id: row.id, displayName: row.display_name, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
export function createPlayerStore(pool: Pool): PlayerStore {
  return {
    async find(subject) {
      const result = await pool.query<PlayerRow>(
        'SELECT id, display_name, created_at, updated_at FROM players WHERE auth0_sub = $1', [subject],
      );
      return result.rows[0] ? toPlayer(result.rows[0]) : null;
    },
    async save(subject, displayName) {
      const result = await pool.query<PlayerRow>(
        `INSERT INTO players (id, auth0_sub, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (auth0_sub) DO UPDATE
         SET display_name = EXCLUDED.display_name, updated_at = NOW()
         RETURNING id, display_name, created_at, updated_at`,
        [randomUUID(), subject, displayName],
      );
      if (!result.rows[0]) throw new Error('No player returned');
      return toPlayer(result.rows[0]);
    },
  };
}
