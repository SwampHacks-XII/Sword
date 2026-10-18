import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPELLS, SWORD_FIRE_WINDOW_MS, GameRules, getSpell, type ServerMessage, type ClientMessage } from '@sword/protocol';
import { readFile } from 'node:fs/promises';
import { parseSwordLine, swordNumberOf, swordSpellNumber } from '../src/net/serialSword';
import { createMockConnection } from '../src/net/mock/mockConnection';

test('sword events parse into game input; debug output and malformed lines are ignored', () => {
  assert.deepEqual(parseSwordLine('S1,SEL,E\r'), { kind: 'select', choice: 'easy' });
  assert.deepEqual(parseSwordLine('S2,SEL,H'), { kind: 'select', choice: 'hard' });
  assert.deepEqual(parseSwordLine('S1,SEL,L'), { kind: 'select', choice: 'heal' });
  assert.deepEqual(parseSwordLine('S1,STEP,72,2'), { kind: 'step', token: 72, count: 2 });
  assert.deepEqual(parseSwordLine('S1,RESET,72'), { kind: 'reset', token: 72 });
  assert.deepEqual(parseSwordLine('S1,FIRE,72'), { kind: 'fire', token: 72 });
  assert.deepEqual(parseSwordLine('S1,END,72,T'), { kind: 'end', token: 72 });
  assert.deepEqual(parseSwordLine('S2,HIT,1,71'), { kind: 'hit', token: 71 });
  assert.deepEqual(parseSwordLine('S1,PONG'), { kind: 'alive' });
  assert.deepEqual(parseSwordLine('S1,POSE,0.7071,0.0000,-0.7071,0.0000'), { kind: 'pose', q: [0.7071, 0, -0.7071, 0] });
  for (const line of ['', 'Motion sensor READY', 'CMD <- P', 'PHYSICAL INPUT: B PRESSED (GPIO 25, stage 0)',
    'S1,SEL,X', 'S1,STEP,0,1', 'S1,FIRE,300', 'S1,HIT,2', 'S1,POSE,1,0,0', 'S1,POSE,1,0,0,nan', 'S1,POSE,2,0,0,0', 'S1,BAD_CMD']) {
    assert.equal(parseSwordLine(line), null, line);
  }
});

test('the real sword number comes from every event, not the Bluetooth device name', () => {
  assert.equal(swordNumberOf('S1,PONG'), 1);
  assert.equal(swordNumberOf('S2,POSE,1,0,0,0\r'), 2);
  assert.equal(swordNumberOf('Sword 2 ready; BLE advertising as Sword2'), null);
  assert.equal(swordNumberOf('S3,PONG'), null);
});

test('spell numbers and colours match the firmware table', () => {
  // From firmware/sword/sword.ino: {name, difficulty, buttons, motions}
  const firmware = [['E', 'YYY', 'U'], ['E', 'RYG', 'D'], ['E', 'BYB', 'R'], ['M', 'YYBRG', 'UD'], ['M', 'RYGRY', 'DU'],
    ['M', 'BBYGR', 'RL'], ['H', 'YBYYGRG', 'TUD'], ['H', 'RYRGRBR', 'LTR'], ['H', 'RYBBGYR', 'URT']];
  const letter = { red: 'R', yellow: 'Y', green: 'G', blue: 'B' } as const;
  assert.equal(SPELLS.length, firmware.length);
  for (const spell of SPELLS) {
    const [difficulty, buttons, motions] = firmware[swordSpellNumber(spell.id) - 1]!;
    assert.equal(difficulty, spell.difficulty[0]!.toUpperCase(), spell.id);
    assert.equal(spell.combo.map(color => letter[color]).join(''), buttons, spell.id);
    assert.equal(spell.swordMotions, motions, spell.id);
  }
  assert.equal(swordSpellNumber('flame'), 1);
  assert.deepEqual(getSpell('flame').combo, ['yellow', 'yellow', 'yellow']);
});

test('Swamp Bot practice shows your live sword pose during battle only', async () => {
  const connection = createMockConnection();
  const messages: ServerMessage[] = [];
  connection.subscribe(message => messages.push(message));
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 300 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate());
  };
  const tilted: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
  const sawTilt = () => messages.some(m => m.type === 'sword.pose' && m.slot === 'p1' && m.q.every((n, i) => n === tilted[i]));
  try {
    connection.send({ type: 'lobby.create', name: 'Alice', mode: 'bot' });
    await until(() => messages.some(m => m.type === 'lobby.state' && m.lobby?.players.length === 2));
    connection.send({ type: 'sword.pose', q: tilted });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(sawTilt(), false);
    connection.send({ type: 'match.start' });
    await until(() => messages.some(m => m.type === 'match.state' && m.match?.phase === 'fighting'));
    connection.send({ type: 'sword.pose', q: tilted });
    await until(sawTilt);
  } finally {
    connection.close();
  }
});

// The timer must survive the hardware path resetting the fighter to spell selection.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CastTimer } from '../src/components/CastTimer';
import type { FighterState } from '@sword/protocol';
import { Window } from 'happy-dom';
import { act } from 'react';
import { ConnectionContext } from '../src/hooks/useConnection';
import { MatchProvider, useMatch } from '../src/hooks/useMatch';
import { SpellPanel } from '../src/components/SpellPanel';
import { SerialSwordProvider, useSerialSword } from '../src/hooks/useSerialSword';

const timerFighter: FighterState = {
  slot: 'p1', name: 'Hero', hp: 100, maxHp: 100, spellId: null, entered: 0,
  castPhase: 'choose', armedAt: null, armedUntil: null, shieldUntil: null, slowedUntil: null,
  healUsesRemaining: 2, healReadyAt: null,
};

test('keyboard countdown uses its arming window and disappears on fire or expiry', t => {
  t.mock.method(Date, 'now', () => 20_000);
  const fighter: FighterState = { ...timerFighter, castPhase: 'armed', armedAt: 12_000, armedUntil: 22_000 };
  const html = renderToStaticMarkup(createElement(CastTimer, { fighter, firingUntil: null }));
  assert.match(html, /cast-timer/);
  assert.match(html, /Space/);
  assert.match(html, /aria-valuenow="20"/);
  assert.equal(renderToStaticMarkup(createElement(CastTimer, { fighter: timerFighter, firingUntil: null })), '');
  t.mock.method(Date, 'now', () => 22_000);
  assert.equal(renderToStaticMarkup(createElement(CastTimer, { fighter, firingUntil: null })), '');
});

test('hardware countdown uses the ten-second IR window even after the spell resets', t => {
  t.mock.method(Date, 'now', () => 20_000);
  const render = (firingUntil: number | null) => renderToStaticMarkup(createElement(CastTimer, { fighter: timerFighter, firingUntil }));
  assert.match(render(30_000), /aria-valuenow="100"/);
  assert.match(render(30_000), /Sword firing time remaining/);
  assert.doesNotMatch(render(30_000), /Space/);
  t.mock.method(Date, 'now', () => 25_000);
  assert.match(render(30_000), /aria-valuenow="50"/);
  assert.equal(render(null), '');
  t.mock.method(Date, 'now', () => 30_000);
  assert.equal(render(30_000), '');
});

test('the hardware countdown matches the firmware IR firing window', async () => {
  const firmware = await readFile(new URL('../../../firmware/sword/sword.ino', import.meta.url), 'utf8');
  const duration = firmware.match(/const uint32_t FIRE_WINDOW_MS = (\d+);/);
  assert.ok(duration);
  assert.equal(Number(duration[1]), SWORD_FIRE_WINDOW_MS);
  assert.equal(SWORD_FIRE_WINDOW_MS, 10_000);
});

for (const kind of ['mock', 'ws'] as const) for (const transport of ['usb', 'bluetooth'] as const) test(`${kind}/${transport}: hardware buttons choose difficulty, update runes and fire`, async t => {
  const dom = new Window({ url: 'https://sword.test/' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let incoming!: ReadableStreamDefaultController<Uint8Array>;
  const writes: string[] = [];
  const port = {
    open: async () => {}, close: async () => {},
    readable: new ReadableStream<Uint8Array>({ start(c) { incoming = c; } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(new TextDecoder().decode(bytes)); } }),
  };
  const tx = Object.assign(new dom.EventTarget(), { value: new DataView(new ArrayBuffer(0)), startNotifications: async () => tx });
  const rx = Object.assign(new dom.EventTarget(), {
    writeValueWithResponse: async (bytes: Uint8Array) => { writes.push(new TextDecoder().decode(bytes)); },
    writeValue: async () => { throw new Error('Prefer acknowledged Bluetooth writes'); },
    writeValueWithoutResponse: async () => { throw new Error('Control commands need acknowledgement'); },
  });
  const gatt = { connected: true, connect: async () => gatt, disconnect() {},
    getPrimaryService: async () => ({ getCharacteristic: async (uuid: string) => uuid.includes('0002-') ? rx : tx }) };
  const device = Object.assign(new dom.EventTarget(), { gatt });
  Object.defineProperty(dom.navigator, 'bluetooth', { value: { requestDevice: async () => device } });
  Object.defineProperty(dom.navigator, 'serial', { value: { requestPort: async () => port } });
  for (const [name, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator,
    ResizeObserver: dom.ResizeObserver, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const { createRoot } = await import('react-dom/client');
  let listener: (message: ServerMessage) => void = () => {};
  const rules = new GameRules(message => listener(message.type === 'lobby.state' && message.lobby
    ? { ...message, lobby: { ...message.lobby, mode: kind === 'ws' ? 'online' : 'bot' } } : message), () => Date.now(), () => 0);
  const connection = { kind, status: () => 'open' as const, close() {},
    send(message: ClientMessage) {
      if (message.type === 'spell.choose') rules.chooseSpell('p1', message.difficulty);
      if (message.type === 'player.heal') rules.heal('p1');
      if (message.type !== 'dev.sword') return;
      const input = message.input;
      if (input.kind === 'button') rules.handleSword({ type: 'sword.button', swordId: 'sword-1', color: input.color });
      else if (input.kind === 'gesture') rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: input.gesture });
      else rules.handleSword({ type: 'sword.trigger', swordId: 'sword-1', shotId: `ir-${input.shot}`, ttlMs: 10_500 });
    },
    subscribe(fn: typeof listener) { listener = fn; return () => {}; } };
  function Probe() {
    const sword = useSerialSword();
    const { match } = useMatch();
    return createElement('div', null, createElement('button', { onClick: () => sword.connect(transport) }, 'Connect'),
      sword.error && createElement('p', { role: 'alert' }, sword.error),
      match && createElement(SpellPanel, { fighter: match.fighters.p1 }),
      match && createElement(CastTimer, { fighter: match.fighters.p1, firingUntil: sword.firingUntil }));
  }
  const container = dom.document.createElement('div'); dom.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  t.after(async () => {
    await act(async () => root.unmount()); await dom.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  });
  await act(async () => root.render(createElement(ConnectionContext, { value: { connection,
    poses: { p1: [1, 0, 0, 0], p2: [1, 0, 0, 0] } } },
    createElement(MatchProvider, { children: createElement(SerialSwordProvider, { children: createElement(Probe) }) }))));
  await act(async () => {
    listener({ type: 'connection.state', status: 'open' });
    rules.openLobby('1234', 'p1', 'Hero'); rules.addPlayer('p2', 'Opponent'); rules.startMatch();
    container.querySelector('button')!.click();
  });
  const line = async (text: string) => act(async () => {
    const bytes = new TextEncoder().encode(text + (transport === 'usb' ? '\n' : ''));
    if (transport === 'usb') incoming.enqueue(bytes);
    else { tx.value = new DataView(bytes.buffer); tx.dispatchEvent(new dom.Event('characteristicvaluechanged')); }
    await new Promise(resolve => setTimeout(resolve, 5));
  });
  await line('S1,PONG');
  for (const [choice, difficulty] of [['E', 'easy'], ['M', 'medium'], ['H', 'hard']] as const) {
    const buttons = [...container.querySelectorAll('.difficulty-button')];
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every(button => button.hasAttribute('disabled')), 'Hardware owns difficulty selection');
    await line(`S1,SEL,${choice}`);
    assert.equal(getSpell(rules.fighter('p1')!.spellId!).difficulty, difficulty);
    const assigned = writes.filter(write => write.startsWith('C,')).at(-1)!.match(/C,(\d+),(\d+)/)!;
    assert.ok(assigned, 'The sword receives the selected spell without screen clicks');
    const token = assigned[1];
    await line(`S1,START,${token},${assigned[2]}`);
    await line(`S1,STEP,${token},1`);
    assert.equal(container.querySelectorAll('.rune.entered').length, 1);
    assert.match(container.querySelector('.rune')!.getAttribute('aria-label')!, /entered/);
    await line(`S1,STEP,${token},1`);
    assert.equal(rules.fighter('p1')!.entered, 1, 'Duplicate notifications do not add a rune');
    await line(`S1,RESET,${token}`);
    assert.equal(container.querySelectorAll('.rune.entered').length, 0);
    await line(`S1,STEP,${token},2`);
    assert.equal(container.querySelectorAll('.rune.entered').length, 2, 'Missing notifications do not freeze later buttons');
    await line(`S1,STEP,${token},99`);
    assert.equal(rules.fighter('p1')!.entered, 2);
    await line(`S1,FIRE,${token}`);
    assert.equal(rules.fighter('p1')!.castPhase, 'choose', 'FIRE reconciles any missing final rune notifications');
    assert.ok(container.querySelector('.cast-timer'));
    assert.match(container.textContent, /other sword’s receiver/);
    await line(`S1,END,${token},T`); await line('S1,READY');
    assert.equal(container.querySelector('.cast-timer'), null);
  }
  await act(async () => {
    rules.chooseSpell('p2', 'easy');
    const enemySpell = getSpell(rules.fighter('p2')!.spellId!);
    for (const color of enemySpell.combo) rules.handleSword({ type: 'sword.button', swordId: 'sword-2', color });
    rules.handleSword({ type: 'sword.gesture', swordId: 'sword-2', gesture: enemySpell.gesture });
    rules.handleSword({ type: 'sword.trigger', swordId: 'sword-2', shotId: 'enemy' });
    rules.handleSword({ type: 'sword.hit', attackerSwordId: 'sword-2', victimSwordId: 'sword-1', shotId: 'enemy' });
  });
  assert.ok(rules.fighter('p1')!.hp < 100);
  const missingHp = 100 - rules.fighter('p1')!.hp;
  await line('S1,SEL,L');
  assert.equal(rules.fighter('p1')!.hp, 100, 'Blue heals through the sword buttons');
  assert.ok(writes.some(write => new RegExp(`^H,\\d+,${missingHp}`).test(write)), 'The sword receives its heal acknowledgement');
  await line('S1,READY');
  if (transport === 'bluetooth') {
    rx.writeValueWithResponse = async () => { throw new Error('Disconnected while writing'); };
    await line('S1,SEL,E');
    assert.ok(container.querySelector('[role="alert"]'), 'Failed Bluetooth commands are visible');
    assert.ok([...container.querySelectorAll('.difficulty-button')].every(button => !button.hasAttribute('disabled')),
      'A failed link releases the keyboard controls');
  }

});
