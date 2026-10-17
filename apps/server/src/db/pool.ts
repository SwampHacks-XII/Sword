import pg from 'pg';
import { fileURLToPath } from 'node:url';

export function createPool(connectionString: string) {
  // Require TLS with certificate/hostname checks, even if the copied URL says require.
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'verify-full');
  // Keep the CA pin independent of edits to the local connection string.
  // Resolve from this module so source and compiled builds use the same file.
  if (!url.searchParams.has('sslrootcert') && url.hostname.endsWith('.tsdb.cloud.timescale.com')) {
    url.searchParams.set('sslrootcert', fileURLToPath(new URL('../../certs/tiger-ca.pem', import.meta.url)));
  }
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
  });
  pool.on('error', () => console.error('Database pool connection failed. Check your local database settings.'));
  return pool;
}
