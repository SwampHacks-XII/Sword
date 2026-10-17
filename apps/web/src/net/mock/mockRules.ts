// Stand-in for the real game server's rules. Kept free of browser APIs and timers so it can move
// into apps/server later. The browser only renders what this emits; it never decides outcomes.
import { ARMED_WINDOW_MS, MAX_HP, SPELLS, getSpell } from '../../game/spells';
import {
  PLAYER_SLOTS, otherSlot,
  type CheckId, type CheckStatus, type DeviceChecks, type FighterState, type LobbyPlayer,
  type LobbyState, type MatchEvent, type MatchState, type PlayerSlot,
} from '../../game/types';
import type { ServerMessage, SwordEvent } from '../messages';

/** How long after a trigger press an IR hit report still counts. */
const SHOT_TTL_MS = 1000;
const CODE_WORDS = ['MAGIC', 'SPELL', 'RUNE', 'SWAMP', 'GATOR', 'EMBER', 'FROST'];

interface PendingShot { attacker: PlayerSlot; spellId: string; firedAt: number }
export type TriggerResult = 'fired' | 'self-cast' | 'ignored';

const cleanName = (name: string, fallback: string) => name.trim().slice(0, 40) || fallback;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

export function randomRoomCode() {
  return `${pick(CODE_WORDS)}${Math.floor(10 + Math.random() * 90)}`;
}

export class MockGameRules {
  private code: string | null = null;
  private you: PlayerSlot = 'p1';
  private players: LobbyPlayer[] = [];
  private checks: DeviceChecks = { pairing: 'pending', lights: 'pending', motion: 'pending', camera: 'pending' };
  private match: MatchState | null = null;
  private pendingShots = new Map<string, PendingShot>();
  private usedShots = new Set<string>();

  constructor(private readonly emit: (message: ServerMessage) => void, private readonly now = () => Date.now()) {}

  // ---- Lobby -------------------------------------------------------------

  /** Opens a lobby with this browser's player in `you`'s slot. */
  openLobby(code: string, you: PlayerSlot, name: string) {
    this.code = code;
    this.you = you;
    this.players = [];
    this.match = null;
    this.addPlayer(you, name);
    this.emitMatch();
  }

  addPlayer(slot: PlayerSlot, name: string) {
    if (!this.code) return;
    this.players = this.players.filter((p) => p.slot !== slot);
    this.players.push({ slot, name: cleanName(name, slot === 'p1' ? 'Player 1' : 'Player 2'), swordId: swordIdFor(slot), connected: true });
    this.players.sort((a, b) => a.slot.localeCompare(b.slot));
    this.emitLobby();
  }

  leave() {
    this.code = null;
    this.players = [];
    this.match = null;
    this.emitLobby();
    this.emitMatch();
  }

  lobby(): LobbyState | null {
    return this.code ? { code: this.code, you: this.you, players: this.players.map((p) => ({ ...p })) } : null;
  }

  // ---- Sword connection checklist ----------------------------------------

  setCheck(id: CheckId, status: CheckStatus) {
    this.checks = { ...this.checks, [id]: status };
    this.emit({ type: 'device.state', checks: this.checks });
  }

  // ---- Match -------------------------------------------------------------

  startMatch(): boolean {
    if (this.players.length < 2) {
      this.emit({ type: 'error', message: 'Waiting for a second player.' });
      return false;
    }
    const fighters = {} as Record<PlayerSlot, FighterState>;
    for (const slot of PLAYER_SLOTS) {
      const player = this.players.find((p) => p.slot === slot)!;
      fighters[slot] = {
        slot, name: player.name, hp: MAX_HP, maxHp: MAX_HP, spellId: pick(SPELLS).id, entered: 0,
        castPhase: 'enter', armedAt: null, armedUntil: null, shieldUntil: null, slowedUntil: null,
      };
    }
    this.match = { phase: 'fighting', fighters, winner: null };
    this.pendingShots.clear();
    this.emitMatch();
    return true;
  }

  fighter(slot: PlayerSlot): FighterState | null {
    return this.match?.phase === 'fighting' ? { ...this.match.fighters[slot] } : null;
  }

  /** Handles a message from a physical (or simulated) sword. */
  handleSword(event: SwordEvent): TriggerResult | void {
    const match = this.match;
    if (!match || match.phase !== 'fighting') return;
    const now = this.now();

    if (event.type === 'sword.hit') return this.handleHit(event, now);
    if (event.type === 'sword.orientation') return; // Poses are relayed separately; they do not change rules.

    const slot = slotForSword(event.swordId);
    if (!slot) return;
    const fighter = match.fighters[slot];
    const spell = getSpell(fighter.spellId);

    switch (event.type) {
      case 'sword.button': {
        if (fighter.castPhase !== 'enter') return;
        if (event.color === spell.combo[fighter.entered]) {
          fighter.entered += 1;
          if (fighter.entered === spell.combo.length) fighter.castPhase = 'motion';
        } else {
          // A wrong button restarts the sequence (and counts as the first press if it matches).
          fighter.entered = event.color === spell.combo[0] ? 1 : 0;
        }
        this.emitMatch();
        return;
      }
      case 'sword.gesture': {
        if (fighter.castPhase !== 'motion' || event.gesture !== spell.gesture) return;
        // Ice Blast's slow: a slowed player gets half the time to aim.
        const slowed = fighter.slowedUntil !== null && fighter.slowedUntil > now;
        fighter.castPhase = 'armed';
        fighter.armedAt = now;
        fighter.armedUntil = now + (slowed ? ARMED_WINDOW_MS / 2 : ARMED_WINDOW_MS);
        this.emitMatch();
        return;
      }
      case 'sword.trigger': {
        if (fighter.castPhase !== 'armed') return 'ignored';
        this.emitEvent({ kind: 'cast', slot, spellId: spell.id }, now);
        let result: TriggerResult;
        if (spell.selfCast) {
          fighter.shieldUntil = now + (spell.shieldMs ?? 0);
          result = 'self-cast';
        } else {
          this.pendingShots.set(event.shotId, { attacker: slot, spellId: spell.id, firedAt: now });
          result = 'fired';
        }
        this.nextSpell(fighter);
        this.emitMatch();
        return result;
      }
    }
  }

  /** Call regularly (~10 Hz) to expire armed spells and unanswered shots. */
  tick() {
    const match = this.match;
    if (!match || match.phase !== 'fighting') return;
    const now = this.now();
    let changed = false;
    for (const fighter of Object.values(match.fighters)) {
      if (fighter.castPhase === 'armed' && fighter.armedUntil !== null && now > fighter.armedUntil) {
        this.emitEvent({ kind: 'fizzle', slot: fighter.slot, spellId: fighter.spellId }, now);
        this.nextSpell(fighter);
        changed = true;
      }
    }
    for (const [shotId, shot] of this.pendingShots) {
      if (now - shot.firedAt > SHOT_TTL_MS) {
        this.pendingShots.delete(shotId);
        this.emitEvent({ kind: 'miss', attacker: shot.attacker, spellId: shot.spellId }, now);
      }
    }
    if (changed) this.emitMatch();
  }

  private handleHit(event: Extract<SwordEvent, { type: 'sword.hit' }>, now: number) {
    const match = this.match!;
    const shot = this.pendingShots.get(event.shotId);
    const attacker = slotForSword(event.attackerSwordId);
    const victim = slotForSword(event.victimSwordId);
    // Ignore unknown, repeated, stale, or self hits. One IR shot can be received several times.
    if (!shot || this.usedShots.has(event.shotId) || !attacker || !victim) return;
    if (shot.attacker !== attacker || victim !== otherSlot(attacker) || now - shot.firedAt > SHOT_TTL_MS) return;
    this.pendingShots.delete(event.shotId);
    this.usedShots.add(event.shotId);

    const target = match.fighters[victim];
    const spell = getSpell(shot.spellId);
    const blocked = target.shieldUntil !== null && target.shieldUntil > now;
    const damage = blocked ? 0 : spell.damage;
    target.hp = Math.max(0, target.hp - damage);
    if (!blocked && spell.slowMs) target.slowedUntil = now + spell.slowMs;
    this.emitEvent({ kind: 'hit', attacker, victim, spellId: spell.id, damage, blocked }, now);
    if (target.hp === 0) {
      match.phase = 'over';
      match.winner = attacker;
    }
    this.emitMatch();
  }

  private nextSpell(fighter: FighterState) {
    fighter.spellId = pick(SPELLS).id;
    fighter.entered = 0;
    fighter.castPhase = 'enter';
    fighter.armedAt = null;
    fighter.armedUntil = null;
  }

  private emitLobby() { this.emit({ type: 'lobby.state', lobby: this.lobby() }); }
  private emitMatch() { this.emit({ type: 'match.state', match: this.match ? structuredClone(this.match) : null }); }
  private emitEvent(event: MatchEvent, at: number) { this.emit({ type: 'match.event', event, at }); }
}

// Each player slot owns one sword. The real server will pair sword device IDs to players in the lobby.
export const swordIdFor = (slot: PlayerSlot) => (slot === 'p1' ? 'sword-1' : 'sword-2');
const slotForSword = (swordId: string): PlayerSlot | null =>
  swordId === 'sword-1' ? 'p1' : swordId === 'sword-2' ? 'p2' : null;
