import { PLAYER_SLOTS, type LobbyState } from '../game/types';
import type { useMatch } from '../hooks/useMatch';
import type { BookSpread } from './BookMenu';

/** The party on the left page; the party code and the call to begin on the right. */
export function lobbySpread(lobby: LobbyState | null, { send, error, onlineStatus, pending }: ReturnType<typeof useMatch>): BookSpread {
  // Before any lobby exists this spread is never shown, but the book still needs pages for it.
  if (!lobby) return { left: { kicker: 'Your party' }, right: { kicker: 'Party code' } };
  const ready = lobby.players.filter((p) => p.connected).length === 2;
  const online = lobby.mode === 'online';
  const host = !online || lobby.you === 'p1';

  return {
    left: {
      kicker: 'Your story’s party',
      content: <ul className="book-party">
        {PLAYER_SLOTS.map((slot) => {
          const player = lobby.players.find((p) => p.slot === slot);
          return (
            <li key={slot} className={`book-party-member book-party-${slot} ${player?.connected ? '' : 'is-waiting'}`}>
              <img src="/art/knight.svg" alt="" />
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
          <button type="button" className="quest-button" disabled={!host || !ready || pending || (online && onlineStatus !== 'open')} onClick={() => send({ type: 'quest.begin' })}>
            Start my quest <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="link-button" onClick={() => send({ type: 'lobby.leave' })}>leave</button>
        </div>
        {online && !host && <p className="hint">Waiting for the host to begin your quest.</p>}
        {online && onlineStatus !== 'open' && <p className="error" role="status">Connecting to the server…</p>}
        {error && <p className="error">{error}</p>}
      </div>,
    },
  };
}
