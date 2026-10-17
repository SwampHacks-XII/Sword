import 'dotenv/config';
import { readConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { databaseErrorMessage } from '../db/errors.js';
import { migrate } from '../db/migrate.js';

const config = readConfig();
if (!config.databaseUrl) throw new Error('Set DATABASE_URL in apps/server/.env first.');
const pool = createPool(config.databaseUrl);
try {
  const added = await migrate(pool);
  console.log(added.length ? `Database ready. Applied: ${added.join(', ')}. Existing rows were preserved.` : 'Database is already up to date.');
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('An applied migration changed.')
    ? error.message : databaseErrorMessage(error));
  process.exitCode = 1;
} finally { await pool.end(); }
