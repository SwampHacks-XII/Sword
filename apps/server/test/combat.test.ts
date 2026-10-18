import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRules, getSpell, SPELLS, DAMAGE_RANGES, HEAL_COOLDOWN_MS, PHYSICAL_SHOT_MS, type ServerMessage, type SpellDifficulty } from '@sword/protocol';

function setup(random = () => 0) {
  const messages: ServerMessage[] = [];
  let now = 1000;
  const rules = new GameRules(message => messages.push(message), () => now, random);
  rules.openLobby('0017', 'p1', 'Alice'); rules.addPlayer('p2', 'Bob'); rules.startMatch();
  let shot = 0;
  function fire(difficulty: SpellDifficulty = 'hard', hit = true) {
    assert.equal(rules.chooseSpell('p1', difficulty), true);
    const spell = getSpell(rules.fighter('p1')!.spellId!);
    for (const color of spell.combo) rules.handleSword({ type: 'sword.button', swordId: 'sword-1', color });
    rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: spell.gesture });
    const shotId = `shot-${++shot}`;
    assert.equal(rules.handleSword({ type: 'sword.trigger', swordId: 'sword-1', shotId }), 'fired');
    const event = { type: 'sword.hit', attackerSwordId: 'sword-1', victimSwordId: 'sword-2', shotId } as const;
    if (hit) rules.handleSword(event);
    return event;
  }
  return { rules, messages, fire, advance: (ms: number) => { now += ms; } };
}

test('all nine spells have the exact requested sequences and difficulty ranges', () => {
  const numbers = { red: 1, yellow: 2, green: 3, blue: 4 };
  const expected = ['2-2-2', '1-2-3', '4-2-4', '2-2-4-1-3', '1-2-3-1-2', '4-4-2-3-1', '2-4-2-2-3-1-3', '1-2-1-3-1-4-1', '1-2-4-4-3-2-1'];
  assert.equal(SPELLS.length, 9);
  SPELLS.forEach((spell, index) => {
    assert.equal(spell.combo.map(color => numbers[color]).join('-'), expected[index]);
    assert.deepEqual(spell.damageRange, DAMAGE_RANGES[spell.difficulty]);
  });
});

test('difficulty assigns one random spell from its group; cast completion returns to the chooser', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    for (const value of [0, 0.4, 0.999999]) {
      const f = setup(() => value);
      assert.equal(f.rules.fighter('p1')!.spellId, null);
      assert.equal(f.rules.fighter('p1')!.castPhase, 'choose');
      assert.equal(f.rules.chooseSpell('p1', difficulty), true);
      const assigned = f.rules.fighter('p1')!.spellId!;
      assert.equal(getSpell(assigned).difficulty, difficulty);
      assert.equal(f.rules.chooseSpell('p1', difficulty), false);
      assert.equal(f.rules.fighter('p1')!.spellId, assigned);
      assert.equal(f.rules.fighter('p2')!.spellId, null);
    }
    const f = setup(); f.fire(difficulty);
    assert.equal(f.rules.fighter('p1')!.castPhase, 'choose');
    assert.equal(f.rules.fighter('p1')!.spellId, null);
  }
});

test('only a correct sequence then its motion arms the sword; expired spells cannot fire', () => {
  const f = setup();
  assert.equal(f.rules.handleSword({ type: 'sword.trigger', swordId: 'sword-1', shotId: 'none' }), 'ignored');
  f.rules.chooseSpell('p1', 'easy');
  const spell = getSpell(f.rules.fighter('p1')!.spellId!);
  f.rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: spell.gesture });
  assert.equal(f.rules.fighter('p1')!.castPhase, 'enter');
  const wrong = (['red', 'yellow', 'green', 'blue'] as const).find(color => color !== spell.combo[0])!;
  f.rules.handleSword({ type: 'sword.button', swordId: 'sword-1', color: wrong });
  assert.equal(f.rules.fighter('p1')!.entered, 0);
  for (const color of spell.combo) f.rules.handleSword({ type: 'sword.button', swordId: 'sword-1', color });
  assert.equal(f.rules.fighter('p1')!.castPhase, 'motion');
  f.rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: 'upright' });
  assert.equal(f.rules.fighter('p1')!.castPhase, 'motion');
  f.rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: spell.gesture });
  const armed = f.rules.fighter('p1')!;
  assert.equal(armed.armedUntil! - armed.armedAt!, 10_000);
  f.advance(9000); f.rules.tick();
  assert.equal(f.rules.fighter('p1')!.castPhase, 'armed', 'The player still has time to aim after nine seconds');
  f.advance(1001);
  assert.equal(f.rules.handleSword({ type: 'sword.trigger', swordId: 'sword-1', shotId: 'late' }), 'ignored');
  assert.equal(f.rules.fighter('p1')!.castPhase, 'choose');
});

test('damage includes both endpoints in each range and duplicate hit reports never deal damage twice', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    for (const value of [0, 0.999999]) {
      const f = setup(() => value);
      const event = f.fire(difficulty);
      const expected = DAMAGE_RANGES[difficulty][value === 0 ? 0 : 1];
      assert.equal(f.rules.fighter('p2')!.hp, 100 - expected);
      f.rules.handleSword(event);
      assert.equal(f.rules.fighter('p2')!.hp, 100 - expected);
    }
  }
});

test('an unanswered shot misses without damage; a late hit cannot become a hit', () => {
  const f = setup(); const event = f.fire('hard', false);
  f.advance(1001); f.rules.tick(); f.rules.handleSword(event);
  assert.equal(f.rules.fighter('p2')!.hp, 100);
  assert.equal(f.messages.some(m => m.type === 'match.event' && m.event.kind === 'miss'), true);
});

test('a physical sword shot can land until its longer IR window closes', () => {
  const f = setup();
  f.rules.chooseSpell('p1', 'easy');
  const spell = getSpell(f.rules.fighter('p1')!.spellId!);
  const fire = (shotId: string) => {
    for (const color of spell.combo) f.rules.handleSword({ type: 'sword.button', swordId: 'sword-1', color });
    f.rules.handleSword({ type: 'sword.gesture', swordId: 'sword-1', gesture: spell.gesture });
    assert.equal(f.rules.handleSword({ type: 'sword.trigger', swordId: 'sword-1', shotId, ttlMs: PHYSICAL_SHOT_MS }), 'fired');
  };
  fire('ir-1');
  f.advance(PHYSICAL_SHOT_MS - 500); f.rules.tick();
  f.rules.handleSword({ type: 'sword.hit', attackerSwordId: 'sword-1', victimSwordId: 'sword-2', shotId: 'ir-1' });
  const hurt = f.rules.fighter('p2')!.hp;
  assert.ok(hurt < 100);
  f.rules.chooseSpell('p1', 'easy');
  fire('ir-2');
  f.advance(PHYSICAL_SHOT_MS + 1); f.rules.tick();
  f.rules.handleSword({ type: 'sword.hit', attackerSwordId: 'sword-1', victimSwordId: 'sword-2', shotId: 'ir-2' });
  assert.equal(f.rules.fighter('p2')!.hp, hurt);
});

test('healing rolls 10–20, has exactly two uses per player and enforces the full five-second cooldown', () => {
  for (const value of [0, 0.999999]) {
    const f = setup(() => value);
    assert.equal(f.rules.heal('p2'), false); // Full health does not spend a use.
    assert.equal(f.rules.fighter('p2')!.healUsesRemaining, 2);
    f.fire(); f.fire();
    const before = f.rules.fighter('p2')!.hp;
    assert.equal(f.rules.heal('p2'), true);
    assert.equal(f.rules.fighter('p2')!.hp - before, value === 0 ? 10 : 20);
    assert.equal(f.rules.heal('p2'), false);
    f.advance(HEAL_COOLDOWN_MS - 1);
    assert.equal(f.rules.heal('p2'), false);
    f.advance(1);
    assert.equal(f.rules.heal('p2'), true);
    assert.equal(f.rules.fighter('p2')!.healUsesRemaining, 0);
    f.advance(HEAL_COOLDOWN_MS);
    assert.equal(f.rules.heal('p2'), false);
    assert.equal(f.rules.fighter('p1')!.healUsesRemaining, 2);
  }
});

test('healing caps at max HP without changing a selected spell; rematch resets health, uses, and cooldowns', () => {
  const f = setup(() => 0.999999);
  f.fire('easy'); // 14 damage, 20 healing roll.
  f.rules.chooseSpell('p2', 'medium');
  const spellId = f.rules.fighter('p2')!.spellId;
  assert.equal(f.rules.heal('p2'), true);
  assert.equal(f.rules.fighter('p2')!.hp, 100);
  assert.equal(f.rules.fighter('p2')!.spellId, spellId);
  while (f.rules.snapshot()!.phase !== 'over') f.fire('hard');
  assert.equal(f.rules.heal('p2'), false);
  assert.equal(f.rules.returnToLobby(), true); f.rules.startMatch();
  assert.equal(f.rules.fighter('p2')!.hp, 100);
  assert.equal(f.rules.fighter('p2')!.healUsesRemaining, 2);
  assert.equal(f.rules.fighter('p2')!.healReadyAt, null);
  assert.equal(f.rules.fighter('p2')!.spellId, null);
});
