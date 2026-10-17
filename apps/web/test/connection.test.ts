import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createConnection } from '../src/net/connection';
import type { Api } from '../src/net/api';
import type { ServerMessage } from '@sword/protocol';
import { GameRules, getSpell } from '@sword/protocol';
import { resolveApiBaseUrl } from '../src/net/api';

const originalSocket = globalThis.WebSocket;
class PracticeSocket {
  static OPEN = 1;
  static instances: PracticeSocket[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string | URL) {
    PracticeSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  deliver(message: unknown) { queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) })); }
  send(raw: string) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.type === 'session.auth') this.deliver({ type: 'session.ready' });
    if (message.type === 'room.subscribe') {
      this.deliver({ type: 'lobby.state', lobby: { you: 'p1', code: '0017', players: [{ slot: 'p1', name: 'Alice', connected: true }] } });
      this.deliver({ type: 'room.ready' });
    }
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; queueMicrotask(() => this.onclose?.({ code: 1000 })); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
}
globalThis.WebSocket = PracticeSocket as unknown as typeof WebSocket;
after(() => { globalThis.WebSocket = originalSocket; });

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Expected connection state was not reached.');
    await pause(10);
  }
}
function fixture() {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  let failTicketOnce = false;
  const api: Api = {
    async request<T>(path: string, method?: string, body?: unknown): Promise<T> {
      calls.push({ path, method, body });
      if (path === '/realtime-ticket') {
        if (failTicketOnce) { failTicketOnce = false; throw new Error('Temporary outage'); }
        return { ticket: 'private-test-ticket' } as T;
      }
      return { match: { id: '11111111-1111-4111-8111-111111111111' } } as T;
    },
  };
  const connection = createConnection(api);
  const messages: ServerMessage[] = [];
  connection.subscribe(message => messages.push(message));
  return { connection, messages, calls, failTicket: () => { failTicketOnce = true; } };
}

test('Swamp Bot works without authentication or any API calls', async () => {
  const f = fixture();
  try {
    f.connection.send({ type: 'lobby.create', name: 'Offline player', mode: 'bot' });
    await until(() => f.messages.some(m => m.type === 'lobby.state' && m.lobby?.players.length === 2));
    assert.equal(f.connection.kind, 'mock');
    assert.equal(f.calls.length, 0);
    assert.equal(f.messages.some(m => m.type === 'lobby.state' && m.lobby?.mode === 'bot'
      && m.lobby.players.some(p => p.name === 'Swamp Bot')), true);
  } finally { f.connection.close(); }
});

test('online create saves the name, authenticates the socket, and leaving calls the server', async () => {
  const f = fixture();
  try {
    f.connection.send({ type: 'lobby.create', name: 'Alice', mode: 'online' });
    await until(() => f.connection.status() === 'open');
    assert.equal(f.connection.kind, 'ws');
    assert.deepEqual(f.calls.slice(0, 3), [
      { path: '/me', method: 'PUT', body: { displayName: 'Alice' } },
      { path: '/matches', method: 'POST', body: {} },
      { path: '/realtime-ticket', method: 'POST', body: undefined },
    ]);
    assert.equal(f.messages.some(m => m.type === 'lobby.state' && m.lobby?.mode === 'online'), true);
    assert.equal(f.messages.some(m => m.type === 'lobby.state' && m.lobby?.players.some(p => p.name === 'Swamp Bot')), false);
    f.connection.send({ type: 'lobby.leave' });
    await until(() => f.calls.some(c => c.path.endsWith('/leave')));
    assert.equal(f.messages.some(m => m.type === 'lobby.state' && m.lobby === null), true);
  } finally { f.connection.close(); }
});

test('Swamp Bot waits at the story briefing until the player accepts the quest', async () => {
  const f = fixture();
  try {
    f.connection.send({ type: 'lobby.create', name: 'Story hero', mode: 'bot' });
    await until(() => f.messages.some(m => m.type === 'lobby.state' && m.lobby?.players.length === 2));
    f.connection.send({ type: 'quest.begin' });
    await until(() => f.messages.some(m => m.type === 'quest.state' && m.quest?.accepted.includes('p2') === true));
    assert.equal(f.messages.some(m => m.type === 'match.state' && m.match), false);
    f.connection.send({ type: 'match.start' });
    await pause(40);
    assert.equal(f.messages.some(m => m.type === 'match.state' && m.match), false);
    f.connection.send({ type: 'quest.accept' });
    await until(() => f.messages.some(m => m.type === 'match.state' && m.match?.phase === 'fighting'));
    assert.equal(f.messages.filter(m => m.type === 'quest.state').at(-1)?.quest, null);
    assert.equal(f.calls.length, 0);
  } finally { f.connection.close(); }
});

test('online join uses the supplied room code and reconnects after a temporary API outage', async () => {
  const f = fixture();
  try {
    f.connection.send({ type: 'lobby.join', name: 'Bob', code: '0017' });
    await until(() => f.connection.status() === 'open');
    assert.deepEqual(f.calls.find(c => c.path === '/matches/join')?.body, { joinCode: '0017' });
    assert.equal(f.calls.some(c => c.path === '/matches'), false);
    f.failTicket();
    PracticeSocket.instances.at(-1)!.drop();
    await until(() => f.connection.status() === 'open');
    assert.equal(f.calls.filter(c => c.path === '/realtime-ticket').length, 3);
  } finally { f.connection.close(); }
});

test('hosted API follows the website origin while local development keeps its existing default', () => {
  assert.equal(resolveApiBaseUrl('same-origin', 'https://sword.onrender.com'), 'https://sword.onrender.com');
  assert.equal(resolveApiBaseUrl(), 'http://localhost:3001');
  assert.equal(resolveApiBaseUrl('http://192.168.1.50:3001/'), 'http://192.168.1.50:3001');
});

test('Swamp Bot rules return to the same lobby after a round and start with fresh health', () => {
  const messages: ServerMessage[] = [];
  const rules = new GameRules(message => messages.push(message), () => 1000);
  rules.openLobby('0017', 'p1', 'Alice'); rules.addPlayer('p2', 'Swamp Bot');
  rules.startMatch();
  assert.equal(rules.returnToLobby(), false);
  for (let i = 0; i < 200 && rules.snapshot()?.phase !== 'over'; i++) {
    const spell = getSpell(rules.snapshot()!.fighters.p1.spellId);
    for (const color of spell.combo) rules.handleSword({ type: 'sword.button', swordId: 'sword-1', color });
    rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: spell.gesture });
    const shotId = `test-${i}`;
    if (rules.handleSword({ type: 'sword.trigger', swordId: 'sword-1', shotId }) === 'fired') {
      rules.handleSword({ type: 'sword.hit', attackerSwordId: 'sword-1', victimSwordId: 'sword-2', shotId });
    }
  }
  assert.equal(rules.snapshot()?.phase, 'over');
  assert.equal(rules.returnToLobby(), true);
  const lobby = messages.filter(m => m.type === 'lobby.state').at(-1);
  assert.equal(lobby?.type === 'lobby.state' && lobby.lobby?.code, '0017');
  assert.equal(lobby?.type === 'lobby.state' && lobby.lobby?.players[1]?.name, 'Swamp Bot');
  assert.equal(rules.snapshot(), null);
  rules.startMatch();
  assert.equal(rules.snapshot()?.fighters.p1.hp, 100); assert.equal(rules.snapshot()?.fighters.p2.hp, 100);
});
