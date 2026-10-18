import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMatch } from '../hooks/useMatch';
import { useSession } from '../auth/SessionProvider';
import { usePlayerName } from '../hooks/usePlayerName';
import { navigate } from '../hooks/useScreen';
import { MossCommandInput } from './MossCommandInput';
import { parseMossCommand, planLobbyCommand, type MossCommand, type MossMenuExitCommand } from '../story/commands';
import { executeMenuExit } from '../story/menuExit';
import { MOSS_COMMAND_REPLIES } from '@sword/protocol';
import type { BookSpread } from './BookMenu';
import { HeroNameEditor } from './HeroNameEditor';
import { Knight } from './Knight';
import { confirmLeaveGame } from '../story/confirmLeaveGame';

/** Game-choice state lives above the pages, so the name survives page turns that remount them. */
export function useHubMenu({ guestOnly, onVoiceReply, stopVoice }: {
  guestOnly: boolean; onVoiceReply(text: string): Promise<boolean>; stopVoice(): void;
}) {
  const { send, error, pending: roomPending } = useMatch();
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);
  const mounted = useRef(true);
  const latestStopVoice = useRef(stopVoice); latestStopVoice.current = stopVoice;
  const pending = roomPending || exiting;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (exitingRef.current) latestStopVoice.current(); };
  }, []);
  const session = useSession();
  const [accountError, setAccountError] = useState<string | null>(null);
  const profile = usePlayerName();
  const name = profile.status === 'ready' ? profile.savedName! : profile.draft;
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const voiceRequest = useRef(false);
  const validName = Boolean(name.trim()) && (!profile.authenticated || profile.status === 'ready');
  const canPlayOnline = !guestOnly && session.authenticated && !session.loading && validName && !pending;

  useEffect(() => {
    if (voiceRequest.current && error && !pending) {
      voiceRequest.current = false;
      onVoiceReply(MOSS_COMMAND_REPLIES.failed);
    }
  }, [error, pending, onVoiceReply]);

  function submitCommand(command: MossCommand, voice = false) {
    if (profile.authenticated && profile.status !== 'ready') {
      if (voice) void onVoiceReply(MOSS_COMMAND_REPLIES.saveName);
      return;
    }
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
    if (result.command.kind === 'leave' || result.command.kind === 'signout') void exitMenu(result.command, true);
    else submitCommand(result.command, true);
  }

  async function exitMenu(command: MossMenuExitCommand, voice = false) {
    if (pending || exitingRef.current) { if (voice) void onVoiceReply(MOSS_COMMAND_REPLIES.lobbyBusy); return; }
    exitingRef.current = true; setExiting(true); setAccountError(null);
    try {
      if (command.kind === 'leave' && !await confirmLeaveGame()) return;
      if (!mounted.current) return;
      const result = await executeMenuExit(command, {
        authenticated: session.authenticated,
        practice: guestOnly,
        reply: async text => {
          if (!mounted.current) return false;
          return voice ? onVoiceReply(text) : true;
        },
        logout: session.logout,
        navigate: destination => { if (mounted.current) navigate(destination); },
      });
      if (result === 'failed' && mounted.current) setAccountError(MOSS_COMMAND_REPLIES.signOutFailed);
    } finally { exitingRef.current = false; if (mounted.current) setExiting(false); }
  }
  function join(event: FormEvent) {
    event.preventDefault();
    submitCommand({ kind: 'join', code: code.trim() });
  }
  return {
    guestOnly, session, error, pending, exiting, accountError, profile, validName, canPlayOnline,
    joining, setJoining, code, setCode, submitCommand, voiceCommand, exitMenu, join,
  };
}

/** Your hero on the left page; create, join or Swamp Bot on the right. */
export function hubSpread(hub: ReturnType<typeof useHubMenu>, stopVoice: () => void, voiceActive = false): BookSpread {
  const { guestOnly, session, error, pending, exiting, accountError, profile, validName, canPlayOnline,
    joining, setJoining, code, setCode, submitCommand, voiceCommand, exitMenu, join } = hub;
  return {
    left: {
      kicker: guestOnly ? 'Practice' : 'The hero',
      className: 'book-page-dense',
      content: <div className="book-form book-hero">
        <div className="book-hero-figure">
          <Knight plain />
          <div className="npc-moss" role="img" aria-label="Moss, a tiny smiling green forest spirit with a pink flower, flapping its leafy wings" />
        </div>
        <HeroNameEditor profile={profile} busy={pending} onChange={profile.change} onSave={profile.save}
          onEdit={profile.edit} onCancel={profile.cancel} onRetry={profile.retry} />
        {!guestOnly && <p className="hint">Signed in as {session.name || 'a player'} · <button type="button" className="link-button small" disabled={pending}
          onClick={() => void exitMenu({ kind: 'signout' })}>Sign out</button></p>}
      </div>,
    },
    right: {
      className: 'book-page-dense',
      content: <div className="book-form">
        <h1>{guestOnly ? 'A little sword practice.' : 'Every tale needs a rival.'}</h1>
        <div className="game-options" aria-label="Game options">
          {!guestOnly && <>
            <button type="button" className="game-option" disabled={!canPlayOnline} onClick={() => submitCommand({ kind: 'create', mode: 'online' })}>
              <span className="option-icon" aria-hidden="true">⚔</span><strong>Create lobby</strong><span className="option-description">Open a new chapter</span><span className="option-arrow" aria-hidden="true">↗</span>
            </button>
            <button type="button" className="game-option" disabled={!canPlayOnline} onClick={() => setJoining(v => !v)} aria-expanded={joining}>
              <span className="option-icon" aria-hidden="true">⌘</span><strong>Join lobby</strong><span className="option-description">Follow your friend’s party code</span><span className="option-arrow" aria-hidden="true">↗</span>
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
            <span className="option-icon" aria-hidden="true">✿</span><strong>Play with Swamp Bot</strong><span className="option-description">A friendly practice</span><span className="option-arrow" aria-hidden="true">↗</span>
          </button>
        </div>
        <MossCommandInput active={voiceActive} disabled={pending || (!guestOnly && session.loading)} onTranscript={voiceCommand} stopVoice={stopVoice}
          example={guestOnly ? 'Try “play with Swamp Bot” or “leave game.” No sign-in needed.'
            : 'Try “create a game,” “join room code zero one two three,” “sign out,” or “leave game.”'} />
        {pending && <p className="hint" role="status">{exiting ? 'Moss is helping you leave…' : 'Connecting to your room…'}</p>}
        {(error || session.error || accountError) && <p className="error" role="alert">{error || session.error || accountError}</p>}
        <div className="choice-footer">
          {guestOnly && <button type="button" className="link-button small" disabled={pending} onClick={() => navigate(session.authenticated ? 'play' : 'login')}>
            {session.authenticated ? 'Play online' : 'Sign in for online games'}</button>}
          <button type="button" className="link-button small" disabled={pending} onClick={() => void exitMenu({ kind: 'leave' })}>{guestOnly ? '← Back to sign in' : '← Close the book'}</button>
        </div>
      </div>,
    },
  };
}
