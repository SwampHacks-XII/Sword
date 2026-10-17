import pg from 'pg';

export function createPool(connectionString: string) {
  // Require TLS with certificate/hostname checks, even if the copied URL says require.
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'verify-full');
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
