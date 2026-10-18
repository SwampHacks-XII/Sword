import type { Gesture, SwordColor } from './types.js';

export interface Spell {
  id: string;
  name: string;
  combo: SwordColor[];
  gesture: Gesture;
  /** Motions the physical sword checks after the buttons: U up, D down, R right, L left, T twist. */
  swordMotions: string;
  difficulty: SpellDifficulty;
  damageRange: readonly [number, number];
}

export const SPELL_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type SpellDifficulty = typeof SPELL_DIFFICULTIES[number];
export const DAMAGE_RANGES = { easy: [5, 14], medium: [15, 24], hard: [25, 30] } as const;
const buttons: Record<string, SwordColor> = { '1': 'red', '2': 'yellow', '3': 'green', '4': 'blue' };
const spell = (id: string, name: string, difficulty: SpellDifficulty, sequence: string, gesture: Gesture, swordMotions: string): Spell => ({
  id, name, difficulty, combo: sequence.split('-').map(number => buttons[number]!), gesture, swordMotions, damageRange: DAMAGE_RANGES[difficulty],
});

// Numbers match the keyboard and the four sword buttons: 1 red, 2 yellow, 3 green, 4 blue.
// Order, sequences and sword motions must match `spells[]` in firmware/sword/sword.ino (spell ID = position + 1).
export const SPELLS: readonly Spell[] = [
  spell('flame', 'Flame', 'easy', '2-2-2', 'swing_right', 'U'),
  spell('waterdrop', 'Waterdrop', 'easy', '1-2-3', 'swing_left', 'D'),
  spell('spark', 'Spark', 'easy', '4-2-4', 'wrist_rotate', 'R'),
  spell('fireball', 'Fireball', 'medium', '2-2-4-1-3', 'swing_right', 'UD'),
  spell('rainfall', 'Rainfall', 'medium', '1-2-3-1-2', 'swing_left', 'DU'),
  spell('thunder', 'Thunder', 'medium', '4-4-2-3-1', 'wrist_rotate', 'RL'),
  spell('meteor', 'Meteor', 'hard', '2-4-2-2-3-1-3', 'swing_right', 'TUD'),
  spell('tsunami', 'Tsunami', 'hard', '1-2-1-3-1-4-1', 'swing_left', 'LTR'),
  spell('lightning_bolt', 'Lightning Bolt', 'hard', '1-2-4-4-3-2-1', 'wrist_rotate', 'URT'),
];

export const SWORD_MOTION_LABELS: Record<string, string> = { U: 'Up', D: 'Down', R: 'Right', L: 'Left', T: 'Twist' };

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
/** A physical sword keeps firing IR for up to 10 s (firmware FIRE_WINDOW_MS); its shot can land until then. */
export const PHYSICAL_SHOT_MS = 10_500;
export const MAX_HP = 100;
export const HEAL_USES = 2;
export const HEAL_RANGE = [10, 20] as const;
export const HEAL_COOLDOWN_MS = 5000;
