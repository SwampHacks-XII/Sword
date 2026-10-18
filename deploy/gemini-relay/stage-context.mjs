import { copyFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy explicit build inputs into a fresh directory, never the checkout's secrets.
const root = fileURLToPath(new URL('../../', import.meta.url));
const destination = await mkdtemp(join(tmpdir(), 'sword-quest-build-'));
const inputs = [
  'packages/protocol/package.json', 'packages/protocol/tsconfig.json',
  'apps/server/package.json', 'apps/server/package-lock.json', 'apps/server/tsconfig.json',
  'deploy/gemini-relay/Dockerfile', 'deploy/gemini-relay/cloudbuild.yaml',
];
async function collect(relative) {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) await collect(child);
    else if (entry.isFile() && entry.name.endsWith('.ts')) inputs.push(child);
  }
}
await collect('apps/server/src');
await collect('packages/protocol/src');
for (const relative of inputs) {
  const target = join(destination, relative);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, relative), target);
}
console.log(destination);
