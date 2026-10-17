import 'dotenv/config';
import { readConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { databaseErrorMessage } from '../db/errors.js';

const config = readConfig();
if (!config.databaseUrl) throw new Error('Set DATABASE_URL in apps/server/.env first.');
const pool = createPool(config.databaseUrl);
try {
  await pool.query('SELECT 1');
  console.log('Database connection succeeded.');
} catch (error) {
  console.error(databaseErrorMessage(error));
  process.exitCode = 1;
} finally { await pool.end(); }
