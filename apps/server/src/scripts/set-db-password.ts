import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import dotenv from 'dotenv';

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run npm run db:set-password in an interactive terminal.');
  }
  const path = new URL('../../.env', import.meta.url);
  const original = await readFile(path, 'utf8');
  const value = dotenv.parse(original).DATABASE_URL;
  let database: URL;
  try { database = new URL(value ?? ''); }
  catch { throw new Error('Set a valid DATABASE_URL in apps/server/.env first.'); }
  const assignments = original.match(/^[ \t]*(?:export[ \t]+)?DATABASE_URL[ \t]*=[^\r\n]*/gm) ?? [];
  if (assignments.length !== 1) throw new Error('Expected exactly one DATABASE_URL assignment in .env.');

  // readline puts a real terminal into raw mode; discarded output hides typed
  // and pasted characters. Do not keep readline history for password input.
  const hiddenOutput = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const prompt = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true, historySize: 0 });
  process.stdout.write('New database service password (hidden; Enter to save, Ctrl+C to cancel): ');
  let password: string;
  try {
    password = await new Promise<string>((resolve, reject) => {
      prompt.once('SIGINT', () => reject(new Error('Cancelled; .env was not changed.')));
      prompt.once('close', () => reject(new Error('Input closed; .env was not changed.')));
      prompt.question('', resolve);
    });
  } finally {
    prompt.close();
    hiddenOutput.end();
    process.stdout.write('\n');
  }
  if (password.length === 0) throw new Error('Empty password; .env was not changed.');
  database.password = encodeURIComponent(password);
  const updated = original.replace(/^([ \t]*(?:export[ \t]+)?DATABASE_URL[ \t]*=)[^\r\n]*/m,
    (_line, prefix: string) => `${prefix}"${database.href}"`);
  await writeFile(path, updated, 'utf8');
  console.log('Database password updated privately in .env. Run npm run db:check next.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Could not update local database settings.');
  process.exitCode = 1;
});
