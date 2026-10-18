// Link to a physical sword running firmware/sword/sword.ino.
// The sword speaks short comma-separated lines. Today they travel over USB (Web Serial);
// the same lines also travel over Bluetooth (Nordic UART service), so only the transport changes later.
//
//   website -> sword                        sword -> website (prefixed "S<sword id>,")
//   C,<token>,<spell id 1-9>  start spell   SEL,E|M|H|L            red/yellow/green/blue pressed while choosing
//   H,<token>,<hp>            heal approved START,<token>,<spell id>  spell accepted
//   S,<token>                 shot landed   STEP,<token>,<n>       n buttons correct · RESET,<token> wrong button
//   K                         cancel        MREADY,<token> · MSTEP,<token>,<n> · MOK,<token>   motions
//   N                         new match     FIRE,<token>           firing IR (up to 10 s)
//   G                         game over     END,<token>,T|H|C      stopped: timeout, hit, cancelled
//   P                         ping          HIT,<attacker id>,<token>  our receiver caught the opponent's shot
//   Z                         re-zero pose  HEAL,<token>,<hp> · READY · OVER · PONG · BAD_CMD
//                                           POSE,w,x,y,z           orientation (~20 Hz)
//
// Debug output (lines not starting with "S<digit>,") is ignored.
import { SPELLS, type Quat } from '../game/types';

export const SWORD_BAUD_RATE = 115200;

const DIFFICULTY = { E: 'easy', M: 'medium', H: 'hard' } as const;

export type SwordEvent =
  | { kind: 'select'; choice: 'easy' | 'medium' | 'hard' | 'heal' }
  | { kind: 'start'; token: number }
  | { kind: 'step'; token: number; count: number }
  | { kind: 'reset'; token: number }
  | { kind: 'motion'; token: number; count: number }
  | { kind: 'fire'; token: number }
  | { kind: 'end'; token: number }
  | { kind: 'hit'; token: number }
  | { kind: 'ready' }
  | { kind: 'alive' }
  | { kind: 'pose'; q: Quat };

const int = (text: string | undefined) => (text !== undefined && /^\d{1,3}$/.test(text) ? Number(text) : NaN);
const tokenOf = (text: string | undefined) => { const n = int(text); return n >= 1 && n <= 255 ? n : null; };

export function parseSwordLine(line: string): SwordEvent | null {
  const match = /^S\d,(.*)$/.exec(line.trim());
  if (!match) return null;
  const [event, a, b, ...rest] = match[1]!.split(',');
  const token = tokenOf(a);
  switch (event) {
    case 'SEL':
      if (a === 'L') return { kind: 'select', choice: 'heal' };
      return a && a in DIFFICULTY ? { kind: 'select', choice: DIFFICULTY[a as keyof typeof DIFFICULTY] } : null;
    case 'START': return token ? { kind: 'start', token } : null;
    case 'STEP': return token && int(b) >= 1 ? { kind: 'step', token, count: int(b) } : null;
    case 'RESET': return token ? { kind: 'reset', token } : null;
    case 'MSTEP': return token && int(b) >= 1 ? { kind: 'motion', token, count: int(b) } : null;
    case 'FIRE': return token ? { kind: 'fire', token } : null;
    case 'END': return token ? { kind: 'end', token } : null;
    case 'HIT': { const shot = tokenOf(b); return shot ? { kind: 'hit', token: shot } : null; }
    case 'READY': return { kind: 'ready' };
    case 'PONG': case 'OVER': case 'HEAL': case 'BOK': case 'MREADY': case 'MOK': return { kind: 'alive' };
    case 'POSE': {
      const q = [a, b, ...rest].map(Number);
      if (q.length !== 4 || !q.every(n => Number.isFinite(n) && Math.abs(n) <= 1.0001)) return null;
      return { kind: 'pose', q: q as Quat };
    }
    default: return null;
  }
}

/** The firmware numbers spells 1–9 in the same order as SPELLS. */
export const swordSpellNumber = (spellId: string) => SPELLS.findIndex(spell => spell.id === spellId) + 1;

// ---- Web Serial transport ---------------------------------------------------
// Minimal typings: Web Serial is Chromium-only and not part of TypeScript's DOM library.

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialLike { requestPort(): Promise<SerialPortLike> }
const serial = () => (globalThis.navigator as { serial?: SerialLike } | undefined)?.serial;

/** Chrome and Edge on desktop support Web Serial; Firefox and Safari do not. */
export const serialSupported = () => !!serial();

export interface SwordLink {
  write(line: string): void;
  close(): Promise<void>;
}

/** Asks the player to pick the sword's USB port (needs a click), then streams its lines to `onLine`. */
export async function openSerialSword(onLine: (line: string) => void, onClosed: () => void): Promise<SwordLink> {
  const api = serial();
  if (!api) throw new Error('This browser cannot talk to USB swords. Use Chrome or Edge on a computer.');
  const port = await api.requestPort();
  try {
    await port.open({ baudRate: SWORD_BAUD_RATE });
  } catch {
    throw new Error('Could not open that port. Close the Arduino IDE Serial Monitor (or any other program using the sword), '
      + 'and pick the ESP32’s USB port — not a “Bluetooth” one.');
  }
  if (!port.readable || !port.writable) throw new Error('The sword port opened without a data stream.');

  const decoder = new TextDecoderStream();
  const piped = port.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
  const reader = decoder.readable.getReader();
  const writer = port.writable.getWriter();
  const encoder = new TextEncoder();
  let closing = false;

  void (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) onLine(line);
        if (buffer.length > 512) buffer = ''; // Garbage without newlines (e.g. wrong baud rate).
      }
    } catch { /* Unplugged or closed. */ }
    if (!closing) { await shutdown(); onClosed(); }
  })();

  async function shutdown() {
    closing = true;
    await reader.cancel().catch(() => {});
    await piped;
    writer.releaseLock();
    await port.close().catch(() => {});
  }

  return {
    write(line) { if (!closing) void writer.write(encoder.encode(`${line}\n`)).catch(() => {}); },
    async close() { if (!closing) await shutdown(); },
  };
}
