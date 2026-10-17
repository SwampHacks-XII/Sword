import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiRequestError, createApi, type Api, type Profile } from '../src/net/api';
import { createPlayerName } from '../src/net/playerName';
import { HeroNameEditor } from '../src/components/HeroNameEditor';

function fixture(initial: string | null = 'Moon Knight') {
  let player: Profile | null = initial === null ? null : { id: 'player-1', displayName: initial };
  let offline = false;
  const writes: string[] = [];
  const api = { async request(_path: string, method = 'GET', body?: { displayName: string }) {
    if (offline) throw new ApiRequestError('private diagnostic', 503);
    if (method === 'PUT') { writes.push(body!.displayName); player = { id: 'player-1', displayName: body!.displayName }; }
    if (!player) throw new ApiRequestError('Not found', 404);
    return { player: { ...player } };
  } } as Api;
  return { api, writes, offline(value: boolean) { offline = value; } };
}

const render = (editor: ReturnType<typeof createPlayerName>) => renderToStaticMarkup(createElement(HeroNameEditor, {
  profile: editor.snapshot(), busy: false, onChange: editor.change, onSave: editor.save,
  onEdit: editor.edit, onCancel: editor.cancel, onRetry: editor.load,
}));

test('a saved account name replaces the prompt, Edit restores it, and saving persists across returning sessions', async () => {
  const f = fixture(); const editor = createPlayerName(f.api, 'Auth0 nickname');
  await editor.load();
  assert.equal(editor.snapshot().savedName, 'Moon Knight');
  assert.match(render(editor), /Moon Knight/); assert.match(render(editor), />Edit</);
  assert.doesNotMatch(render(editor), /<input|Your hero’s name/);
  editor.edit(); editor.change('  Mirror Mage  ');
  assert.match(render(editor), /<input/); assert.match(render(editor), /Save name/); assert.match(render(editor), /Cancel/);
  assert.equal(await editor.save(), true);
  assert.deepEqual(f.writes, ['Mirror Mage']); assert.doesNotMatch(render(editor), /<input/);
  const returning = createPlayerName(f.api, 'Auth0 nickname'); await returning.load();
  assert.equal(returning.snapshot().savedName, 'Mirror Mage');
  assert.equal(returning.snapshot().status, 'ready');
});

test('Cancel restores the saved name without a server write', async () => {
  const f = fixture(); const editor = createPlayerName(f.api); await editor.load();
  editor.edit(); editor.change('Discard this'); editor.cancel();
  assert.equal(editor.snapshot().draft, 'Moon Knight'); assert.equal(editor.snapshot().status, 'ready');
  assert.deepEqual(f.writes, []);
});

test('first-time accounts explicitly save a name; failed loads cannot be mistaken for a new profile', async () => {
  const f = fixture(null); const editor = createPlayerName(f.api, 'New hero'); await editor.load();
  assert.equal(editor.snapshot().status, 'editing'); assert.deepEqual(f.writes, []);
  assert.match(render(editor), /Save name/); assert.doesNotMatch(render(editor), />Cancel</);
  assert.equal(await editor.save(), true); assert.deepEqual(f.writes, ['New hero']);
  f.offline(true); const returning = createPlayerName(f.api); await returning.load();
  assert.equal(returning.snapshot().status, 'error'); assert.match(render(returning), /Try again/);
  assert.doesNotMatch(render(returning), /<input|private diagnostic/);
  assert.equal(await returning.save(), false);
  f.offline(false); await returning.load(); assert.equal(returning.snapshot().savedName, 'New hero');
});

test('failed saves retain the draft and original name, and invalid names never reach the server', async () => {
  const f = fixture(); const editor = createPlayerName(f.api); await editor.load(); editor.edit();
  for (const name of ['   ', 'x'.repeat(41)]) {
    editor.change(name); assert.equal(await editor.save(), false);
  }
  assert.deepEqual(f.writes, []);
  editor.change('New name'); f.offline(true); assert.equal(await editor.save(), false);
  assert.equal(editor.snapshot().savedName, 'Moon Knight'); assert.equal(editor.snapshot().draft, 'New name');
  assert.equal(editor.snapshot().status, 'editing'); assert.doesNotMatch(render(editor), /private diagnostic/);
  f.offline(false); assert.equal(await editor.save(), true); assert.equal(editor.snapshot().savedName, 'New name');
});

test('an obsolete profile response cannot replace the next account’s name', async () => {
  let resolve!: (value: { player: Profile }) => void;
  const first = createPlayerName({ request: () => new Promise(done => { resolve = done; }) } as Api);
  const loading = first.load(); first.cancelPending();
  const second = createPlayerName(fixture('Different account').api); await second.load();
  resolve({ player: { id: 'old-account', displayName: 'Old account' } }); await loading;
  assert.equal(first.snapshot().savedName, null); assert.equal(second.snapshot().savedName, 'Different account');
});

test('guests keep a local editable name and never require an account save', async () => {
  const guest = createPlayerName(null); await guest.load(); guest.change('Guest adventurer');
  assert.equal(guest.snapshot().draft, 'Guest adventurer'); assert.equal(guest.snapshot().authenticated, false);
  assert.match(render(guest), /<input/); assert.doesNotMatch(render(guest), /Save name/);
  assert.equal(await guest.save(), false);
});

test('double-saving makes one request, and cancelling pending work ignores its late response', async () => {
  const f = fixture(); let resolve!: (value: { player: Profile }) => void; let writes = 0;
  const api = { async request(path: string, method = 'GET') {
    if (method === 'GET') return f.api.request(path);
    writes++; return new Promise(done => { resolve = done; });
  } } as Api;
  const editor = createPlayerName(api); await editor.load(); editor.edit(); editor.change('Saved later');
  const saving = editor.save(); assert.equal(await editor.save(), false); assert.equal(writes, 1);
  assert.match(render(editor), /Saving…/); editor.cancelPending();
  resolve({ player: { id: 'player-1', displayName: 'Saved later' } }); assert.equal(await saving, false);
  assert.equal(editor.snapshot().savedName, 'Moon Knight');
});

test('the API reports HTTP status so profile loading can distinguish missing accounts from outages', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Profile missing' }), { status: 404 });
  try {
    await assert.rejects(createApi(async () => 'test-token').request('/me'), error => error instanceof ApiRequestError && error.status === 404);
  } finally { globalThis.fetch = original; }
});
