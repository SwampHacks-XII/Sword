import { useState } from 'react';
import { useSession } from '../auth/SessionProvider';
import { navigate } from '../hooks/useScreen';
import { describeAuthError, type AuthIssue } from '../auth/errors';
import { BookMenu } from './BookMenu';
import { NpcGuide } from './NpcGuide';

/** Sign-in as an open storybook: the tale on the left page, the hero's ledger on the right. */
export function LoginScreen() {
  const session = useSession();
  const [pending, setPending] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState<AuthIssue | null>(null);
  const issue = pending ? null : error ?? session.errorDetails;
  async function signIn(mode: 'login' | 'signup') {
    setPending(mode); setError(null);
    try { await session.login(mode); }
    catch (cause) {
      const failure = describeAuthError(cause);
      setError(failure.code === 'popup_closed' ? null : failure);
    }
    finally { setPending(null); }
  }

  const ledger = <div className="login-ledger">
    <h1>{session.authenticated ? 'Your story awaits.' : 'Who holds the sword?'}</h1>
    {session.loading ? <p role="status">{pending ? 'Your sign-in window is open.' : 'Checking your login…'}</p>
      : session.authenticated ? <>
        <p>Signed in as <strong>{session.name || 'a player'}</strong>. Choose a game to get started.</p>
        <button type="button" className="primary-button" onClick={() => navigate('play')}>Choose a game <span aria-hidden="true">→</span></button>
        <button type="button" className="link-button small" onClick={() => void session.logout().catch(cause => setError(describeAuthError(cause)))}>Sign out</button>
      </> : <>
        <p>Claim your place in the story. Return to your adventure, or begin a new legend.</p>
        <div className="auth-actions">
          <button type="button" className="primary-button" disabled={!session.configured || pending !== null} onClick={() => void signIn('login')}>
            {pending === 'login' ? 'Turning the page…' : 'Log in'}
          </button>
          <button type="button" className="secondary-button" disabled={!session.configured || pending !== null} onClick={() => void signIn('signup')}>
            {pending === 'signup' ? 'Turning the page…' : 'Sign up'}
          </button>
        </div>
        {!session.configured && <p className="hint">Online sign-in isn’t set up on this copy yet. You can still practice with Swamp Bot.</p>}
        <p className="hint">Log in and Sign up open a small window. Close it anytime to return to this book.</p>
        <div className="guest-option">
          <span>Just want to practice?</span>
          <button type="button" className="link-button small" disabled={pending !== null} onClick={() => navigate('practice')}>Continue as guest with Swamp Bot</button>
        </div>
      </>}
    {pending && <div className="guest-option">
      <p className="hint">Finish in the sign-in window, or come back to the story.</p>
      <button type="button" className="secondary-button" onClick={() => session.cancelLogin()}>← Back to the book</button>
    </div>}
    {issue && <div className="auth-error" role="alert">
      <p className="error">{issue.message}</p>
      <details className="auth-error-details"><summary>Setup details</summary><p>{issue.details}</p><p className="hint">Error: {issue.code}</p></details>
    </div>}
    <button type="button" className="link-button small back-button" disabled={pending !== null} onClick={() => navigate('home')}>← Back to welcome</button>
  </div>;

  return <BookMenu className="login-book" label="The hero’s ledger" showNav={false} spreads={[{
    left: {
      kicker: 'A tale of two selves',
      title: <>Every legend<br />begins with <em>you.</em></>,
      text: 'Somewhere beyond these pages, your evil twin is writing the wrong ending.',
      content: <div className="login-tale"><NpcGuide message="Let’s put your name in the story before your twin takes all the credit." /></div>,
    },
    right: { content: ledger },
  }]} />;
}
