import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOSS_COMMAND_REPLIES, isPublicMossLine } from '@sword/protocol';
import { parseMossCommand, planLobbyCommand } from '../src/story/commands';
import { createCommandListener, type CommandRecognition } from '../src/story/commandRecognition';
import { createConnection } from '../src/net/connection';
import type { Api } from '../src/net/api';
import type { ServerMessage } from '@sword/protocol';

test('Moss recognizes one supported game command, including spoken leading-zero room codes', () => {
  assert.deepEqual(parseMossCommand('Hey, Moss! Create a new game.'), { ok: true, command: { kind: 'create', mode: 'online' } });
  assert.deepEqual(parseMossCommand('Please play with Swamp Bot'), { ok: true, command: { kind: 'create', mode: 'bot' } });
  for (const [words, code] of [
    ['Hey Moss, join room code zero one two three', '0123'],
    ['Join room with code 0012', '0012'],
    ['Moss, join game one two three four please', '1234'],
    ['Join room code one to three for', '1234'],
    ['join room code 12 34', '1234'],
  ]) assert.deepEqual(parseMossCommand(words!), { ok: true, command: { kind: 'join', code } });
});

test('incomplete, ambiguous and multiple commands never become actions', () => {
  for (const words of ['join', 'join room code 123', 'join room 12345', 'join room twelve thirty four', 'join room 1234 then create a game']) {
    assert.deepEqual(parseMossCommand(words), { ok: false, reason: 'code' });
  }
  for (const words of ['delete my account', 'create a new game and join 1234', '', 'x'.repeat(201)]) {
    assert.deepEqual(parseMossCommand(words), { ok: false, reason: 'unknown' });
  }
});

test('voice uses the same lobby messages and requires the same login, name and busy checks as buttons', () => {
  const player = { name: ' Hero ', pending: false, onlineAllowed: true };
  const joined = planLobbyCommand({ kind: 'join', code: '0123' }, player);
  assert.deepEqual(joined, { ok: true, message: { type: 'lobby.join', name: 'Hero', code: '0123' }, reply: 'Got it! I’m joining room 0, 1, 2, 3.' });
  assert.deepEqual(planLobbyCommand({ kind: 'create', mode: 'online' }, player), {
    ok: true, message: { type: 'lobby.create', name: 'Hero', mode: 'online' }, reply: MOSS_COMMAND_REPLIES.create,
  });
  assert.equal(planLobbyCommand({ kind: 'create', mode: 'bot' }, { ...player, onlineAllowed: false }).ok, true);
  for (const command of [{ kind: 'create', mode: 'online' }, { kind: 'join', code: '0123' }] as const) {
    assert.deepEqual(planLobbyCommand(command, { ...player, onlineAllowed: false }), { ok: false, reply: MOSS_COMMAND_REPLIES.login });
    assert.deepEqual(planLobbyCommand(command, { ...player, pending: true }), { ok: false, reply: MOSS_COMMAND_REPLIES.busy });
    assert.deepEqual(planLobbyCommand(command, { ...player, name: ' ' }), { ok: false, reply: MOSS_COMMAND_REPLIES.name });
  }
  assert.equal(planLobbyCommand({ kind: 'join', code: '12345' }, player).ok, false);
  for (const line of Object.values(MOSS_COMMAND_REPLIES)) assert.equal(isPublicMossLine(line), true);
});

function recognitionFixture(timeoutMs = 1000) {
  const engines: CommandRecognition[] = [];
  const transcripts: string[] = [];
  const errors: string[] = [];
  const states: boolean[] = [];
  let starts = 0; let aborts = 0;
  const listener = createCommandListener(() => {
    const engine: CommandRecognition = { lang: '', continuous: true, interimResults: true, maxAlternatives: 5,
      onresult: null, onerror: null, onend: null,
      start() { starts++; }, abort() { aborts++; },
    };
    engines.push(engine); return engine;
  }, { listening: value => states.push(value), transcript: text => transcripts.push(text), error: text => errors.push(text) }, timeoutMs);
  const result = (text: string, isFinal = true) => ({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  return { listener, engines, transcripts, errors, states, result, starts: () => starts, aborts: () => aborts };
}

test('one click accepts one final command, releasing the mic before the action and ignoring duplicate results', () => {
  const f = recognitionFixture();
  f.listener.start(); f.listener.start();
  assert.equal(f.starts(), 1);
  const engine = f.engines[0]!;
  assert.equal(engine.lang, 'en-US'); assert.equal(engine.continuous, false); assert.equal(engine.interimResults, false);
  const handler = engine.onresult!;
  handler(f.result('create a game', false));
  assert.deepEqual(f.transcripts, []);
  handler(f.result('create a game'));
  handler(f.result('create a game'));
  assert.deepEqual(f.transcripts, ['create a game']);
  assert.deepEqual(f.states, [true, false]); assert.equal(f.aborts(), 1);
  assert.equal(engine.onresult, null);
  assert.deepEqual(f.errors, []);
});

test('stopping or leaving the page prevents late results from triggering another room action', () => {
  const f = recognitionFixture();
  f.listener.start();
  const oldResult = f.engines[0]!.onresult!;
  f.listener.stop(); f.listener.start();
  oldResult(f.result('create a game'));
  assert.deepEqual(f.transcripts, []);
  f.engines[1]!.onresult!(f.result('join room 1234'));
  assert.deepEqual(f.transcripts, ['join room 1234']);
});

test('permission, network and silence failures stop listening without running a command', async () => {
  for (const code of ['not-allowed', 'network', 'audio-capture']) {
    const f = recognitionFixture(); f.listener.start(); f.engines[0]!.onerror!({ error: code });
    assert.deepEqual(f.transcripts, []); assert.equal(f.errors.length, 1); assert.equal(f.states.at(-1), false);
    assert.equal(f.engines[0]!.onend, null);
  }
  const f = recognitionFixture(10); f.listener.start();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(f.transcripts, []); assert.match(f.errors[0]!, /didn’t hear/); assert.equal(f.aborts(), 1);
  const thrown: string[] = [];
  const listener = createCommandListener(() => { throw new Error('Unavailable'); }, {
    listening() {}, transcript() { assert.fail('Must not run a command'); }, error: text => thrown.push(text),
  });
  listener.start(); assert.equal(thrown.length, 1);
});

test('a recognized bot command opens one existing practice lobby through the real connection adapter', async () => {
  const received: ServerMessage[] = [];
  const connection = createConnection({ request: async () => { assert.fail('Guest bot commands must not call an API'); } } as Api);
  connection.subscribe(message => received.push(message));
  const engine: CommandRecognition = { lang: '', continuous: true, interimResults: true, maxAlternatives: 5,
    onresult: null, onerror: null, onend: null, start() {}, abort() {},
  };
  const input = createCommandListener(() => engine, {
    listening() {}, error: message => assert.fail(message),
    transcript: text => {
      const parsed = parseMossCommand(text); assert.ok(parsed.ok);
      const plan = planLobbyCommand(parsed.command, { name: 'Hero', pending: false, onlineAllowed: false });
      assert.ok(plan.ok); connection.send(plan.message);
    },
  });
  try {
    input.start();
    const result = engine.onresult!;
    const speech = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Hey Moss, play with Swamp Bot' } }] };
    result(speech); result(speech);
    await new Promise(resolve => setTimeout(resolve, 50));
    const lobbies = received.filter(message => message.type === 'lobby.state' && message.lobby);
    assert.equal(lobbies.length, 1);
    const joined = lobbies[0]!;
    assert.equal(joined.type, 'lobby.state');
    if (joined.type === 'lobby.state') {
      assert.equal(joined.lobby?.mode, 'bot');
      assert.equal(joined.lobby?.players.find(player => player.slot === joined.lobby!.you)?.name, 'Hero');
    }
  } finally { input.stop(); connection.close(); }
});
