// In-browser stand-in for the game server, the opponent's laptop, and both swords.
// Lets the whole flow run with no server or hardware. Swap for a WebSocket connection later.
import { SWORD_COLORS, otherSlot, type CheckId, type Gesture, type PlayerSlot, type Quat } from '../../game/types';
import { getSpell } from '../../game/spells';
import type { GameConnection } from '../connection';
import type { ClientMessage, ServerMessage } from '../messages';
import { MockGameRules, randomRoomCode, swordIdFor } from './mockRules';

const LATENCY_MS = 15;
const POSE_INTERVAL_MS = 33; // ~30 Hz, similar to what the ESP32 would send
const RULES_INTERVAL_MS = 100;
const BOT_NAME = 'Swamp Bot';
const YOUR_HIT_CHANCE = 0.85; // Pretend aim: real IR depends on where the sword points.
const BOT_HIT_CHANCE = 0.6;
const CHECK_ORDER: CheckId[] = ['pairing', 'lights', 'motion', 'camera'];

export function createMockConnection(): GameConnection {
  const listeners = new Set<(message: ServerMessage) => void>();
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  let open = true;
  let you: PlayerSlot = 'p1';
  let botSlot: PlayerSlot | null = null;
  let botNextActionAt = 0;
  let shotCounter = 0;

  function deliver(message: ServerMessage) {
    later(() => listeners.forEach((listener) => listener(message)), LATENCY_MS);
  }
  function later(fn: () => void, ms: number) {
    if (!open) return;
    const id = setTimeout(() => { timeouts.delete(id); if (open) fn(); }, ms);
    timeouts.add(id);
  }

  const rules = new MockGameRules(deliver);
  const poses = createPoseSimulator();

  /** Simulates pressing the trigger: the sword fires IR, and the opponent's receiver may report it (twice, to exercise dedupe). */
  function pressTrigger(slot: PlayerSlot) {
    const attackerSwordId = swordIdFor(slot);
    const shotId = `${attackerSwordId}:${++shotCounter}`;
    const result = rules.handleSword({ type: 'sword.trigger', swordId: attackerSwordId, shotId });
    if (result !== 'fired') return;
    const hitChance = slot === botSlot ? BOT_HIT_CHANCE : YOUR_HIT_CHANCE;
    if (Math.random() > hitChance) return; // Missed: the rules report a miss once the shot expires.
    const hit = { type: 'sword.hit', victimSwordId: swordIdFor(otherSlot(slot)), attackerSwordId, shotId } as const;
    later(() => rules.handleSword(hit), 80);
    later(() => rules.handleSword(hit), 110);
  }

  function gesture(slot: PlayerSlot, value: Gesture) {
    poses.play(slot, value, Date.now());
    rules.handleSword({ type: 'sword.gesture', swordId: swordIdFor(slot), gesture: value });
  }

  /** A very simple opponent that casts spells through the same rules as you. */
  function botStep(now: number) {
    if (!botSlot || now < botNextActionAt) return;
    const fighter = rules.fighter(botSlot);
    if (!fighter) return;
    const spell = getSpell(fighter.spellId);
    const swordId = swordIdFor(botSlot);
    let wait = 500 + Math.random() * 500;
    if (fighter.castPhase === 'enter') {
      if (fighter.entered === 0) wait += 1200; // "reading" the new sequence
      const wrong = Math.random() < 0.1;
      const color = wrong ? SWORD_COLORS[Math.floor(Math.random() * SWORD_COLORS.length)]! : spell.combo[fighter.entered]!;
      rules.handleSword({ type: 'sword.button', swordId, color });
    } else if (fighter.castPhase === 'motion') {
      gesture(botSlot, spell.gesture);
    } else {
      pressTrigger(botSlot);
      wait += 1500;
    }
    botNextActionAt = now + wait;
  }

  const poseTimer = setInterval(() => {
    const now = Date.now();
    for (const slot of ['p1', 'p2'] as const) deliver({ type: 'sword.pose', slot, q: poses.sample(slot, now) });
  }, POSE_INTERVAL_MS);
  const rulesTimer = setInterval(() => {
    rules.tick();
    botStep(Date.now());
  }, RULES_INTERVAL_MS);

  function runDeviceChecks() {
    CHECK_ORDER.forEach((id, index) => {
      later(() => rules.setCheck(id, 'checking'), index * 700);
      later(() => rules.setCheck(id, 'ok'), index * 700 + 600);
    });
  }

  return {
    kind: 'mock',
    status: () => (open ? 'open' : 'closed'),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(message: ClientMessage) {
      if (!open) return;
      switch (message.type) {
        case 'lobby.create':
          you = 'p1';
          botSlot = 'p2';
          rules.openLobby(randomRoomCode(), you, message.name);
          later(() => rules.addPlayer('p2', BOT_NAME), 1000);
          break;
        case 'lobby.join':
          // In the mock, any code joins a room hosted by the bot.
          you = 'p2';
          botSlot = 'p1';
          rules.openLobby(message.code.trim().toUpperCase() || randomRoomCode(), you, message.name);
          later(() => rules.addPlayer('p1', BOT_NAME), 300);
          break;
        case 'lobby.leave':
          botSlot = null;
          rules.leave();
          break;
        case 'device.check':
          runDeviceChecks();
          break;
        case 'match.start':
          if (rules.startMatch()) botNextActionAt = Date.now() + 2500;
          break;
        case 'dev.sword': {
          const { input } = message;
          if (input.kind === 'button') rules.handleSword({ type: 'sword.button', swordId: swordIdFor(you), color: input.color });
          else if (input.kind === 'gesture') gesture(you, input.gesture);
          else pressTrigger(you);
          break;
        }
      }
    },
    close() {
      open = false;
      clearInterval(poseTimer);
      clearInterval(rulesTimer);
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      listeners.clear();
    },
  };
}

// ---- Fake motion sensor -------------------------------------------------------

const GESTURE_MS = 450;

function createPoseSimulator() {
  const active: Partial<Record<PlayerSlot, { gesture: Gesture; start: number }>> = {};
  return {
    play(slot: PlayerSlot, gesture: Gesture, now: number) {
      active[slot] = { gesture, start: now };
    },
    /** Idle sway plus a short animation for the latest gesture. */
    sample(slot: PlayerSlot, now: number): Quat {
      const offset = slot === 'p1' ? 0 : 1.7;
      const t = now / 1000;
      let pitch = 0.08 * Math.sin(t * 1.3 + offset);
      let yaw = 0.05 * Math.sin(t * 0.7 + offset);
      let roll = 0.06 * Math.sin(t * 0.9 + offset);
      const anim = active[slot];
      if (anim) {
        const progress = (now - anim.start) / GESTURE_MS;
        if (progress >= 1) delete active[slot];
        else {
          const k = Math.sin(Math.PI * progress);
          if (anim.gesture === 'swing_right') roll -= 1.2 * k;
          else if (anim.gesture === 'swing_left') roll += 1.2 * k;
          else if (anim.gesture === 'wrist_rotate') yaw += 2 * Math.PI * progress;
          else { pitch *= 1 - k; roll *= 1 - k; }
        }
      }
      return eulerXYZToQuat(pitch, yaw, roll);
    },
  };
}

/** Same convention as three.js Euler order 'XYZ'. Returns [w, x, y, z]. */
function eulerXYZToQuat(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    c1 * c2 * c3 - s1 * s2 * s3,
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
  ];
}
