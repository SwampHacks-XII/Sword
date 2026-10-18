import { createPoseSimulator, prepareQuest, type QuestStory } from '@sword/protocol';
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
const LIVE_POSE_MS = 500; // A USB sword that stops reporting falls back to the keyboard animation.
const BOT_NAME = 'Swamp Bot';
const YOUR_HIT_CHANCE = 0.85; // Pretend aim: real IR depends on where the sword points.
const BOT_HIT_CHANCE = 0.6;
const CHECK_ORDER: CheckId[] = ['pairing', 'lights', 'motion', 'camera'];

export type BotStoryLoader = (sessionId: string, roundNumber: number) => Promise<QuestStory>;
export function createMockConnection(loadStory?: BotStoryLoader): GameConnection {
  const listeners = new Set<(message: ServerMessage) => void>();
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  let open = true;
  let you: PlayerSlot = 'p1';
  let botSlot: PlayerSlot | null = null;
  let botNextActionAt = 0;
  let shotCounter = 0;
  let quest: Extract<ServerMessage, { type: 'quest.state' }>['quest'] = null;
  let sessionId = '';
  let roundNumber = 1;
  let previousBriefings: string[] = [];
  let briefing: ReturnType<typeof prepareQuest> | undefined;
  let livePose: { q: Quat; at: number } | null = null;

  function prepareBriefing() {
    briefing?.dispose();
    const id = sessionId;
    briefing = prepareQuest({ roundNumber, previousBriefings: [...previousBriefings] },
      loadStory ? (context => loadStory(id, context.roundNumber)) : undefined);
  }
  function newAdventure() {
    quest = null;
    roundNumber = 1;
    previousBriefings = [];
    // This is only an idempotency key; authentication is supplied separately by Auth0.
    sessionId = globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
    prepareBriefing();
  }

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
    if (fighter.hp <= 65 && rules.heal(botSlot)) { botNextActionAt = now + 700; return; }
    if (fighter.castPhase === 'choose') {
      const choices = ['easy', 'medium', 'hard'] as const;
      rules.chooseSpell(botSlot, choices[Math.floor(Math.random() * choices.length)]!);
      botNextActionAt = now + 700;
      return;
    }
    if (!fighter.spellId) return;
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
    for (const slot of ['p1', 'p2'] as const) {
      const live = slot === you && livePose && now - livePose.at < LIVE_POSE_MS ? livePose.q : null;
      deliver({ type: 'sword.pose', slot, q: live ?? poses.sample(slot, now) });
    }
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
          newAdventure();
          deliver({ type: 'quest.state', quest: null });
          you = 'p1';
          botSlot = 'p2';
          rules.openLobby(randomRoomCode(), you, message.name);
          later(() => rules.addPlayer('p2', BOT_NAME), 1000);
          break;
        case 'lobby.join':
          newAdventure();
          // In the mock, any code joins a room hosted by the bot.
          you = 'p2';
          botSlot = 'p1';
          rules.openLobby(message.code.trim().toUpperCase() || randomRoomCode(), you, message.name);
          later(() => rules.addPlayer('p1', BOT_NAME), 300);
          break;
        case 'lobby.leave':
          quest = null;
          briefing?.dispose();
          deliver({ type: 'quest.state', quest: null });
          botSlot = null;
          rules.leave();
          break;
        case 'device.check':
          runDeviceChecks();
          break;
        case 'match.start':
          if (quest) break;
          if (rules.startMatch()) botNextActionAt = Date.now() + 2500;
          break;
        case 'quest.begin':
          if (!rules.lobby() || rules.lobby()!.players.length < 2 || rules.snapshot() || quest) break;
          quest = { accepted: botSlot ? [botSlot] : [], story: briefing?.peek() ?? null, roundNumber };
          const currentQuest = quest;
          if (quest.story) previousBriefings = [...previousBriefings, quest.story.briefing].slice(-20);
          deliver({ type: 'quest.state', quest: { ...quest } });
          if (!quest.story && briefing) void briefing.get().then(story => {
            if (!open || quest !== currentQuest) return;
            quest.story = story;
            previousBriefings = [...previousBriefings, story.briefing].slice(-20);
            deliver({ type: 'quest.state', quest: { ...quest } });
          });
          break;
        case 'quest.accept':
          if (!quest?.story) break;
          quest = null;
          deliver({ type: 'quest.state', quest: null });
          if (rules.startMatch()) botNextActionAt = Date.now() + 2500;
          break;
        case 'match.rematch':
          if (!rules.returnToLobby()) break;
          quest = null;
          roundNumber++;
          prepareBriefing();
          deliver({ type: 'quest.state', quest: null });
          break;
        case 'dev.sword': {
          const { input } = message;
          if (input.kind === 'button') rules.handleSword({ type: 'sword.button', swordId: swordIdFor(you), color: input.color });
          else if (input.kind === 'gesture') gesture(you, input.gesture);
          else pressTrigger(you);
          break;
        }
        case 'sword.pose':
          if (rules.snapshot()?.phase === 'fighting') livePose = { q: message.q, at: Date.now() };
          break;
        case 'sword.link':
        case 'sword.hit':
          break; // Swamp Bot has no IR, so hits on both sides stay simulated.
        case 'spell.choose':
          rules.chooseSpell(you, message.difficulty);
          break;
        case 'player.heal':
          rules.heal(you);
          break;
      }
    },
    close() {
      open = false;
      briefing?.dispose();
      clearInterval(poseTimer);
      clearInterval(rulesTimer);
      timeouts.forEach(clearTimeout);
      timeouts.clear();
      listeners.clear();
    },
  };
}
