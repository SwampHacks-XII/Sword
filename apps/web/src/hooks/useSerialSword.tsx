import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SWORD_COLORS, SWORD_FIRE_WINDOW_MS, getSpell, type FighterState, type PhysicalSwordNumber, type SwordColor } from '../game/types';
import { openSerialSword, parseSwordLine, serialSupported, swordNumberOf, swordSpellNumber, type SwordEvent, type SwordLink } from '../net/serialSword';
import { bluetoothSupported, openBluetoothSword } from '../net/bluetoothSword';
import { useMatch } from './useMatch';

/** `waiting`: the port is open but the sword has not answered yet (it takes a few seconds to boot). */
export type SerialSwordStatus = 'disconnected' | 'connecting' | 'waiting' | 'ready';
export type SwordTransport = 'usb' | 'bluetooth';

interface SerialSwordValue {
  /** Which ways of connecting this browser offers. */
  supported: Record<SwordTransport, boolean>;
  /** How the current sword is connected, if it is. */
  transport: SwordTransport | null;
  status: SerialSwordStatus;
  /** The connected sword's real SWORD_ID, once it has said anything. */
  swordNumber: PhysicalSwordNumber | null;
  /** The sword is firing IR for a cast spell. It stops on a hit, a miss, or after 10 s. */
  firing: boolean;
  firingUntil: number | null;
  error: string | null;
  connect: (transport: SwordTransport) => void;
  disconnect: () => void;
}

const POSE_INTERVAL_MS = 50; // Forward at most ~20 poses a second; the server relays them at ~30 Hz.
const PING_MS = 1000;
const ANSWER_MS = 2500; // Give up on a heal or spell the game never confirmed, and free the sword.

const SerialSwordContext = createContext<SerialSwordValue | null>(null);

const canHeal = (f: FighterState, now: number) =>
  f.healUsesRemaining > 0 && f.hp < f.maxHp && (f.healReadyAt === null || now >= f.healReadyAt);

/** A button that is wrong both for the next rune and for rune 1, so the game's sequence restarts at 0 like the sword's. */
const resetColor = (combo: SwordColor[], entered: number) =>
  SWORD_COLORS.find(color => color !== combo[0] && color !== combo[entered])!;

/**
 * Keeps one physical sword connected across screens and translates between its events and the game.
 * The sword checks buttons and motions itself; every step is mirrored to the game, which stays in charge
 * of spells, damage and healing. Real IR hits are reported by the victim's sword.
 */
export function SerialSwordProvider({ children }: { children: ReactNode }) {
  const { match, lobby, log, onlineStatus, send, connectionKind } = useMatch();
  const [status, setStatus] = useState<SerialSwordStatus>('disconnected');
  const [transport, setTransport] = useState<SwordTransport | null>(null);
  const [firingUntil, setFiringUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swordNumber, setSwordNumber] = useState<PhysicalSwordNumber | null>(null);

  const link = useRef<SwordLink | null>(null);
  const nextToken = useRef(1 + Math.floor(Math.random() * 255));
  const awaitingSpell = useRef(false);
  /** The spell the sword is entering, and how many of its buttons the game has been told about. */
  const spell = useRef<{ token: number; spellId: string; forwarded: number } | null>(null);
  const firingToken = useRef<number | null>(null);
  const pendingHeal = useRef<number | null>(null);
  const answerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pingTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const lastPoseAt = useRef(0);
  const lastLogId = useRef(0);

  const online = lobby?.mode === 'online';
  const canAct = match?.phase === 'fighting' && !!lobby
    && (!online || (onlineStatus === 'open' && lobby.players.every(p => p.connected)));
  const fighter = canAct ? match.fighters[lobby.you] : null;
  const latest = useRef({ fighter, send });
  latest.current = { fighter, send };

  const write = (line: string) => link.current?.write(line);
  const token = () => { const t = nextToken.current; nextToken.current = t % 255 + 1; return t; };
  const clearSpell = () => {
    awaitingSpell.current = false; spell.current = null; pendingHeal.current = null;
    firingToken.current = null; setFiringUntil(null); clearTimeout(answerTimer.current);
  };
  /** If the game never answers, send K so the sword is not stuck waiting. */
  const expectAnswer = () => {
    clearTimeout(answerTimer.current);
    answerTimer.current = setTimeout(() => {
      if (awaitingSpell.current || pendingHeal.current !== null) { awaitingSpell.current = false; pendingHeal.current = null; write('K'); }
    }, ANSWER_MS);
  };

  /** Hands the game's assigned spell to the sword once the player has picked its difficulty there. */
  const assignSpell = useCallback((f: FighterState) => {
    if (!awaitingSpell.current || f.castPhase !== 'enter' || !f.spellId) return;
    awaitingSpell.current = false;
    clearTimeout(answerTimer.current);
    // The sword starts at rune 0; if keys were pressed meanwhile, restart the game's count too.
    if (f.entered > 0) latest.current.send({ type: 'dev.sword', input: { kind: 'button', color: resetColor(getSpell(f.spellId).combo, f.entered) } });
    const t = token();
    spell.current = { token: t, spellId: f.spellId, forwarded: 0 };
    link.current?.write(`C,${t},${swordSpellNumber(f.spellId)}`);
  }, []);

  useEffect(() => { if (fighter) assignSpell(fighter); }, [fighter?.castPhase, fighter?.spellId, assignSpell]);

  const handleEvent = (event: SwordEvent) => {
    const { fighter, send } = latest.current;
    // STEP is a cumulative count. BLE may drop a notification; later counts
    // still prove that the sword accepted all preceding runes.
    const forwardRunes = (current: NonNullable<typeof spell.current>, count: number) => {
      const combo = getSpell(current.spellId).combo;
      if (!fighter || count > combo.length || count <= current.forwarded) return;
      while (current.forwarded < count) {
        const color = combo[current.forwarded++]!;
        send({ type: 'dev.sword', input: { kind: 'button', color } });
      }
    };
    switch (event.kind) {
      case 'select': {
        if (!fighter) { write('K'); return; }
        if (event.choice === 'heal') {
          if (!canHeal(fighter, Date.now())) { write('K'); return; }
          pendingHeal.current = token();
          send({ type: 'player.heal' });
          expectAnswer();
          return;
        }
        awaitingSpell.current = true;
        if (fighter.castPhase === 'choose') { send({ type: 'spell.choose', difficulty: event.choice }); expectAnswer(); }
        // The game already assigned a spell (e.g. the sword was reset): resume it if the difficulty matches.
        else if (fighter.castPhase === 'enter' && fighter.spellId && getSpell(fighter.spellId).difficulty === event.choice) assignSpell(fighter);
        else { awaitingSpell.current = false; write('K'); }
        return;
      }
      case 'step': {
        const current = spell.current;
        if (!current || current.token !== event.token) return;
        forwardRunes(current, event.count);
        return;
      }
      case 'reset': {
        const current = spell.current;
        if (!current || current.token !== event.token || current.forwarded === 0) return;
        send({ type: 'dev.sword', input: { kind: 'button', color: resetColor(getSpell(current.spellId).combo, current.forwarded) } });
        current.forwarded = 0;
        return;
      }
      case 'fire': {
        const current = spell.current;
        if (!fighter || !current || current.token !== event.token) return;
        // FIRE confirms the entire sequence even if its final STEP was lost.
        forwardRunes(current, getSpell(current.spellId).combo.length);
        spell.current = null;
        firingToken.current = event.token;
        setFiringUntil(Date.now() + SWORD_FIRE_WINDOW_MS);
        // The game's motion step is done by the sword; perform it and fire with the IR token.
        send({ type: 'dev.sword', input: { kind: 'gesture', gesture: getSpell(current.spellId).gesture } });
        send({ type: 'dev.sword', input: { kind: 'trigger', shot: event.token } });
        return;
      }
      case 'end':
        if (firingToken.current === event.token) { firingToken.current = null; setFiringUntil(null); }
        return;
      case 'hit':
        if (fighter) send({ type: 'sword.hit', shot: event.token });
        return;
      case 'pose': {
        const now = Date.now();
        if (!fighter || now - lastPoseAt.current < POSE_INTERVAL_MS) return;
        lastPoseAt.current = now;
        send({ type: 'sword.pose', q: event.q });
        return;
      }
      case 'ready': // Back at selection.
        awaitingSpell.current = false; spell.current = null;
        firingToken.current = null; setFiringUntil(null);
        return;
      case 'start': case 'motion': case 'alive':
        return;
    }
  };
  const handleRef = useRef(handleEvent);
  handleRef.current = handleEvent;

  const onLine = useCallback((line: string) => {
    const number = swordNumberOf(line);
    if (number) setSwordNumber(number);
    const event = parseSwordLine(line);
    if (!event) return;
    if (pingTimer.current !== undefined) {
      // First answer: zero the 3D pose (the player is holding it upright) and start fresh.
      clearInterval(pingTimer.current); pingTimer.current = undefined;
      setStatus('ready');
      link.current?.write('Z');
      link.current?.write('N');
    }
    handleRef.current(event);
  }, []);

  // Tell the sword when a battle starts or ends.
  const phase = match?.phase ?? null;
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (phase === lastPhase.current) return;
    lastPhase.current = phase;
    if (status !== 'ready') return;
    if (phase === 'fighting') { clearSpell(); write('N'); }
    else if (phase === 'over') { clearSpell(); write('G'); }
  }, [phase, status]);

  // Confirm heals, and stop the sword firing once its shot has landed or missed.
  useEffect(() => {
    const you = lobby?.you;
    for (const { id, event } of log) {
      if (id <= lastLogId.current) continue;
      lastLogId.current = id;
      if (event.kind === 'heal' && event.slot === you && pendingHeal.current !== null) {
        write(`H,${pendingHeal.current},${event.amount}`);
        pendingHeal.current = null;
      } else if (event.kind === 'hit' && event.attacker === you && firingToken.current !== null) {
        write(`S,${firingToken.current}`);
        setFiringUntil(null);
      } else if (event.kind === 'miss' && event.attacker === you && firingToken.current !== null) {
        write('K');
        setFiringUntil(null);
      }
    }
  }, [log, lobby?.you]);

  // Let the game know whether real IR decides hits against this player.
  const linkReady = status === 'ready';
  useEffect(() => {
    if (!lobby || (connectionKind === 'ws' && onlineStatus !== 'open')) return;
    send({ type: 'sword.link', connected: linkReady, ...(linkReady && swordNumber ? { number: swordNumber } : {}) });
  }, [linkReady, swordNumber, lobby?.code, onlineStatus, connectionKind, send]);

  const reset = () => {
    clearInterval(pingTimer.current); pingTimer.current = undefined;
    link.current = null; clearSpell();
    setStatus('disconnected'); setTransport(null); setSwordNumber(null);
  };

  const connect = useCallback((via: SwordTransport) => {
    if (link.current) return;
    setError(null);
    setStatus('connecting');
    setTransport(via);
    const open = via === 'usb' ? openSerialSword : openBluetoothSword;
    const lost = via === 'usb' ? 'The sword was unplugged.' : 'Lost the Bluetooth connection to the sword. Check it is on and nearby, then connect again.';
    open(onLine, () => { reset(); setError(lost); }).then(opened => {
      link.current = opened;
      setStatus('waiting');
      // Over USB the ESP32 restarts when the port opens; keep asking until it answers.
      opened.write('P');
      pingTimer.current = setInterval(() => link.current?.write('P'), PING_MS);
    }, (cause: unknown) => {
      setStatus('disconnected'); setTransport(null);
      // Closing the port or device picker is not an error.
      if (!(cause instanceof DOMException && cause.name === 'NotFoundError')) {
        setError(cause instanceof Error ? cause.message : 'Could not open the sword.');
      }
    });
  }, [onLine]);

  const disconnect = useCallback(() => {
    const current = link.current;
    reset();
    void current?.close();
  }, []);

  useEffect(() => () => {
    clearInterval(pingTimer.current); clearTimeout(answerTimer.current);
    void link.current?.close(); link.current = null;
  }, []);

  const value = useMemo<SerialSwordValue>(
    () => ({ supported: { usb: serialSupported(), bluetooth: bluetoothSupported() }, transport, status, swordNumber, firing: firingUntil !== null, firingUntil, error, connect, disconnect }),
    [transport, status, swordNumber, firingUntil, error, connect, disconnect],
  );
  return <SerialSwordContext value={value}>{children}</SerialSwordContext>;
}

export function useSerialSword(): SerialSwordValue {
  const value = useContext(SerialSwordContext);
  if (!value) throw new Error('useSerialSword must be used inside <SerialSwordProvider>.');
  return value;
}
