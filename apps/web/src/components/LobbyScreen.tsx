import { useEffect, useRef, useState } from 'react';
import { PLAYER_SLOTS, type LobbyState } from '../game/types';
import { useMatch } from '../hooks/useMatch';
import { Parchment } from './Parchment';
import { SwordConnectPanel } from './SwordConnectPanel';
import { NpcGuide } from './NpcGuide';
import { MossCommandInput } from './MossCommandInput';
import { parseMossLobbyCommand, planLobbyControl, type MossLobbyCommand } from '../story/commands';
import { MOSS_COMMAND_REPLIES } from '@sword/protocol';

export function LobbyScreen({ lobby, onVoiceReply, stopVoice }: {
  lobby: LobbyState; onVoiceReply(text: string): Promise<boolean>; stopVoice(): void;
}) {
  const { send, error, onlineStatus, pending } = useMatch();
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const mounted = useRef(true);
  const latestStopVoice = useRef(stopVoice); latestStopVoice.current = stopVoice;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (actingRef.current) latestStopVoice.current(); };
  }, []);
  const ready = lobby.players.filter((p) => p.connected).length === 2;
  const online = lobby.mode === 'online';
  const host = !online || lobby.you === 'p1';
  const context = { lobby, pending, onlineStatus };
  const latestContext = useRef(context); latestContext.current = context;
  const start = planLobbyControl({ kind: 'begin' }, context);
  const leave = planLobbyControl({ kind: 'leave' }, context);
  async function submitCommand(command: MossLobbyCommand, voice = false) {
    if (actingRef.current) return;
    const plan = planLobbyControl(command, context);
    if (!plan.ok) { if (voice) void onVoiceReply(plan.reply); return; }
    if (!voice) { send(plan.message); return; }
    actingRef.current = true; setActing(true);
    try {
      if (!await onVoiceReply(plan.reply) || !mounted.current) return;
      const refreshed = planLobbyControl(command, latestContext.current);
      if (refreshed.ok) send(refreshed.message);
      else void onVoiceReply(refreshed.reply);
    } finally { actingRef.current = false; if (mounted.current) setActing(false); }
  }
  function voiceCommand(text: string) {
    const command = parseMossLobbyCommand(text);
    if (command) void submitCommand(command, true);
    else void onVoiceReply(MOSS_COMMAND_REPLIES.lobbyUnknown);
  }

  return (
    <div className="menu-layout">
      <Parchment className="story-scroll lobby">
        <h1>Your story’s party.</h1>
        <p className="label">{online ? 'Your secret room code' : 'Swamp Bot awaits'}</p>
        {online && <p className="room-code">{lobby.code}</p>}
        {online && <button type="button" className="link-button small" onClick={() => void navigator.clipboard?.writeText(lobby.code).catch(() => undefined)}>
          copy code
        </button>}
        <p className="hint">{online ? 'Share this code with a friend. Both players use their own account.' : 'A local game with Swamp Bot. No login or hardware needed.'}</p>
        <ul className="slots">
          {PLAYER_SLOTS.map((slot) => {
            const player = lobby.players.find((p) => p.slot === slot);
            return (
              <li key={slot} className={`slot slot-${slot}`}>
                <span className="slot-name">
                  {player ? player.name : `Player ${slot === 'p1' ? 1 : 2}`}
                  {slot === lobby.you && ' (you)'}
                </span>
                <span className={player?.connected ? 'status-ok' : 'status-wait'}>
                  {player?.connected ? 'Connected' : 'Waiting…'}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="row">
          <button type="button" className="quest-button" disabled={acting || !start.ok} onClick={() => void submitCommand({ kind: 'begin' })}>
            Start my quest <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="link-button" disabled={acting || !leave.ok} onClick={() => void submitCommand({ kind: 'leave' })}>leave</button>
        </div>
        <MossCommandInput disabled={pending || acting} onTranscript={voiceCommand} stopVoice={stopVoice}
          example="Try “Hey Moss, start my quest” or “leave the room.”" />
        {acting && <p className="hint" role="status">Moss is answering before turning the page…</p>}
        {online && !host && <p className="hint">Waiting for the host to begin your quest.</p>}
        {online && onlineStatus !== 'open' && <p className="error" role="status">Connecting to the server…</p>}
        {error && <p className="error">{error}</p>}
        <NpcGuide message={ready ? 'The swords are gathered. Shall we turn the page?' : 'A hero’s reflection is never far behind.'} />
      </Parchment>
      <SwordConnectPanel />
    </div>
  );
}
