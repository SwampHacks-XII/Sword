import { useEffect, useRef, useState } from 'react';
import { PLAYER_SLOTS, type LobbyState } from '../game/types';
import { useMatch } from '../hooks/useMatch';
import { MossCommandInput } from './MossCommandInput';
import { parseMossLobbyCommand, planLobbyControl, type MossLobbyCommand } from '../story/commands';
import { MOSS_COMMAND_REPLIES } from '@sword/protocol';
import type { BookSpread } from './BookMenu';
import { Knight } from './Knight';
import { confirmLeaveGame } from '../story/confirmLeaveGame';
import { navigate, useScreen } from '../hooks/useScreen';

/** Start/leave by button or voice. Voice commands wait for Moss to finish replying before acting. */
export function useLobbyControls(lobby: LobbyState | null, { onVoiceReply, stopVoice }: {
  onVoiceReply(text: string): Promise<boolean>; stopVoice(): void;
}) {
  const { send, onlineStatus, pending } = useMatch();
  const screen = useScreen();
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const mounted = useRef(true);
  const latestStopVoice = useRef(stopVoice); latestStopVoice.current = stopVoice;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (actingRef.current) latestStopVoice.current(); };
  }, []);
  const context = lobby && { lobby, pending, onlineStatus };
  const latestContext = useRef(context); latestContext.current = context;
  const start = context ? planLobbyControl({ kind: 'begin' }, context) : null;
  const leave = context ? planLobbyControl({ kind: 'leave' }, context) : null;
  async function submitCommand(command: MossLobbyCommand, voice = false) {
    if (actingRef.current || !context) return;
    const plan = planLobbyControl(command, context);
    if (!plan.ok) { if (voice) void onVoiceReply(plan.reply); return; }
    if (!voice && command.kind !== 'leave') { send(plan.message); return; }
    actingRef.current = true; setActing(true);
    try {
      if (command.kind === 'leave' && !await confirmLeaveGame()) return;
      if (!mounted.current || !latestContext.current) return;
      if (voice && !await onVoiceReply(plan.reply)) return;
      if (!mounted.current || !latestContext.current) return;
      const refreshed = planLobbyControl(command, latestContext.current);
      if (refreshed.ok) { send(refreshed.message); return true; }
      else void onVoiceReply(refreshed.reply);
    } finally { actingRef.current = false; if (mounted.current) setActing(false); }
  }
  async function leaveGame(voice = false) {
    if (await submitCommand({ kind: 'leave' }, voice) && screen === 'practice') navigate('login');
  }
  function voiceCommand(text: string) {
    const command = parseMossLobbyCommand(text);
    if (command?.kind === 'leave') void leaveGame(true);
    else if (command) void submitCommand(command, true);
    else void onVoiceReply(MOSS_COMMAND_REPLIES.lobbyUnknown);
  }
  return { acting, canStart: !!start?.ok, canLeave: !!leave?.ok, submitCommand, leaveGame, voiceCommand, stopVoice };
}

/** The party on the left page; the party code and the call to begin on the right. */
export function lobbySpread(lobby: LobbyState | null, { error, onlineStatus, pending }: ReturnType<typeof useMatch>,
  { acting, canStart, canLeave, submitCommand, leaveGame, voiceCommand, stopVoice }: ReturnType<typeof useLobbyControls>, voiceActive = false): BookSpread {
  // Before any lobby exists this spread is never shown, but the book still needs pages for it.
  if (!lobby) return { left: { kicker: 'Your party' }, right: { kicker: 'Party code' } };
  const online = lobby.mode === 'online';
  const host = !online || lobby.you === 'p1';

  return {
    left: {
      kicker: 'Your story’s party',
      content: <ul className="book-party">
        {PLAYER_SLOTS.map((slot) => {
          const player = lobby.players.find((p) => p.slot === slot);
          const ready = player?.connected && (!online || player.ready === true);
          return (
            <li key={slot} className={`book-party-member book-party-${slot} ${ready ? '' : 'is-waiting'}`}>
              <Knight />
              <span className="slot-name">
                {player ? player.name : `Player ${slot === 'p1' ? 1 : 2}`}
                {slot === lobby.you && ' (you)'}
              </span>
              <span className={ready ? 'status-ok' : 'status-wait'}>
                {ready ? 'Connected' : player?.connected ? 'Connecting sword…' : player ? 'Disconnected' : 'Waiting…'}
              </span>
            </li>
          );
        })}
      </ul>,
    },
    right: {
      kicker: online ? 'Party code' : 'A practice duel',
      content: <div className="book-form book-lobby">
        {online ? <>
          <p className="room-code">{lobby.code}</p>
          <button type="button" className="link-button small" onClick={() => void navigator.clipboard?.writeText(lobby.code).catch(() => undefined)}>
            copy code
          </button>
        </> : <p className="label">Swamp Bot awaits</p>}
        <p className="hint">{online ? 'Share this code with a friend. Both players use their own account.' : 'A local game with Swamp Bot. No login or hardware needed.'}</p>
        <div className="row">
          <button type="button" className="quest-button" disabled={acting || !canStart} onClick={() => void submitCommand({ kind: 'begin' })}>
            Start my quest <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="secondary-button leave-game-button" disabled={acting || !canLeave} onClick={() => void leaveGame()}>Leave game <span aria-hidden="true">↗</span></button>
        </div>
        <MossCommandInput active={voiceActive} disabled={pending || acting} onTranscript={voiceCommand} stopVoice={stopVoice}
          example="Try “Hey Moss, start my quest” or “leave the room.”" />
        {acting && <p className="hint" role="status">Moss is answering before turning the page…</p>}
        {online && !host && <p className="hint">Waiting for the host to begin your quest.</p>}
        {online && lobby.players.some(player => player.connected && !player.ready) && <p className="hint" role="status">Both players must finish the sword setup page before the quest can start.</p>}
        {online && onlineStatus !== 'open' && <p className="error" role="status">Connecting to the server…</p>}
        {error && <p className="error">{error}</p>}
      </div>,
    },
  };
}
