import type { Gesture, SwordColor } from './types.js';

export interface Spell {
  id: string;
  name: string;
  combo: SwordColor[];
  gesture: Gesture;
  difficulty: SpellDifficulty;
  damageRange: readonly [number, number];
}

export const SPELL_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type SpellDifficulty = typeof SPELL_DIFFICULTIES[number];
export const DAMAGE_RANGES = { easy: [5, 14], medium: [15, 24], hard: [25, 30] } as const;
const buttons: Record<string, SwordColor> = { '1': 'red', '2': 'blue', '3': 'green', '4': 'yellow' };
const spell = (id: string, name: string, difficulty: SpellDifficulty, sequence: string, gesture: Gesture): Spell => ({
  id, name, difficulty, combo: sequence.split('-').map(number => buttons[number]!), gesture, damageRange: DAMAGE_RANGES[difficulty],
});

// Numbers match the keyboard and the four sword buttons: 1 red, 2 blue, 3 green, 4 yellow.
export const SPELLS: readonly Spell[] = [
  spell('flame', 'Flame', 'easy', '2-2-2', 'swing_right'),
  spell('waterdrop', 'Waterdrop', 'easy', '1-2-3', 'swing_left'),
  spell('spark', 'Spark', 'easy', '4-2-4', 'wrist_rotate'),
  spell('fireball', 'Fireball', 'medium', '2-2-4-1-3', 'swing_right'),
  spell('rainfall', 'Rainfall', 'medium', '1-2-3-1-2', 'swing_left'),
  spell('thunder', 'Thunder', 'medium', '4-4-2-3-1', 'wrist_rotate'),
  spell('meteor', 'Meteor', 'hard', '2-4-2-2-3-1-3', 'swing_right'),
  spell('tsunami', 'Tsunami', 'hard', '1-2-1-3-1-4-1', 'swing_left'),
  spell('lightning_bolt', 'Lightning Bolt', 'hard', '1-2-4-4-3-2-1', 'wrist_rotate'),
];

export function getSpell(id: string): Spell {
  const spell = SPELLS.find((s) => s.id === id);
  if (!spell) throw new Error(`Unknown spell: ${id}`);
  return spell;
}

export const GESTURE_LABELS: Record<Gesture, string> = {
  swing_left: 'Swing left',
  swing_right: 'Swing right',
  wrist_rotate: 'Rotate wrist',
  upright: 'Hold sword upright',
};

/** How long a spell stays armed after its motion, before it fizzles. */
export const ARMED_WINDOW_MS = 5000;
export const MAX_HP = 100;
export const HEAL_USES = 2;
export const HEAL_RANGE = [10, 20] as const;
export const HEAL_COOLDOWN_MS = 5000;
