import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';

export async function migrate(pool: Pool): Promise<string[]> {
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sword-schema-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const applied = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
    const existing = new Map(applied.rows.map(row => [row.version, row.checksum]));
    const added: string[] = [];
    for (const name of files) {
      const originalSql = await readFile(new URL(name, directory), 'utf8');
      // Git can change line endings on Windows; that must not change migration identity.
      const sql = originalSql.replace(/\r\n/g, '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (existing.has(name)) {
        if (existing.get(name) !== checksum) {
          const legacyChecksum = createHash('sha256').update(sql.replace(/\n/g, '\r\n')).digest('hex');
          if (existing.get(name) !== legacyChecksum) throw new Error('An applied migration changed. Restore it and add a new migration instead.');
          await client.query('UPDATE schema_migrations SET checksum = $2 WHERE version = $1', [name, checksum]);
        }
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [name, checksum]);
      added.push(name);
    }
    await client.query('COMMIT');
    return added;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
