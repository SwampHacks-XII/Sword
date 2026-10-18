// One rules engine for the online server and the offline Swamp Bot game.
import { ARMED_WINDOW_MS, MAX_HP, SPELLS, getSpell, HEAL_USES, HEAL_RANGE, HEAL_COOLDOWN_MS, type SpellDifficulty } from './spells.js';
import {
  PLAYER_SLOTS, otherSlot,
  type CheckId, type CheckStatus, type DeviceChecks, type FighterState, type LobbyPlayer,
  type LobbyState, type MatchEvent, type MatchState, type PhysicalSwordNumber, type PlayerSlot,
} from './types.js';
import type { ServerMessage, SwordEvent } from './messages.js';

/** How long after a keyboard trigger press a hit report still counts. */
const SHOT_TTL_MS = 1000;

interface PendingShot { attacker: PlayerSlot; spellId: string; expiresAt: number; damage: number }
export type TriggerResult = 'fired' | 'self-cast' | 'ignored';

const cleanName = (name: string, fallback: string) => name.trim().slice(0, 40) || fallback;

export function randomRoomCode() {
  return Math.floor(Math.random() * 10_000).toString().padStart(4, '0');
}

export class GameRules {
  private code: string | null = null;
  private you: PlayerSlot = 'p1';
  private players: LobbyPlayer[] = [];
  private checks: DeviceChecks = { pairing: 'pending', lights: 'pending', motion: 'pending', camera: 'pending' };
  private match: MatchState | null = null;
  private pendingShots = new Map<string, PendingShot>();
  private usedShots = new Set<string>();

  constructor(private readonly emit: (message: ServerMessage) => void, private readonly now = () => Date.now(), private readonly random = Math.random) {}

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
    const sword = this.players.find(p => p.slot === slot)?.physicalSword; // Survives reconnects.
    this.players = this.players.filter((p) => p.slot !== slot);
    this.players.push({ slot, name: cleanName(name, slot === 'p1' ? 'Player 1' : 'Player 2'), swordId: swordIdFor(slot), connected: true, ...(sword ? { physicalSword: sword } : {}) });
    this.players.sort((a, b) => a.slot.localeCompare(b.slot));
    this.emitLobby();
  }

  /** Records which physical sword a player has connected (null: none). */
  setPhysicalSword(slot: PlayerSlot, sword: PhysicalSwordNumber | null) {
    const player = this.players.find(p => p.slot === slot);
    if (!player || (player.physicalSword ?? null) === sword) return;
    if (sword) player.physicalSword = sword; else delete player.physicalSword;
    this.emitLobby();
  }

  setConnected(slot: PlayerSlot, connected: boolean) {
    const player = this.players.find(p => p.slot === slot);
    if (player) player.connected = connected;
    this.emitLobby();
  }

  snapshot(): MatchState | null {
    return this.match ? structuredClone(this.match) : null;
  }

  returnToLobby(): boolean {
    if (this.match?.phase !== 'over') return false;
    this.match = null;
    this.pendingShots.clear(); this.usedShots.clear();
    this.emitLobby(); this.emitMatch();
    return true;
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
        slot, name: player.name, hp: MAX_HP, maxHp: MAX_HP, spellId: null, entered: 0,
        castPhase: 'choose', armedAt: null, armedUntil: null, shieldUntil: null, slowedUntil: null,
        healUsesRemaining: HEAL_USES, healReadyAt: null,
      };
    }
    this.match = { phase: 'fighting', fighters, winner: null };
    this.pendingShots.clear();
    this.usedShots.clear();
    this.emitMatch();
    return true;
  }

  fighter(slot: PlayerSlot): FighterState | null {
    return this.match?.phase === 'fighting' ? { ...this.match.fighters[slot] } : null;
  }

  chooseSpell(slot: PlayerSlot, difficulty: SpellDifficulty): boolean {
    const fighter = this.match?.phase === 'fighting' ? this.match.fighters[slot] : null;
    if (!fighter || fighter.castPhase !== 'choose') return false;
    const choices = SPELLS.filter(spell => spell.difficulty === difficulty);
    if (!choices.length) return false;
    fighter.spellId = choices[Math.floor(this.random() * choices.length)]!.id;
    fighter.castPhase = 'enter';
    this.emitMatch();
    return true;
  }

  heal(slot: PlayerSlot): boolean {
    const fighter = this.match?.phase === 'fighting' ? this.match.fighters[slot] : null;
    const now = this.now();
    if (!fighter || fighter.hp >= fighter.maxHp || fighter.healUsesRemaining <= 0
      || (fighter.healReadyAt !== null && now < fighter.healReadyAt)) return false;
    const before = fighter.hp;
    fighter.hp = Math.min(fighter.maxHp, fighter.hp + this.roll(HEAL_RANGE));
    fighter.healUsesRemaining--;
    fighter.healReadyAt = now + HEAL_COOLDOWN_MS;
    this.emitEvent({ kind: 'heal', slot, amount: fighter.hp - before }, now);
    this.emitMatch();
    return true;
  }

  private roll([min, max]: readonly [number, number]) { return min + Math.floor(this.random() * (max - min + 1)); }

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
    if (!fighter.spellId) return event.type === 'sword.trigger' ? 'ignored' : undefined;
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
        fighter.castPhase = 'armed';
        fighter.armedAt = now;
        fighter.armedUntil = now + ARMED_WINDOW_MS;
        this.emitMatch();
        return;
      }
      case 'sword.trigger': {
        if (fighter.castPhase !== 'armed') return 'ignored';
        if (fighter.armedUntil !== null && now > fighter.armedUntil) { this.tick(); return 'ignored'; }
        if (this.pendingShots.has(event.shotId) || this.usedShots.has(event.shotId)) return 'ignored';
        this.emitEvent({ kind: 'cast', slot, spellId: spell.id }, now);
        this.pendingShots.set(event.shotId, {
          attacker: slot, spellId: spell.id, expiresAt: now + (event.ttlMs ?? SHOT_TTL_MS), damage: this.roll(spell.damageRange),
        });
        this.nextSpell(fighter);
        this.emitMatch();
        return 'fired';
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
      if (fighter.castPhase === 'armed' && fighter.spellId && fighter.armedUntil !== null && now > fighter.armedUntil) {
        this.emitEvent({ kind: 'fizzle', slot: fighter.slot, spellId: fighter.spellId }, now);
        this.nextSpell(fighter);
        changed = true;
      }
    }
    for (const [shotId, shot] of this.pendingShots) {
      if (now > shot.expiresAt) {
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
    if (shot.attacker !== attacker || victim !== otherSlot(attacker) || now > shot.expiresAt) return;
    this.pendingShots.delete(event.shotId);
    this.usedShots.add(event.shotId);

    const target = match.fighters[victim];
    const spell = getSpell(shot.spellId);
    const blocked = false;
    const damage = shot.damage;
    target.hp = Math.max(0, target.hp - damage);
    this.emitEvent({ kind: 'hit', attacker, victim, spellId: spell.id, damage, blocked }, now);
    if (target.hp === 0) {
      match.phase = 'over';
      match.winner = attacker;
    }
    this.emitMatch();
  }

  private nextSpell(fighter: FighterState) {
    fighter.spellId = null;
    fighter.entered = 0;
    fighter.castPhase = 'choose';
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
