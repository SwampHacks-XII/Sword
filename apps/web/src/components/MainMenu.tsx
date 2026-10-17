import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMatch } from '../hooks/useMatch';
import { Parchment } from './Parchment';
import { useSession } from '../auth/SessionProvider';
import { createApi, type Profile } from '../net/api';
import { navigate } from '../hooks/useScreen';

export function MainMenu({ guestOnly = false }: { guestOnly?: boolean }) {
  const { send, error, pending } = useMatch();
  const session = useSession();
  const [accountError, setAccountError] = useState<string | null>(null);
  const editedName = useRef(false);
  const [name, setName] = useState('Player 1');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  useEffect(() => {
    if (!session.authenticated) return;
    let cancelled = false;
    if (!editedName.current && session.name) setName(session.name.slice(0, 40));
    void createApi(session.getToken).request<{ player: Profile }>('/me').then(({ player }) => {
      if (!cancelled && !editedName.current) setName(player.displayName);
    }).catch(() => { /* First-time players create their profile when entering a room. */ });
    return () => { cancelled = true; };
  }, [session.authenticated, session.getToken, session.name]);
  const validName = Boolean(name.trim());
  const canPlayOnline = !guestOnly && session.authenticated && !session.loading && validName && !pending;

  function join(event: FormEvent) {
    event.preventDefault();
    if (/^\d{4}$/.test(code.trim()) && canPlayOnline) send({ type: 'lobby.join', code, name });
  }

  return (
    <Parchment className="flow-card game-choice">
        <p className="eyebrow">Choose your next duel</p>
        <h1>{guestOnly ? 'Practice with Swamp Bot' : 'Find your opponent'}</h1>
        <p>{guestOnly ? 'A local practice game. Set your name and get ready to cast.' : 'Create a room for a friend, join their room, or train against Swamp Bot.'}</p>
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={40} disabled={pending} onChange={(e) => { editedName.current = true; setName(e.target.value); }} />
        </label>
        <div className="game-options" aria-label="Game options">
          {!guestOnly && <>
            <button type="button" className="game-option" disabled={!canPlayOnline} onClick={() => send({ type: 'lobby.create', name, mode: 'online' })}>
              <strong>Create game</strong><span>Host an online room and share your code.</span>
            </button>
            <button type="button" className="game-option" disabled={!canPlayOnline} onClick={() => setJoining(v => !v)} aria-expanded={joining}>
              <strong>Join game</strong><span>Enter a friend’s 4-digit room code.</span>
            </button>
            {joining && <form className="join-form game-join" onSubmit={join}>
              <label className="field"><span>Room code</span>
                <input placeholder="0000" inputMode="numeric" pattern="[0-9]{4}" value={code} autoFocus maxLength={4} disabled={pending}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
              <button type="submit" className="primary-button" disabled={!canPlayOnline || code.length !== 4}>Join room</button>
            </form>}
          </>}
          <button type="button" className="game-option" disabled={!validName || pending} onClick={() => send({ type: 'lobby.create', name, mode: 'bot' })}>
            <strong>Play with Swamp Bot</strong><span>Practice your spells against a bot.</span>
          </button>
        </div>
        {!validName && <p className="hint">Enter a player name to continue.</p>}
        {pending && <p className="hint" role="status">Connecting to your room…</p>}
        {(error || session.error || accountError) && <p className="error" role="alert">{error || session.error || accountError}</p>}
        <div className="choice-footer">
          {guestOnly ? <button type="button" className="link-button small" disabled={pending} onClick={() => navigate(session.authenticated ? 'play' : 'login')}>{session.authenticated ? 'Play online' : 'Sign in for online games'}</button>
            : <span>Signed in as {session.name || 'a player'} · <button type="button" className="link-button small" disabled={pending} onClick={() => void session.logout().catch(() => setAccountError('Could not sign out. Please try again.'))}>Sign out</button></span>}
          <button type="button" className="link-button small" disabled={pending} onClick={() => navigate('home')}>← Back to welcome</button>
        </div>
    </Parchment>
  );
}
