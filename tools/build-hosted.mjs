import { spawnSync } from 'node:child_process';
import { root, hostedEnv, npmArgs } from './hosted-env.mjs';

for (const name of ['VITE_AUTH0_DOMAIN', 'VITE_AUTH0_CLIENT_ID', 'VITE_AUTH0_AUDIENCE']) {
  if (!hostedEnv[name]) throw new Error(`Set ${name} in the hosting environment or root .env.hosted.`);
}
for (const [project, args] of [
  ['apps/server', []],
  ['apps/web', ['--', '--outDir', 'dist-hosted', '--mode', 'hosted']],
]) {
  const result = spawnSync(process.execPath, npmArgs('run', 'build', '--prefix', project, ...args), {
    cwd: root, stdio: 'inherit', env: { ...hostedEnv, VITE_API_BASE_URL: 'same-origin' },
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
