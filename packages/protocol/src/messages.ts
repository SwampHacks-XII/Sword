// Messages used by the website, the online server, and the offline bot adapter.
// A physical sword plugs into its player's laptop over USB; the website forwards its input as these messages.
import type {
  DeviceChecks, Gesture, PhysicalSwordNumber, LobbyState, MatchEvent, MatchState, PlayerSlot, Quat, SwordColor,
} from './types.js';
import type { QuestStory } from './quests.js';
import type { SpellDifficulty } from './spells.js';

/** Sent by an ESP32 sword to the server. */
export type SwordEvent =
  | { type: 'sword.orientation'; swordId: string; q: Quat; t: number }
  | { type: 'sword.button'; swordId: string; color: SwordColor }
  | { type: 'sword.gesture'; swordId: string; gesture: Gesture }
  /**
   * shotId identifies the shot (the IR signal carries a short token for it).
   * ttlMs: how long the shot can still land (default 1 s; a physical sword fires for longer).
   */
  | { type: 'sword.trigger'; swordId: string; shotId: string; ttlMs?: number }
  /** The victim's sword reports an IR shot it received; shotId is decoded from the IR signal. */
  | { type: 'sword.hit'; victimSwordId: string; attackerSwordId: string; shotId: string };

/** Sent by the website to the server. */
export type ClientMessage =
  | { type: 'lobby.create'; name: string; mode: 'online' | 'bot' }
  | { type: 'lobby.join'; code: string; name: string }
  | { type: 'lobby.leave' }
  | { type: 'device.check' }
  | { type: 'quest.begin' }
  | { type: 'quest.accept' }
  | { type: 'match.start' }
  | { type: 'match.rematch' }
  | { type: 'spell.choose'; difficulty: SpellDifficulty }
  | { type: 'player.heal' }
  /** Live orientation from this player's USB-connected sword; relayed to both players during battle. */
  | { type: 'sword.pose'; q: Quat }
  /** Whether this player has a physical sword connected. Real IR then decides hits against them. */
  | { type: 'sword.link'; connected: boolean; number?: PhysicalSwordNumber }
  /** This player's sword received the opponent's IR shot carrying this token (1–255). */
  | { type: 'sword.hit'; shot: number }
  /** Keyboard stand-in for this player's sword while testing without hardware. */
  | { type: 'dev.sword'; input: DevSwordInput };

export type DevSwordInput =
  | { kind: 'button'; color: SwordColor }
  | { kind: 'gesture'; gesture: Gesture }
  /** shot: the IR token a physical sword is firing; absent for keyboard practice. */
  | { kind: 'trigger'; shot?: number };

/** Sent by the server to the website. */
export type ServerMessage =
  | { type: 'connection.state'; status: 'connecting' | 'open' | 'closed' }
  | { type: 'action.pending'; pending: boolean }
  | { type: 'room.closed'; message: string }
  | { type: 'lobby.state'; lobby: LobbyState | null }
  | { type: 'quest.state'; quest: { accepted: PlayerSlot[]; story: QuestStory | null; roundNumber: number } | null }
  | { type: 'device.state'; checks: DeviceChecks }
  | { type: 'match.state'; match: MatchState | null }
  | { type: 'match.event'; event: MatchEvent; at: number }
  /** Relayed sword orientation, sent many times per second. */
  | { type: 'sword.pose'; slot: PlayerSlot; q: Quat }
  | { type: 'error'; message: string };
