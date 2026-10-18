import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement, StrictMode } from 'react';
import { Window } from 'happy-dom';
import { createHandsFreeListener } from '../src/story/handsFreeRecognition';
import type { CommandRecognition } from '../src/story/commandRecognition';
import { createMossChime } from '../src/audio/mossChime';
import { handsFreePreference } from '../src/story/handsFreePreference';
import { audioActivity } from '../src/audio/activity';
import { MossCommandInput } from '../src/components/MossCommandInput';

const result = (text: string, isFinal = true, index = 0) => ({
  resultIndex: index,
  results: Array.from({ length: index + 1 }, (_, i) => ({ isFinal, 0: { transcript: i === index ? text : '' } })),
});

function fixture() {
  const engines: CommandRecognition[] = [];
  const commands: string[] = [];
  const errors: { message: string; recoverable: boolean }[] = [];
  let chimes = 0;
  const input = createHandsFreeListener(() => {
    const engine: CommandRecognition = {
      lang: '', continuous: false, interimResults: false, maxAlternatives: 0,
      onresult: null, onend: null, onerror: null,
      start() { engine.onstart?.(); }, abort() {},
    };
    engines.push(engine); return engine;
  }, {
    mode() {}, started() {}, wake() { chimes++; }, preview() {},
    transcript: text => commands.push(text),
    error: (message, recoverable) => errors.push({ message, recoverable }),
  }, { restartMs: 20, commandTimeoutMs: 100 });
  return { input, engines, commands, errors, chimes: () => chimes };
}

test('background speech cannot run commands; a wake phrase chimes once and waits for a final command', t => {
  const f = fixture(); t.after(f.input.stop); f.input.start('wake');
  const engine = f.engines[0]!;
  assert.equal(engine.continuous, true);
  const deliver = engine.onresult!;
  deliver(result('create a game')); deliver(result('hey mossy start my quest'));
  assert.deepEqual(f.commands, []); assert.equal(f.chimes(), 0);
  deliver(result('Hey, Moss, create a game', false));
  deliver(result('Hey, Moss, create a game', false));
  assert.equal(f.chimes(), 1); assert.deepEqual(f.commands, []);
  deliver(result('Hey, Moss, create a game'));
  deliver(result('Hey, Moss, create a game'));
  assert.deepEqual(f.commands, ['create a game']); assert.equal(f.chimes(), 1);
  assert.equal(engine.onresult, null);
});

test('a wake phrase followed by a separate utterance captures the command without another button', t => {
  const f = fixture(); t.after(f.input.stop); f.input.start('wake');
  f.engines[0]!.onresult!(result('Hey Moss'));
  assert.equal(f.chimes(), 1); assert.deepEqual(f.commands, []);
  f.engines[0]!.onresult!(result('join room zero one two three', true, 1));
  assert.deepEqual(f.commands, ['join room zero one two three']);
});

test('interim wake corrections cannot turn an unrelated final transcript into an action', t => {
  const f = fixture(); t.after(f.input.stop); f.input.start('wake');
  f.engines[0]!.onresult!(result('Hey Moss, leave game', false));
  f.engines[0]!.onresult!(result('hey most people leave games'));
  assert.deepEqual(f.commands, []);
});

test('silence restarts wake detection, while a command deadline survives a browser restart', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const f = fixture(); t.after(f.input.stop); f.input.start('wake');
  t.mock.timers.tick(1500);
  const stale = f.engines[0]!.onresult!;
  f.engines[0]!.onerror!({ error: 'no-speech' });
  t.mock.timers.tick(20);
  assert.equal(f.engines.length, 2);
  stale(result('Hey Moss, leave game')); assert.deepEqual(f.commands, []);
  f.engines[1]!.onresult!(result('Hey Moss'));
  t.mock.timers.tick(40); f.engines[1]!.onend!(); t.mock.timers.tick(20);
  assert.equal(f.engines.length, 3);
  t.mock.timers.tick(40);
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0]!.recoverable, true);
  assert.deepEqual(f.commands, []);
});

test('permission failures never loop, and stopping cancels queued restarts and late commands', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); t.after(f.input.stop); f.input.start('wake');
  f.engines[0]!.onerror!({ error: 'not-allowed' });
  t.mock.timers.tick(10000);
  assert.equal(f.engines.length, 1); assert.equal(f.errors[0]!.recoverable, false);
  f.input.start('wake');
  const stale = f.engines[1]!.onresult!;
  f.engines[1]!.onend!(); f.input.stop(); t.mock.timers.tick(10000);
  stale(result('Hey Moss, create a game'));
  assert.equal(f.engines.length, 2); assert.deepEqual(f.commands, []);
});

test('the backup button mode accepts one command without requiring a wake phrase', t => {
  const f = fixture(); t.after(f.input.stop);
  f.input.start('command'); f.input.start('command');
  assert.equal(f.engines.length, 1);
  f.engines[0]!.onresult!(result('start my quest'));
  assert.deepEqual(f.commands, ['start my quest']); assert.equal(f.chimes(), 0);
});

test('the wake chime unlocks audio on preparation and schedules two short ascending tones', async () => {
  let constructions = 0; let resumes = 0;
  const frequencies: number[] = []; const starts: number[] = []; const stops: number[] = [];
  const context = {
    state: 'suspended', currentTime: 4, destination: {},
    async resume() { resumes++; context.state = 'running'; },
    createOscillator() {
      const oscillator = { type: '', frequency: { value: 0 }, connect() {}, disconnect() {}, onended: null,
        start(time: number) { frequencies.push(oscillator.frequency.value); starts.push(time); },
        stop(time: number) { stops.push(time); } };
      return oscillator;
    },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
  };
  const chime = createMossChime(() => { constructions++; return context as unknown as AudioContext; });
  assert.equal(constructions, 0);
  await chime.prepare(); assert.equal(resumes, 1); assert.deepEqual(starts, []);
  await chime.play();
  assert.equal(constructions, 1); assert.deepEqual(frequencies, [659.25, 987.77]);
  assert.deepEqual(starts, [4, 4.11]); assert.deepEqual(stops, [4.21, 4.32]);
});

test('only an active Talk to Moss page listens; narration, page turns, busy actions and hidden tabs pause it', async t => {
  const dom = new Window({ url: 'https://sword.test/#practice' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const engines: CommandRecognition[] = [];
  let aborts = 0;
  Object.defineProperty(dom, 'SpeechRecognition', { value: class {
    onstart: (() => void) | null = null;
    onresult = null; onend = null; onerror = null;
    constructor() { engines.push(this as unknown as CommandRecognition); }
    start() { this.onstart?.(); }
    abort() { aborts++; }
  } });
  const { createRoot } = await import('react-dom/client');
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const voice = Symbol('test narrator');
  const commands: string[] = [];
  const render = async (active: boolean, disabled = false) => {
    await act(async () => root.render(createElement(StrictMode, {}, createElement(MossCommandInput, {
      active, disabled, stopVoice() {}, onTranscript: text => commands.push(text),
    }))));
  };
  t.after(async () => {
    await act(async () => { root.unmount(); handsFreePreference.set(false); audioActivity.set(voice, 'speech', false); });
    await dom.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  handsFreePreference.set(true);
  await render(false); assert.equal(engines.length, 0, 'Hidden page copies must never start recognition');
  await act(async () => audioActivity.set(voice, 'speech', true));
  await render(true); assert.equal(engines.length, 0);
  await act(async () => audioActivity.set(voice, 'speech', false));
  assert.equal(engines.length, 1);
  await act(async () => engines[0]!.onresult!(result('Hey Moss', false)));
  assert.match(container.textContent!, /Stop listening/);
  const stale = engines[0]!.onresult!;
  await render(false); assert.ok(aborts > 0);
  stale(result('Hey Moss, leave game')); assert.deepEqual(commands, []);
  await render(true); assert.equal(engines.length, 2);
  await render(true, true); assert.equal(engines[1]!.onresult, null);
  await render(true); assert.equal(engines.length, 3);
  await act(async () => {
    Object.defineProperty(dom.document, 'visibilityState', { value: 'hidden', configurable: true });
    dom.document.dispatchEvent(new dom.Event('visibilitychange'));
  });
  assert.equal(engines[2]!.onresult, null);
  await act(async () => {
    Object.defineProperty(dom.document, 'visibilityState', { value: 'visible', configurable: true });
    dom.document.dispatchEvent(new dom.Event('visibilitychange'));
  });
  assert.equal(engines.length, 4);
  await act(async () => handsFreePreference.set(false));
  assert.equal(engines[3]!.onresult, null);
  await act(async () => container.querySelector('button')!.click());
  assert.equal(engines.length, 5, 'The backup button must still work with hands-free off');
  await act(async () => engines[4]!.onresult!(result('create a game')));
  assert.deepEqual(commands, ['create a game']);
  assert.equal(engines.length, 5, 'Manual input must not start hands-free mode after finishing');
});
