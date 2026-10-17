import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { parse } = require('dotenv');
const envFile = resolve(root, '.env.hosted');
// Actual hosting environment variables take priority over the optional local preview file.
export const hostedEnv = { ...(existsSync(envFile) ? parse(readFileSync(envFile)) : {}), ...process.env };
export function npmArgs(...args) {
  if (!process.env.npm_execpath) throw new Error('Run this helper through npm from the repository root.');
  return [process.env.npm_execpath, ...args];
}
