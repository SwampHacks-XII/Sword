import { MOSS_COMMAND_REPLIES } from '@sword/protocol';
import type { ClientMessage } from '../net/messages';
import type { LobbyState } from '../game/types';
import type { ConnectionStatus } from '../net/connection';

export type MossCommand = { kind: 'create'; mode: 'online' | 'bot' } | { kind: 'join'; code: string };
export type MossMenuExitCommand = { kind: 'signout' } | { kind: 'leave' };
type ParsedCommand = { ok: true; command: MossCommand | MossMenuExitCommand } | { ok: false; reason: 'unknown' | 'code' };
const digits: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', won: '1', two: '2', to: '2', too: '2',
  three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9',
};

const commandWords = (transcript: string) => transcript.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/^please /, '').replace(/^(?:(?:hey|hi|hello) )?moss(?: |$)/, '').replace(/^please /, '')
  .replace(/^(?:(?:can|could|would|will) you|i want to|i would like to|id like to|lets) /, '')
  .replace(/^please /, '').replace(/ please$/, '');

/** One small command vocabulary; transcripts are never evaluated as code. */
export function parseMossCommand(transcript: string): ParsedCommand {
  if (transcript.length > 200) return { ok: false, reason: 'unknown' };
  const words = commandWords(transcript);
  if (/^(?:(?:sign|log)(?: me)? out|signout|logout)(?: (?:of )?(?:the )?game)?$/.test(words)) return { ok: true, command: { kind: 'signout' } };
  if (/^(?:leave|exit)(?: (?:this|the|my))? game$/.test(words)) return { ok: true, command: { kind: 'leave' } };
  if (/^(?:create|make|start|open) (?:a |an |the )?(?:new )?(?:online )?(?:game|room|lobby)$/.test(words)) {
    return { ok: true, command: { kind: 'create', mode: 'online' } };
  }
  if (/^(?:(?:play|practice|train|fight)(?: a game)? (?:with |against )?|(?:start|create|open) (?:a |the )?(?:new )?game (?:with|against) )(?:the )?(?:swamp ?)?bot$/.test(words)) {
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

export type MossLobbyCommand = { kind: 'begin' } | { kind: 'leave' };
/** The same words can have different meanings on game selection and in a room. */
export function parseMossLobbyCommand(transcript: string): MossLobbyCommand | null {
  if (transcript.length > 200) return null;
  const words = commandWords(transcript);
  if (/^(?:start|begin) (?:(?:my|our|the|a) )?(?:quest|game|adventure)$/.test(words)) return { kind: 'begin' };
  if (/^(?:leave|exit) (?:(?:this|the|my) )?(?:room|lobby|game)$/.test(words)) return { kind: 'leave' };
  return null;
}

type LobbyControlAction = Extract<ClientMessage, { type: 'quest.begin' | 'lobby.leave' }>;
type LobbyControlPlan = { ok: true; message: LobbyControlAction; reply: string } | { ok: false; reply: string };
/** Buttons and voice share the host, readiness and connection checks. */
export function planLobbyControl(command: MossLobbyCommand, context: {
  lobby: LobbyState; pending: boolean; onlineStatus: ConnectionStatus;
}): LobbyControlPlan {
  if (context.pending) return { ok: false, reply: MOSS_COMMAND_REPLIES.lobbyBusy };
  if (command.kind === 'leave') return { ok: true, message: { type: 'lobby.leave' }, reply: MOSS_COMMAND_REPLIES.leaveRoom };
  const online = context.lobby.mode === 'online';
  if (online && context.onlineStatus !== 'open') return { ok: false, reply: MOSS_COMMAND_REPLIES.reconnecting };
  if (online && context.lobby.you !== 'p1') return { ok: false, reply: MOSS_COMMAND_REPLIES.hostOnly };
  if (context.lobby.players.filter(player => player.connected).length !== 2) return { ok: false, reply: MOSS_COMMAND_REPLIES.waitForRival };
  if (online && !context.lobby.players.every(player => player.ready === true)) return { ok: false, reply: 'Both players need to finish the sword setup page before starting.' };
  return { ok: true, message: { type: 'quest.begin' }, reply: MOSS_COMMAND_REPLIES.startQuest };
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
