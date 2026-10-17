import 'dotenv/config';
import { readConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createPlayerStore } from './db/players.js';
import { createApp } from './app.js';
import { createGameStore } from './game/store.js';
import { createRealtimeHub } from './game/realtime.js';

try {
  const config = readConfig();
  const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
  const players = pool ? createPlayerStore(pool) : null;
  const game = pool ? createGameStore(pool) : null;
  const realtime = game && players && config.auth0 ? createRealtimeHub(game, players, config.webOrigin) : null;
  const app = createApp(config, players, game, realtime);
  const server = app.listen(config.port, config.host, () => {
    console.log(`Sword backend: http://${config.host}:${config.port}`);
    if (!config.auth0) console.log('Auth0 is not configured; protected routes remain unavailable.');
    if (!pool) console.log('Tiger Data is not configured; player storage remains unavailable.');
  });
  realtime?.attach(server);
  server.on('error', () => {
    console.error('Could not listen on HOST/PORT. Check whether the port is already in use.');
    void (async () => { await realtime?.close(); await pool?.end(); })();
    process.exitCode = 1;
  });
  function shutdown() {
    void (async () => {
      await realtime?.close();
      server.close(() => { void pool?.end(); });
      server.closeIdleConnections();
    })();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid server configuration.');
  process.exitCode = 1;
}
