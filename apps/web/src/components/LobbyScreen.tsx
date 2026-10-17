import { PLAYER_SLOTS, type LobbyState } from '../game/types';
import { useMatch } from '../hooks/useMatch';
import { Parchment } from './Parchment';
import { SwordConnectPanel } from './SwordConnectPanel';

export function LobbyScreen({ lobby }: { lobby: LobbyState }) {
  const { send, error } = useMatch();
  const ready = lobby.players.filter((p) => p.connected).length === 2;

  return (
    <div className="menu-layout">
      <Parchment title="Lobby" className="lobby">
        <p className="label">Room code</p>
        <p className="room-code">{lobby.code}</p>
        <button type="button" className="link-button small" onClick={() => void navigator.clipboard?.writeText(lobby.code)}>
          copy code
        </button>
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
          <button type="button" className="link-button" disabled={!ready} onClick={() => send({ type: 'match.start' })}>
            start battle
          </button>
          <button type="button" className="link-button" onClick={() => send({ type: 'lobby.leave' })}>leave</button>
        </div>
        {error && <p className="error">{error}</p>}
      </Parchment>
      <SwordConnectPanel />
    </div>
  );
}
