import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMatch } from '../hooks/useMatch';
import { useSession } from '../auth/SessionProvider';
import { createApi, type Profile } from '../net/api';
import { navigate } from '../hooks/useScreen';
import { MossCommandInput } from './MossCommandInput';
import { parseMossCommand, planLobbyCommand, type MossCommand } from '../story/commands';
import { MOSS_COMMAND_REPLIES } from '@sword/protocol';
import type { BookSpread } from './BookMenu';

/** Game-choice state lives above the pages, so the name survives page turns that remount them. */
export function useHubMenu({ guestOnly, onVoiceReply }: { guestOnly: boolean; onVoiceReply(text: string): void }) {
  const { send, error, pending } = useMatch();
  const session = useSession();
  const [accountError, setAccountError] = useState<string | null>(null);
  const editedName = useRef(false);
  const [name, setName] = useState('Player 1');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const voiceRequest = useRef(false);
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

  useEffect(() => {
    if (voiceRequest.current && error && !pending) {
      voiceRequest.current = false;
      onVoiceReply(MOSS_COMMAND_REPLIES.failed);
    }
  }, [error, pending, onVoiceReply]);

  function submitCommand(command: MossCommand, voice = false) {
    const plan = planLobbyCommand(command, { name, pending, onlineAllowed: canPlayOnline });
    if (!plan.ok) { if (voice) onVoiceReply(plan.reply); return; }
    if (command.kind === 'join') { setJoining(true); setCode(command.code); }
    voiceRequest.current = voice;
    if (voice) onVoiceReply(plan.reply);
    send(plan.message);
  }
  function voiceCommand(text: string) {
    const result = parseMossCommand(text);
    if (!result.ok) {
      if (result.reason === 'code' && !guestOnly) setJoining(true);
      onVoiceReply(MOSS_COMMAND_REPLIES[result.reason]);
      return;
    }
    submitCommand(result.command, true);
  }
  function join(event: FormEvent) {
    event.preventDefault();
    submitCommand({ kind: 'join', code: code.trim() });
  }
  function rename(value: string) {
    editedName.current = true;
    setName(value);
  }

  return {
    guestOnly, session, error, pending, accountError, setAccountError, name, rename, validName, canPlayOnline,
    joining, setJoining, code, setCode, submitCommand, voiceCommand, join,
  };
}

/** Your hero on the left page; create, join or Swamp Bot on the right. */
export function hubSpread(hub: ReturnType<typeof useHubMenu>, stopVoice: () => void): BookSpread {
  const { guestOnly, session, error, pending, accountError, setAccountError, name, rename, validName, canPlayOnline,
    joining, setJoining, code, setCode, submitCommand, voiceCommand, join } = hub;
  return {
    left: {
      kicker: guestOnly ? 'Practice' : 'The hero',
      className: 'book-page-dense',
      content: <div className="book-form book-hero">
        <div className="book-hero-figure">
          <img src="/art/knight.svg" alt="" />
          <span className="book-hero-name">{name.trim() || 'Nameless hero'}</span>
        </div>
        <label className="field">
          <span>Your hero’s name</span>
          <input value={name} maxLength={40} disabled={pending} onChange={(e) => rename(e.target.value)} />
        </label>
        {!validName && <p className="hint">Enter a player name to continue.</p>}
        {!guestOnly && <p className="hint">Signed in as {session.name || 'a player'} · <button type="button" className="link-button small" disabled={pending}
          onClick={() => void session.logout().catch(() => setAccountError('Could not sign out. Please try again.'))}>Sign out</button></p>}
      </div>,
    },
    right: {
      className: 'book-page-dense',
      content: <div className="book-form">
        <h1>{guestOnly ? 'A little sword practice.' : 'Every tale needs a rival.'}</h1>
        <div className="game-options" aria-label="Game options">
          {!guestOnly && <>
            <button type="button" className="game-option" disabled={!canPlayOnline} onClick={() => submitCommand({ kind: 'create', mode: 'online' })}>
              <span className="option-icon" aria-hidden="true">⚔</span><strong>Create lobby</strong><span>Open a new chapter. Invite your rival.</span><span className="option-arrow" aria-hidden="true">↗</span>
            </button>
            <button type="button" className="game-option" disabled={!canPlayOnline} onClick={() => setJoining(v => !v)} aria-expanded={joining}>
              <span className="option-icon" aria-hidden="true">⌘</span><strong>Join lobby</strong><span>Follow a friend’s four-digit party code.</span><span className="option-arrow" aria-hidden="true">↗</span>
            </button>
            {joining && <form className="join-form game-join" onSubmit={join}>
              <label className="field"><span>Party code</span>
                <input placeholder="0000" inputMode="numeric" pattern="[0-9]{4}" value={code} autoFocus maxLength={4} disabled={pending}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
              <button type="submit" className="primary-button" disabled={!canPlayOnline || code.length !== 4}>Join</button>
            </form>}
          </>}
          <button type="button" className="game-option" disabled={!validName || pending} onClick={() => submitCommand({ kind: 'create', mode: 'bot' })}>
            <span className="option-icon" aria-hidden="true">✿</span><strong>Play with Swamp Bot</strong><span>A friendly duel before destiny calls.</span><span className="option-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
        <MossCommandInput disabled={pending || session.loading} onTranscript={voiceCommand} stopVoice={stopVoice} />
        {pending && <p className="hint" role="status">Connecting to your room…</p>}
        {(error || session.error || accountError) && <p className="error" role="alert">{error || session.error || accountError}</p>}
        <div className="choice-footer">
          {guestOnly && <button type="button" className="link-button small" disabled={pending} onClick={() => navigate(session.authenticated ? 'play' : 'login')}>
            {session.authenticated ? 'Play online' : 'Sign in for online games'}</button>}
          {!guestOnly && <button type="button" className="link-button small" disabled={pending} onClick={() => navigate('lore')}>← Back to the tale</button>}
        </div>
      </div>,
    },
  };
}
