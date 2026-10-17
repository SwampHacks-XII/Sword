import { useState } from 'react';
import { useSession } from '../auth/SessionProvider';
import { navigate } from '../hooks/useScreen';
import { Parchment } from './Parchment';
import { describeAuthError, type AuthIssue } from '../auth/errors';

export function LoginScreen() {
  const session = useSession();
  const [pending, setPending] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState<AuthIssue | null>(null);
  const issue = error ?? session.errorDetails;
  async function signIn(mode: 'login' | 'signup') {
    setPending(mode); setError(null);
    try { await session.login(mode); }
    catch (cause) { setError(describeAuthError(cause)); }
    finally { setPending(null); }
  }
  return (
    <Parchment className="flow-card login-screen">
      <p className="eyebrow">Your next duel starts here</p>
      <h1>{session.authenticated ? 'Welcome back' : 'Join the arena'}</h1>
      {session.loading ? <p role="status">Checking your login…</p>
        : session.authenticated ? <>
          <p>Signed in as <strong>{session.name || 'a player'}</strong>. Choose a game to get started.</p>
          <button type="button" className="primary-button" onClick={() => navigate('play')}>Choose a game <span aria-hidden="true">→</span></button>
          <button type="button" className="link-button small" onClick={() => void session.logout().catch(cause => setError(describeAuthError(cause)))}>Sign out</button>
        </> : <>
          <p>Log in with your email or username and password, or create an account for your first duel.</p>
          <div className="auth-actions">
            <button type="button" className="primary-button" disabled={!session.configured || pending !== null} onClick={() => void signIn('login')}>
              {pending === 'login' ? 'Opening login…' : 'Log in'}
            </button>
            <button type="button" className="secondary-button" disabled={!session.configured || pending !== null} onClick={() => void signIn('signup')}>
              {pending === 'signup' ? 'Opening sign up…' : 'Sign up'}
            </button>
          </div>
          {!session.configured && <p className="hint">Online sign-in isn’t set up on this copy yet. You can still practice with Swamp Bot.</p>}
          <p className="hint">The next screen has your email/username and password fields. After signing in, you’ll choose or create a game.</p>
          <div className="guest-option">
            <span>Just want to practice?</span>
            <button type="button" className="link-button small" disabled={pending !== null} onClick={() => navigate('practice')}>Continue as guest with Swamp Bot</button>
          </div>
        </>}
      {issue && <div className="auth-error" role="alert">
        <p className="error">{issue.message}</p>
        <details className="auth-error-details"><summary>Setup details</summary><p>{issue.details}</p><p className="hint">Error: {issue.code}</p></details>
      </div>}
      <button type="button" className="link-button small back-button" disabled={pending !== null} onClick={() => navigate('home')}>← Back to welcome</button>
    </Parchment>
  );
}
