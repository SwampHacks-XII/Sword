import { MOSS_COMMAND_REPLIES } from '@sword/protocol';
import type { ClientMessage } from '../net/messages';

export type MossCommand = { kind: 'create'; mode: 'online' | 'bot' } | { kind: 'join'; code: string };
type ParsedCommand = { ok: true; command: MossCommand } | { ok: false; reason: 'unknown' | 'code' };
const digits: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', won: '1', two: '2', to: '2', too: '2',
  three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9',
};

/** One small command vocabulary; transcripts are never evaluated as code. */
export function parseMossCommand(transcript: string): ParsedCommand {
  if (transcript.length > 200) return { ok: false, reason: 'unknown' };
  const words = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:hey|hi|hello) )?moss(?: |$)/, '').replace(/^please /, '').replace(/ please$/, '');
  if (/^(?:create|make|start|open) (?:a |an |the )?(?:new )?(?:online )?(?:game|room|lobby)$/.test(words)) {
    return { ok: true, command: { kind: 'create', mode: 'online' } };
  }
  if (/^(?:play|practice|train|fight)(?: a game)? (?:with |against )?(?:the )?swamp ?bot$/.test(words)) {
    return { ok: true, command: { kind: 'create', mode: 'bot' } };
  }
  const join = /^join(?: the)?(?: (?:room|game|lobby))?(?: (?:with )?(?:the )?code)?(?: (.*))?$/.exec(words);
  if (join) {
    const tokens = (join[1] ?? '').split(' ');
    if (!tokens.every(token => /^\d+$/.test(token) || Object.hasOwn(digits, token))) return { ok: false, reason: 'code' };
    const code = tokens.map(token => digits[token] ?? token).join('');
    return /^\d{4}$/.test(code) ? { ok: true, command: { kind: 'join', code } } : { ok: false, reason: 'code' };
  }
  return { ok: false, reason: 'unknown' };
}

type LobbyAction = Extract<ClientMessage, { type: 'lobby.create' | 'lobby.join' }>;
type ActionPlan = { ok: true; message: LobbyAction; reply: string } | { ok: false; reply: string };
/** Shared by the buttons and voice so the same availability checks apply. */
export function planLobbyCommand(command: MossCommand, context: { name: string; pending: boolean; onlineAllowed: boolean }): ActionPlan {
  if (context.pending) return { ok: false, reply: MOSS_COMMAND_REPLIES.busy };
  const name = context.name.trim();
  if (!name || name.length > 40) return { ok: false, reply: MOSS_COMMAND_REPLIES.name };
  if ((command.kind === 'join' || command.mode === 'online') && !context.onlineAllowed) {
    return { ok: false, reply: MOSS_COMMAND_REPLIES.login };
  }
  if (command.kind === 'join') {
    if (!/^\d{4}$/.test(command.code)) return { ok: false, reply: MOSS_COMMAND_REPLIES.code };
    return { ok: true, message: { type: 'lobby.join', name, code: command.code },
      reply: `Got it! I’m joining room ${command.code.split('').join(', ')}.` };
  }
  return { ok: true, message: { type: 'lobby.create', name, mode: command.mode },
    reply: command.mode === 'bot' ? MOSS_COMMAND_REPLIES.bot : MOSS_COMMAND_REPLIES.create };
}
