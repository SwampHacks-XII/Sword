import { PLAYER_SLOTS, type LobbyState } from '../game/types';
import { useMatch } from '../hooks/useMatch';
import { Parchment } from './Parchment';
import { SwordConnectPanel } from './SwordConnectPanel';

export function LobbyScreen({ lobby }: { lobby: LobbyState }) {
  const { send, error, onlineStatus, pending } = useMatch();
  const ready = lobby.players.filter((p) => p.connected).length === 2;
  const online = lobby.mode === 'online';
  const host = !online || lobby.you === 'p1';

  return (
    <div className="menu-layout">
      <Parchment title="Lobby" className="lobby">
        <p className="label">{online ? 'Online room code' : 'Swamp Bot practice'}</p>
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
          <button type="button" className="link-button" disabled={!host || !ready || pending || (online && onlineStatus !== 'open')} onClick={() => send({ type: 'match.start' })}>
            start battle
          </button>
          <button type="button" className="link-button" onClick={() => send({ type: 'lobby.leave' })}>leave</button>
        </div>
        {online && !host && <p className="hint">Waiting for the host to start the battle.</p>}
        {online && onlineStatus !== 'open' && <p className="error" role="status">Connecting to the server…</p>}
        {error && <p className="error">{error}</p>}
      </Parchment>
      <SwordConnectPanel />
    </div>
  );
}
