import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createConnection } from '../src/net/connection';
import type { Api } from '../src/net/api';
import type { ServerMessage } from '@sword/protocol';

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
      this.deliver({ type: 'lobby.state', lobby: { you: 'p1', code: 'ABCDEF123456', players: [{ slot: 'p1', name: 'Alice', connected: true }] } });
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

test('online join uses the supplied room code and reconnects after a temporary API outage', async () => {
  const f = fixture();
  try {
    f.connection.send({ type: 'lobby.join', name: 'Bob', code: 'ABCDEF123456' });
    await until(() => f.connection.status() === 'open');
    assert.deepEqual(f.calls.find(c => c.path === '/matches/join')?.body, { joinCode: 'ABCDEF123456' });
    assert.equal(f.calls.some(c => c.path === '/matches'), false);
    f.failTicket();
    PracticeSocket.instances.at(-1)!.drop();
    await until(() => f.connection.status() === 'open');
    assert.equal(f.calls.filter(c => c.path === '/realtime-ticket').length, 3);
  } finally { f.connection.close(); }
});
