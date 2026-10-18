import { useState } from 'react';
import { MOSS_NAME_PROMPT } from '@sword/protocol';
import { useSession } from '../auth/SessionProvider';
import { navigate } from '../hooks/useScreen';
import { describeAuthError, type AuthIssue } from '../auth/errors';
import type { BookSpread } from './BookMenu';
import { NpcGuide } from './NpcGuide';
import { Knight } from './Knight';
import { MossVoice } from './MossVoice';

/** Sign-in state lives above the pages, so a page turn that remounts them keeps it. */
export function useAuthLedger() {
  const session = useSession();
  const [pending, setPending] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState<AuthIssue | null>(null);
  async function signIn(mode: 'login' | 'signup') {
    setPending(mode); setError(null);
    try { await session.login(mode); }
    catch (cause) {
      const failure = describeAuthError(cause);
      setError(failure.code === 'popup_closed' ? null : failure);
    }
    finally { setPending(null); }
  }
  return { session, pending, issue: pending ? null : error ?? session.errorDetails, signIn, setError };
}

/** Art on the left page; log in, sign up or practice on the right. */
export function authSpread({ session, pending, issue, signIn, setError }: ReturnType<typeof useAuthLedger>, narrate = false): BookSpread {
  const ledger = <div className="book-form book-auth">
    <h1>{session.authenticated ? 'Your story awaits.' : 'Who holds the sword?'}</h1>
    {session.loading ? <p role="status">{pending ? 'Your sign-in window is open.' : 'Checking your login…'}</p>
      : session.authenticated ? <>
        <p>Signed in as <strong>{session.name || 'a player'}</strong>. Choose a game to get started.</p>
        <div className="auth-actions">
          <button type="button" className="primary-button" onClick={() => navigate('play')}>Choose a game <span aria-hidden="true">→</span></button>
        </div>
      </> : <>
        <p>Claim your place in the story, or sharpen your sword first.</p>
        <div className="auth-actions">
          <button type="button" className="primary-button" disabled={!session.configured || pending !== null} onClick={() => void signIn('login')}>
            {pending === 'login' ? 'Turning the page…' : 'Log in'}
          </button>
          <button type="button" className="secondary-button" disabled={!session.configured || pending !== null} onClick={() => void signIn('signup')}>
            {pending === 'signup' ? 'Turning the page…' : 'Sign up'}
          </button>
          <button type="button" className="secondary-button" disabled={pending !== null} onClick={() => navigate('practice')}>
            Practice <span aria-hidden="true">✿</span>
          </button>
        </div>
        {!session.configured && <p className="hint">Online sign-in isn’t set up on this copy yet. You can still practice with Swamp Bot.</p>}
        <p className="hint">Log in and Sign up open a small window. Practice is a guest duel with Swamp Bot.</p>
      </>}
    {pending && <div className="guest-option">
      <p className="hint">Finish in the sign-in window, or come back to the story.</p>
      <button type="button" className="secondary-button" onClick={() => session.cancelLogin()}>← Back to the book</button>
    </div>}
    {issue && <div className="auth-error" role="alert">
      <p className="error">{issue.message}</p>
      <details className="auth-error-details"><summary>Setup details</summary><p>{issue.details}</p><p className="hint">Error: {issue.code}</p></details>
    </div>}
    <div className="book-auth-footer">
      {session.authenticated && !session.loading && <button type="button" className="link-button small" onClick={() => void session.logout().catch(cause => setError(describeAuthError(cause)))}>Sign out</button>}
      <button type="button" className="link-button small back-button" disabled={pending !== null} onClick={() => navigate('lore')}>← Back to the tale</button>
    </div>
  </div>;

  return {
    left: {
      kicker: 'Chapter one',
      title: <>Every legend<br />begins with <em>you.</em></>,
      content: <div className="book-art">
        <Knight className="book-art-knight" label="A small pixel knight holding a sword" />
        <NpcGuide message={MOSS_NAME_PROMPT} />
        <div className="book-auth-voice"><MossVoice text={MOSS_NAME_PROMPT} autoSpeak={narrate} /></div>
      </div>,
    },
    right: { content: ledger, className: 'book-page-dense' },
  };
}
