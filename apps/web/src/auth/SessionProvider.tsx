import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { describeAuthError, loginOptions, type AuthIssue } from './errors';

interface Session {
  configured: boolean; loading: boolean; authenticated: boolean; name: string; error: string | null;
  errorDetails: AuthIssue | null;
  login(mode?: 'login' | 'signup'): Promise<void>; logout(): Promise<void>; getToken(): Promise<string>;
}
const domain = import.meta.env.VITE_AUTH0_DOMAIN?.trim();
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID?.trim();
const audience = import.meta.env.VITE_AUTH0_AUDIENCE?.trim();
const configured = Boolean(domain && clientId && audience);
const fallback: Session = {
  configured: false, loading: false, authenticated: false, name: '', error: null, errorDetails: null,
  async login() {}, async logout() {},
  async getToken() { throw new Error('Online login is not configured.'); },
};
const SessionContext = createContext<Session>(fallback);

function AuthSession({ children }: { children: ReactNode }) {
  const auth = useAuth0();
  const issue = useMemo(() => auth.error ? describeAuthError(auth.error) : null, [auth.error]);
  useEffect(() => {
    if (!auth.error || auth.isLoading || auth.isAuthenticated) return;
    const query = new URLSearchParams(window.location.search);
    // The SDK has already consumed this failed callback. Keep its code/state out
    // of navigation and return to sign-in rather than showing the welcome page.
    if (query.has('error') || (query.has('code') && query.has('state'))) {
      window.history.replaceState({}, document.title, `${window.location.pathname}#login`);
      window.dispatchEvent(new Event('hashchange'));
    }
  }, [auth.error, auth.isLoading, auth.isAuthenticated]);
  const value = useMemo<Session>(() => ({
    configured: true, loading: auth.isLoading, authenticated: auth.isAuthenticated,
    name: auth.user?.nickname ?? auth.user?.name ?? '',
    error: issue?.message ?? null,
    errorDetails: issue,
    login: (mode = 'login') => auth.loginWithRedirect(loginOptions(mode)),
    logout: () => auth.logout({ logoutParams: { returnTo: window.location.origin } }),
    getToken: async () => {
      const token = await auth.getAccessTokenSilently();
      if (!token) throw new Error('Please sign in again.');
      return token;
    },
  }), [auth.isLoading, auth.isAuthenticated, auth.user, issue, auth.loginWithRedirect, auth.logout, auth.getAccessTokenSilently]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  if (!configured) return <SessionContext value={fallback}>{children}</SessionContext>;
  return (
    <Auth0Provider domain={domain!} clientId={clientId!}
      authorizationParams={{ redirect_uri: window.location.origin, audience, scope: 'openid profile' }}
      onRedirectCallback={appState => {
        window.history.replaceState({}, document.title, appState?.returnTo === '/#play' ? '/#play' : '/');
        window.dispatchEvent(new Event('hashchange'));
      }}>
      <AuthSession>{children}</AuthSession>
    </Auth0Provider>
  );
}
export const useSession = () => useContext(SessionContext);
