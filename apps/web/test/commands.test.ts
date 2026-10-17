import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOSS_COMMAND_REPLIES, isPublicMossLine } from '@sword/protocol';
import { parseMossCommand, planLobbyCommand, parseMossLobbyCommand, planLobbyControl } from '../src/story/commands';
import { createCommandListener, type CommandRecognition } from '../src/story/commandRecognition';
import { createConnection } from '../src/net/connection';
import type { Api } from '../src/net/api';
import type { ServerMessage, LobbyState } from '@sword/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MossCommandInput } from '../src/components/MossCommandInput';
import { createCommandFeedback } from '../src/story/commandFeedback';
import { executeMenuExit } from '../src/story/menuExit';
import { ConnectionContext } from '../src/hooks/useConnection';
import { MatchProvider, useMatch } from '../src/hooks/useMatch';
import { lobbySpread, useLobbyControls } from '../src/components/LobbyPages';

/** Renders both pages of the storybook's lobby spread, the way Storybook builds them. */
function LobbyPages({ lobby, onVoiceReply, stopVoice }: { lobby: LobbyState; onVoiceReply(text: string): Promise<boolean>; stopVoice(): void }) {
  const spread = lobbySpread(lobby, useMatch(), useLobbyControls(lobby, { onVoiceReply, stopVoice }));
  return createElement('div', null, spread.left.content, spread.right.content);
}
import { createMossNarrator } from '../src/story/elevenLabsNarration';

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

test('game selection understands sign-out and leave commands, rejecting combined or negative requests', () => {
  for (const words of ['Hey Moss, sign out', 'Log me out', 'Please log out', 'Can you sign out of the game?']) {
    assert.deepEqual(parseMossCommand(words), { ok: true, command: { kind: 'signout' } }, words);
  }
  for (const words of ['Hey Moss, leave game', 'Leave the game', 'Exit this game please']) {
    assert.deepEqual(parseMossCommand(words), { ok: true, command: { kind: 'leave' } }, words);
  }
  for (const words of ['do not sign out', 'sign out and create a game', 'leave game then join room 1234']) {
    assert.equal(parseMossCommand(words).ok, false, words);
  }
});

test('menu exits acknowledge before navigation; only authenticated sign-out calls Auth0 logout', async () => {
  for (const authenticated of [true, false]) {
    for (const kind of ['signout', 'leave'] as const) {
      const calls: string[] = [];
      let finishReply!: (value: boolean) => void;
      const result = executeMenuExit({ kind }, {
        authenticated,
        reply: async text => { calls.push(text); return new Promise(resolve => { finishReply = resolve; }); },
        logout: async () => { calls.push('logout'); }, navigate: page => { calls.push(page); },
      });
      assert.deepEqual(calls, [kind === 'leave' ? MOSS_COMMAND_REPLIES.leaveGame
        : authenticated ? MOSS_COMMAND_REPLIES.signOut : MOSS_COMMAND_REPLIES.guestSignOut]);
      finishReply(true); assert.equal(await result, 'done');
      assert.equal(calls[1], kind === 'leave' ? 'home' : authenticated ? 'logout' : 'login');
      assert.equal(calls.length, 2);
    }
  }
});

test('cancelled speech does not navigate, and logout failures receive safe spoken feedback', async () => {
  assert.equal(await executeMenuExit({ kind: 'signout' }, {
    authenticated: true, reply: async () => false,
    logout: async () => assert.fail('Cancelled action must not log out'), navigate: () => assert.fail('Cancelled action must not navigate'),
  }), 'cancelled');
  const replies: string[] = [];
  assert.equal(await executeMenuExit({ kind: 'signout' }, {
    authenticated: true, reply: async text => { replies.push(text); return true; },
    logout: async () => { throw new Error('private provider diagnostic'); }, navigate: () => assert.fail('No navigation on failure'),
  }), 'failed');
  assert.deepEqual(replies, [MOSS_COMMAND_REPLIES.signOut, MOSS_COMMAND_REPLIES.signOutFailed]);
});

test('a command acknowledgement finishes before its action, ignoring the narrator’s initial reset', async () => {
  const captions: string[] = [];
  const feedback = createCommandFeedback({
    speak() { feedback.stateChanged('idle'); feedback.stateChanged('loading'); },
    stop() {}, show: text => captions.push(text),
  });
  let done = false;
  const reply = feedback.speak('Starting your quest!').then(value => { done = true; return value; });
  await Promise.resolve(); assert.equal(done, false);
  feedback.stateChanged('speaking'); await Promise.resolve(); assert.equal(done, false);
  feedback.stateChanged('idle'); assert.equal(await reply, true);
  assert.deepEqual(captions, ['Starting your quest!']); feedback.stop();
});

test('replaced or stopped feedback cancels its pending action, while unavailable audio and timeouts release it', async () => {
  const feedback = createCommandFeedback({ speak() {}, stop() {}, show() {} }, 10);
  const old = feedback.speak('First command'); const current = feedback.speak('Second command');
  assert.equal(await old, false); feedback.stop(); assert.equal(await current, false);
  const unavailable = feedback.speak('Audio unavailable'); feedback.stateChanged('unavailable'); assert.equal(await unavailable, true);
  assert.equal(await feedback.speak('Slow audio'), true);
  feedback.stop();
});

test('browser backup finishes its acknowledgement before navigation, including while muted', async () => {
  for (const muted of [false, true]) {
    const spoken: SpeechSynthesisUtterance[] = [];
    const synth = { getVoices: () => [], cancel() {}, speak: (words: SpeechSynthesisUtterance) => spoken.push(words) } as unknown as SpeechSynthesis;
    const narrator = createMossNarrator(synth, text => ({ text }) as SpeechSynthesisUtterance,
      state => feedback.stateChanged(state), {
        load: async () => { throw new Error('No provider credits'); },
        makeAudio: () => { throw new Error('Must use browser backup'); }, createUrl: () => '', revokeUrl() {},
      });
    const feedback = createCommandFeedback({ speak: text => narrator.speak(text), stop: () => narrator.stop(), show() {} });
    narrator.setMuted(muted);
    let done = false;
    const reply = feedback.speak(MOSS_COMMAND_REPLIES.signOut).then(result => { done = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(spoken.length, 1); assert.equal(done, false);
    assert.equal(spoken[0]!.volume, muted ? 0 : 1);
    spoken[0]!.onend?.call(spoken[0]!, {} as SpeechSynthesisEvent);
    assert.equal(await reply, true); feedback.stop();
  }
});

test('online and guest lobby pages both render Talk to Moss beside quest controls', () => {
  const connection = createConnection({ request: async () => assert.fail('Rendering needs no API') } as Api);
  try {
    for (const mode of ['online', 'bot'] as const) {
      const lobby: LobbyState = { mode, code: '0123', you: 'p1', players: [] };
      const html = renderToStaticMarkup(createElement(ConnectionContext, { value: {
        connection, poses: { p1: [1, 0, 0, 0], p2: [1, 0, 0, 0] },
      } }, createElement(MatchProvider, { children: createElement(LobbyPages, {
        lobby, onVoiceReply: async () => true, stopVoice() {},
      }) })));
      assert.match(html, /Talk to Moss/); assert.match(html, /Heard: /);
      assert.match(html, /Start my quest/);
    }
  } finally { connection.close(); }
});

test('guest bot requests accept conversational phrasing without becoming online commands', () => {
  for (const transcript of [
    'Hey Moss, can you play with SwampBot?', 'Moss, I want to play with Swamp Bot.',
    'Please Moss, play with Swampbot.', 'Hey Moss, let’s play against Swamp Bot!',
    'Could you please start a game with Swamp Bot?', 'I would like to play with Swamp Bot please.',
    'Hey Moss, play SwampBot.', 'Play with the bot.',
  ]) {
    const parsed = parseMossCommand(transcript);
    assert.deepEqual(parsed, { ok: true, command: { kind: 'create', mode: 'bot' } }, transcript);
    assert.ok(parsed.ok);
    const plan = planLobbyCommand(parsed.command, { name: 'Guest', pending: false, onlineAllowed: false });
    assert.ok(plan.ok, transcript);
    assert.deepEqual(plan.message, { type: 'lobby.create', name: 'Guest', mode: 'bot' });
  }
  for (const transcript of ['Can you play with Swamp Bot and create a game?', 'Play with Swampbot then join room 1234', 'I want to delete my account']) {
    assert.equal(parseMossCommand(transcript).ok, false, transcript);
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

test('lobby commands start the current quest or leave, without creating or switching rooms', () => {
  for (const words of ['Hey Moss, start my quest!', 'Begin our adventure', 'Can you please start the game?', 'Let’s begin the quest']) {
    assert.deepEqual(parseMossLobbyCommand(words), { kind: 'begin' }, words);
  }
  for (const words of ['Hey Moss, leave the room', 'Exit this lobby please', 'Could you leave my game?']) {
    assert.deepEqual(parseMossLobbyCommand(words), { kind: 'leave' }, words);
  }
  for (const words of ['create a new game', 'join room 1234', 'play with Swamp Bot', 'start my quest and leave the room', '', 'x'.repeat(201)]) {
    assert.equal(parseMossLobbyCommand(words), null, words);
  }
});

test('lobby voice shares the host, player-readiness, connection and busy checks with the buttons', () => {
  const lobby: LobbyState = { mode: 'online', code: '0123', you: 'p1', players: [
    { slot: 'p1', name: 'Hero', swordId: 'sword-1', connected: true },
    { slot: 'p2', name: 'Rival', swordId: 'sword-2', connected: true },
  ] };
  const context = { lobby, pending: false, onlineStatus: 'open' as const };
  assert.deepEqual(planLobbyControl({ kind: 'begin' }, context), {
    ok: true, message: { type: 'quest.begin' }, reply: MOSS_COMMAND_REPLIES.startQuest,
  });
  assert.deepEqual(planLobbyControl({ kind: 'begin' }, { ...context, lobby: { ...lobby, you: 'p2' } }), {
    ok: false, reply: MOSS_COMMAND_REPLIES.hostOnly,
  });
  assert.deepEqual(planLobbyControl({ kind: 'begin' }, { ...context, lobby: { ...lobby, players: lobby.players.slice(0, 1) } }), {
    ok: false, reply: MOSS_COMMAND_REPLIES.waitForRival,
  });
  assert.deepEqual(planLobbyControl({ kind: 'begin' }, { ...context, lobby: { ...lobby, players: lobby.players.map(player => ({ ...player, connected: player.slot === 'p1' })) } }), {
    ok: false, reply: MOSS_COMMAND_REPLIES.waitForRival,
  });
  for (const status of ['closed', 'connecting'] as const) {
    assert.deepEqual(planLobbyControl({ kind: 'begin' }, { ...context, onlineStatus: status }), {
      ok: false, reply: MOSS_COMMAND_REPLIES.reconnecting,
    });
    assert.equal(planLobbyControl({ kind: 'leave' }, { ...context, onlineStatus: status }).ok, true);
  }
  for (const kind of ['begin', 'leave'] as const) {
    assert.deepEqual(planLobbyControl({ kind }, { ...context, pending: true }), { ok: false, reply: MOSS_COMMAND_REPLIES.lobbyBusy });
  }
  assert.equal(planLobbyControl({ kind: 'begin' }, { ...context, lobby: { ...lobby, mode: 'bot' }, onlineStatus: 'closed' }).ok, true);
  assert.deepEqual(planLobbyControl({ kind: 'leave' }, { ...context, lobby: { ...lobby, you: 'p2' } }), {
    ok: true, message: { type: 'lobby.leave' }, reply: MOSS_COMMAND_REPLIES.leaveRoom,
  });
});

test('a guest can use lobby voice to reach the briefing without skipping quest acceptance', async () => {
  const messages: ServerMessage[] = [];
  const view = { lobby: null as LobbyState | null };
  const connection = createConnection({ request: async () => { assert.fail('Guest lobby commands must not need authentication'); } } as Api);
  connection.subscribe(message => { messages.push(message); if (message.type === 'lobby.state') view.lobby = message.lobby; });
  const engine: CommandRecognition = { lang: '', continuous: false, interimResults: false, maxAlternatives: 1,
    onresult: null, onerror: null, onend: null, start() {}, abort() {},
  };
  const input = createCommandListener(() => engine, {
    listening() {}, error: message => assert.fail(message),
    transcript: text => {
      const command = parseMossLobbyCommand(text); assert.ok(command); assert.ok(view.lobby);
      const plan = planLobbyControl(command, { lobby: view.lobby, pending: false, onlineStatus: 'closed' });
      assert.ok(plan.ok); connection.send(plan.message);
    },
  });
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'Expected guest lobby/quest state');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    connection.send({ type: 'lobby.create', name: 'Guest', mode: 'bot' });
    await until(() => view.lobby?.players.length === 2);
    const code = view.lobby!.code;
    input.start();
    const final = engine.onresult!;
    const event = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Hey Moss, start my quest' } }] };
    final(event); final(event);
    await until(() => messages.some(message => message.type === 'quest.state' && !!message.quest?.story));
    assert.equal(view.lobby!.code, code);
    assert.equal(messages.filter(message => message.type === 'quest.state' && !!message.quest?.story).length, 1);
    assert.equal(messages.some(message => message.type === 'match.state' && !!message.match), false);
    const leave = parseMossLobbyCommand('Moss, leave the room'); assert.ok(leave);
    const plan = planLobbyControl(leave, { lobby: view.lobby!, pending: false, onlineStatus: 'closed' });
    assert.ok(plan.ok); connection.send(plan.message);
    await until(() => view.lobby === null);
  } finally { input.stop(); connection.close(); }
});

function recognitionFixture(timeoutMs = 1000, startsService = true) {
  const engines: CommandRecognition[] = [];
  const transcripts: string[] = [];
  const errors: string[] = [];
  const states: boolean[] = [];
  const previews: string[] = [];
  let serviceStarts = 0;
  let starts = 0; let aborts = 0;
  const listener = createCommandListener(() => {
    const engine: CommandRecognition = { lang: '', continuous: true, interimResults: true, maxAlternatives: 5,
      onresult: null, onerror: null, onend: null,
      start() { starts++; if (startsService) engine.onstart?.(); }, abort() { aborts++; },
    };
    engines.push(engine); return engine;
  }, { listening: value => states.push(value), started: () => { serviceStarts++; }, preview: text => previews.push(text),
    transcript: text => transcripts.push(text), error: text => errors.push(text) }, timeoutMs);
  const result = (text: string, isFinal = true) => ({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  return { listener, engines, transcripts, errors, states, previews, result, starts: () => starts, serviceStarts: () => serviceStarts, aborts: () => aborts };
}

test('one click accepts one final command, releasing the mic before the action and ignoring duplicate results', () => {
  const f = recognitionFixture();
  f.listener.start(); f.listener.start();
  assert.equal(f.starts(), 1);
  const engine = f.engines[0]!;
  assert.equal(engine.lang, 'en-US'); assert.equal(engine.continuous, false); assert.equal(engine.interimResults, true);
  const handler = engine.onresult!;
  handler(f.result('create a game', false));
  assert.deepEqual(f.transcripts, []);
  assert.deepEqual(f.previews, ['create a game']);
  handler(f.result('create a game'));
  handler(f.result('create a game'));
  assert.deepEqual(f.transcripts, ['create a game']);
  assert.deepEqual(f.states, [true, false]); assert.equal(f.aborts(), 1);
  assert.equal(engine.onresult, null);
  assert.deepEqual(f.errors, []);
});

test('the microphone UI always shows whether it has received words', () => {
  const html = renderToStaticMarkup(createElement(MossCommandInput, { disabled: false, onTranscript() {}, stopVoice() {} }));
  assert.match(html, /Heard: /); assert.match(html, /No words received yet/); assert.match(html, /aria-live="polite"/);
});

test('opening the microphone is distinct from the speech service actually starting', async () => {
  const f = recognitionFixture(10, false); f.listener.start();
  assert.equal(f.starts(), 1); assert.equal(f.serviceStarts(), 0);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(f.transcripts, []); assert.match(f.errors[0]!, /didn’t start speech recognition/);
  assert.equal(f.engines[0]!.onstart, null);
});

test('interim speech remains visible but never opens a room without a final result', () => {
  const f = recognitionFixture(); f.listener.start(); assert.equal(f.serviceStarts(), 1);
  f.engines[0]!.onresult!(f.result('play with Swamp Bot', false)); f.engines[0]!.onend!();
  assert.deepEqual(f.previews, ['play with Swamp Bot']); assert.deepEqual(f.transcripts, []);
  assert.match(f.errors[0]!, /didn’t return a finished transcript/);
});

test('no-match and unavailable speech services produce explicit errors, never game commands', () => {
  const f = recognitionFixture(); f.listener.start(); f.engines[0]!.onnomatch!();
  assert.deepEqual(f.transcripts, []); assert.match(f.errors[0]!, /couldn’t transcribe/); assert.equal(f.engines[0]!.onnomatch, null);
  for (const code of ['network', 'service-not-allowed', 'language-not-supported']) {
    const failed = recognitionFixture(); failed.listener.start(); failed.engines[0]!.onerror!({ error: code });
    assert.deepEqual(failed.transcripts, []); assert.match(failed.errors[0]!, /Chrome/);
  }
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
    const speech = { resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Hey Moss, can you play with Swampbot?' } }] };
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
