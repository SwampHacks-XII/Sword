import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { readConfig } from '../config.js';
import { createPool } from '../db/pool.js';

const config = readConfig();
if (!config.databaseUrl) throw new Error('Set DATABASE_URL in apps/server/.env first.');
const pool = createPool(config.databaseUrl);
try {
  const sql = await readFile(new URL('../../migrations/001_players.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Players table is ready. Existing rows were preserved.');
} catch {
  console.error('Database setup failed. Check connection details and table-creation permissions.');
  process.exitCode = 1;
} finally { await pool.end(); }
