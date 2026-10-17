import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPELLS, getSpell, type ServerMessage } from '@sword/protocol';
import { parseSwordLine, swordSpellNumber } from '../src/net/serialSword';
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
