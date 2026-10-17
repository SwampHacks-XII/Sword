import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { root } from './hosted-env.mjs';
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));

// A temporary test CA validates HTTPS/WSS locally without weakening TLS checks.
const tempRoot = realpathSync(tmpdir());
const folder = mkdtempSync(join(tempRoot, 'sword-hosted-test-'));
try {
  const bundledOpenSsl = join(process.env.ProgramFiles || 'C:/Program Files', 'Git/usr/bin/openssl.exe');
  const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' && existsSync(bundledOpenSsl) ? bundledOpenSsl : 'openssl');
  const cert = join(folder, 'cert.pem'); const key = join(folder, 'key.pem');
  const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { encoding: 'utf8' });
  if (generated.error || generated.status !== 0) throw new Error('HTTPS tests need OpenSSL. Set OPENSSL_PATH if it is not on PATH.');
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--test', 'test/game.test.ts'], {
    cwd: join(root, 'apps/server'), stdio: 'inherit',
    env: { ...process.env, GAME_TEST_CERT: cert, GAME_TEST_KEY: key,
      GAME_TEST_DATABASE: process.argv.includes('--database') ? '1' : '0' },
  });
  if (result.error || result.status !== 0) process.exitCode = result.status || 1;
} finally {
  const resolvedFolder = realpathSync(folder);
  if (dirname(resolvedFolder) !== tempRoot || !basename(resolvedFolder).startsWith('sword-hosted-test-')) {
    throw new Error('Refusing to clean an unexpected test path.');
  }
  rmSync(folder, { recursive: true, force: true });
}
