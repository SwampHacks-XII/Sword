import { useState, type FormEvent } from 'react';
import { useMatch } from '../hooks/useMatch';
import { Parchment } from './Parchment';
import { SwordConnectPanel } from './SwordConnectPanel';

export function MainMenu() {
  const { send, error } = useMatch();
  const [name, setName] = useState('Player 1');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [showConnection, setShowConnection] = useState(false);

  function join(event: FormEvent) {
    event.preventDefault();
    if (code.trim()) send({ type: 'lobby.join', code, name });
  }

  return (
    <div className="menu-layout">
      <Parchment className="main-menu">
        <h1 className="game-title">Sword</h1>
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <nav className="menu-links">
          <button type="button" className="link-button" onClick={() => send({ type: 'lobby.create', name })}>
            create lobby
          </button>
          {joining ? (
            <form className="join-form" onSubmit={join}>
              <input
                aria-label="Room code" placeholder="ROOM CODE" value={code} autoFocus
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button type="submit" className="link-button">join</button>
            </form>
          ) : (
            <button type="button" className="link-button" onClick={() => setJoining(true)}>join lobby</button>
          )}
          <button type="button" className="link-button" onClick={() => setShowConnection((v) => !v)}>
            connection
          </button>
        </nav>
        {error && <p className="error">{error}</p>}
      </Parchment>
      {showConnection && <SwordConnectPanel />}
    </div>
  );
}
