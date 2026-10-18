export type PlayerSlot = 'p1' | 'p2';
/** Firmware SWORD_ID: sword 1 is pink, sword 2 is purple. */
export type PhysicalSwordNumber = 1 | 2;
export const PLAYER_SLOTS: readonly PlayerSlot[] = ['p1', 'p2'];
export const otherSlot = (slot: PlayerSlot): PlayerSlot => (slot === 'p1' ? 'p2' : 'p1');

/** The four colored buttons on the sword grip. */
export type SwordColor = 'red' | 'blue' | 'green' | 'yellow';
export const SWORD_COLORS: readonly SwordColor[] = ['red', 'blue', 'green', 'yellow'];

/** Motions the sword firmware (or the mock) recognizes. */
export type Gesture = 'swing_left' | 'swing_right' | 'wrist_rotate' | 'upright';

/** Orientation quaternion [w, x, y, z]. Identity = blade pointing straight up. */
export type Quat = [number, number, number, number];

export interface LobbyPlayer {
  slot: PlayerSlot;
  name: string;
  swordId: string;
  /** The physical sword this player has connected (its firmware SWORD_ID), if any. */
  physicalSword?: PhysicalSwordNumber;
  connected: boolean;
}

export interface LobbyState {
  mode?: 'online' | 'bot';
  code: string;
  /** Which slot this browser controls. */
  you: PlayerSlot;
  players: LobbyPlayer[];
}

export type CheckId = 'pairing' | 'lights' | 'motion' | 'camera';
export type CheckStatus = 'pending' | 'checking' | 'ok' | 'failed';
export type DeviceChecks = Record<CheckId, CheckStatus>;

/**
 * Casting a spell: choose difficulty → enter the sequence → motion → armed (fire before time runs out).
 * Timestamps are epoch milliseconds from the server clock.
 */
export type CastPhase = 'choose' | 'enter' | 'motion' | 'armed';

export interface FighterState {
  slot: PlayerSlot;
  name: string;
  hp: number;
  maxHp: number;
  spellId: string | null;
  entered: number;
  castPhase: CastPhase;
  armedAt: number | null;
  armedUntil: number | null;
  shieldUntil: number | null;
  slowedUntil: number | null;
  healUsesRemaining: number;
  healReadyAt: number | null;
}

export interface MatchState {
  phase: 'fighting' | 'over';
  fighters: Record<PlayerSlot, FighterState>;
  winner: PlayerSlot | null;
}

export type MatchEvent =
  | { kind: 'heal'; slot: PlayerSlot; amount: number }
  | { kind: 'cast'; slot: PlayerSlot; spellId: string }
  | { kind: 'hit'; attacker: PlayerSlot; victim: PlayerSlot; spellId: string; damage: number; blocked: boolean }
  | { kind: 'miss'; attacker: PlayerSlot; spellId: string }
  | { kind: 'fizzle'; slot: PlayerSlot; spellId: string };
