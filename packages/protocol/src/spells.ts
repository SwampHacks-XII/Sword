import type { Gesture, SwordColor } from './types.js';

export interface Spell {
  id: string;
  name: string;
  combo: SwordColor[];
  gesture: Gesture;
  damage: number;
  /** Self-cast spells (Shield) protect the caster instead of firing at the opponent. */
  selfCast?: boolean;
  slowMs?: number;
  shieldMs?: number;
}

// Placeholder balance from the team's idea doc; stronger spells need longer combos or harder motions.
export const SPELLS: readonly Spell[] = [
  { id: 'fireball', name: 'Fireball', combo: ['red', 'red', 'blue'], gesture: 'swing_right', damage: 20 },
  { id: 'ice_blast', name: 'Ice Blast', combo: ['blue', 'green', 'blue'], gesture: 'swing_left', damage: 10, slowMs: 4000 },
  { id: 'thunderstrike', name: 'Thunderstrike', combo: ['green', 'red', 'blue', 'yellow'], gesture: 'wrist_rotate', damage: 30 },
  { id: 'shield', name: 'Shield', combo: ['blue', 'blue'], gesture: 'upright', damage: 0, selfCast: true, shieldMs: 3000 },
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
