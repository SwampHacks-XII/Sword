export interface AuthIssue { message: string; details: string; code: string }

/** Explain known provider failures without rendering callback URLs, codes, or tokens. */
export function describeAuthError(error: unknown): AuthIssue {
  const object = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const providerCode = typeof object.error === 'string' && /^[a-z_]{1,64}$/.test(object.error) ? object.error : 'login_failed';
  const message = typeof object.message === 'string' ? object.message : '';
  const description = typeof object.error_description === 'string' ? object.error_description : message;
  if (/not authorized to access (?:resource server|.*api)|client.grant/i.test(description)) {
    return { code: 'api_access_denied', message: 'Online sign-in needs one more setup step.',
      details: 'In Auth0, open Applications → APIs → Sword API → Application Access. Edit Sword Web, grant User-Delegated Access, and save. In API Settings, its user access policy must allow per-app authorization.' };
  }
  if (/no connections enabled|connection.*not enabled|connection.*not found|no.*connection.*enabled/i.test(description)) {
    return { code: 'password_login_disabled', message: 'Email and password login is not enabled for this game yet.',
      details: 'In Auth0, open Authentication → Database → Username-Password-Authentication → Applications and enable Sword Web. Allow sign-ups in that connection’s settings.' };
  }
  if (providerCode === 'missing_transaction' || providerCode === 'state_mismatch' || /invalid state/i.test(description)) {
    return { code: 'login_expired', message: 'That sign-in attempt expired. Please log in again in this window.',
      details: 'Start a new login from this page. Complete it in the same browser window and keep localhost/127.0.0.1 consistent.' };
  }
  if (/callback.*mismatch|redirect_uri.*(?:invalid|mismatch|not allowed)/i.test(description)) {
    return { code: 'callback_not_allowed', message: 'The game’s return address needs to be allowed for login.',
      details: 'In Auth0 → Applications → Sword Web → Settings, add your exact website origin (normally http://localhost:5173) to Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.' };
  }
  if (providerCode === 'unauthorized_client' || /invalid client|client authentication|grant type.*not allowed/i.test(description)) {
    return { code: 'application_configuration', message: 'The game’s login application settings need to be checked.',
      details: 'Sword Web must be a Single Page Application with Authorization Code enabled. Its Client ID and tenant domain must match apps/web/.env. Do not add a client secret to the website.' };
  }
  return { code: providerCode, message: providerCode === 'access_denied' ? 'Sign-in was canceled or denied. Please try again.' : 'Sign-in could not finish. Please try again.',
    details: 'Start a new login. If it still fails, check the Auth0 tenant logs for this error code. Provider callback URLs and credentials are not displayed here.' };
}

export function loginOptions(mode: 'login' | 'signup') {
  return {
    appState: { returnTo: '/#play' },
    authorizationParams: { prompt: 'login' as const, screen_hint: mode },
  };
}
