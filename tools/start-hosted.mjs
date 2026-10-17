import { spawnSync, spawn } from 'node:child_process';
import { root, hostedEnv } from './hosted-env.mjs';

const env = { ...hostedEnv, NODE_ENV: 'production', SERVE_WEB: 'true', HOST: hostedEnv.HOST || '0.0.0.0', PORT: hostedEnv.PORT || '3002' };
if (!env.PUBLIC_APP_URL && !env.RENDER_EXTERNAL_URL) throw new Error('Set PUBLIC_APP_URL in .env.hosted for a local preview. Render supplies its URL automatically.');
// Apply only pending, versioned migrations before accepting players.
const setup = spawnSync(process.execPath, ['apps/server/dist/scripts/setup-db.js'], { cwd: root, env, stdio: 'inherit' });
if (setup.error || setup.status !== 0) process.exit(setup.status || 1);
const server = spawn(process.execPath, ['apps/server/dist/index.js'], { cwd: root, env, stdio: 'inherit' });
server.on('error', () => { console.error('Could not start the hosted server.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.kill(signal));
server.on('exit', code => { process.exitCode = code ?? 0; });
