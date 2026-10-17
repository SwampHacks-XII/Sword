export interface AuthIssue { message: string; details: string; code: string }

/** Explain known provider failures without rendering callback URLs, codes, or tokens. */
export function describeAuthError(error: unknown): AuthIssue {
  const object = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const providerCode = typeof object.error === 'string' && /^[a-z_]{1,64}$/.test(object.error) ? object.error : 'login_failed';
  const message = typeof object.message === 'string' ? object.message : '';
  const description = typeof object.error_description === 'string' ? object.error_description : message;
  if (providerCode === 'cancelled') {
    return { code: 'popup_closed', message: 'You’re back in the book.',
      details: 'The sign-in window was closed. Choose Log in or Sign up whenever you are ready.' };
  }
  if (providerCode === 'popup_open') {
    return { code: 'popup_blocked', message: 'Your browser blocked the sign-in window.',
      details: 'Allow popups for this game, then choose Log in or Sign up again. Your place in the book is saved.' };
  }
  if (providerCode === 'timeout' && 'popup' in object) {
    return { code: 'popup_timeout', message: 'The sign-in window timed out. Please try again.',
      details: 'Your place in the book is saved. Start a new login and finish signing in within five minutes.' };
  }
  if (/sign.?ups? (?:are |is )?(?:disabled|not allowed)|public signup.*disabled|signup_disabled/i.test(description)) {
    return { code: 'signup_disabled', message: 'New account registration is disabled for this game.',
      details: 'The game host should check the Auth0 database connection’s sign-up settings and any Pre User Registration Actions. Existing accounts may still be able to log in.' };
  }
  if (/please verify.*email|email.*(?:must be verified|not verified)|email verification.*required/i.test(description)) {
    return { code: 'email_verification_required', message: 'Verify your email address before logging in.',
      details: 'Check your inbox and spam folder for the verification email, follow its link, then choose Log in. If the email is missing, ask the game host to resend verification from Auth0.' };
  }
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
  if (providerCode === 'access_denied') {
    return { code: providerCode, message: 'Auth0 did not approve this sign-in attempt.',
      details: 'The game host should open Auth0 → Monitoring → Logs, find this failed login or signup, and check its Description and Action Details. This code alone does not tell us whether access was canceled, blocked by a login rule, or refused for another reason.' };
  }
  return { code: providerCode, message: 'Sign-in could not finish. Please try again.',
    details: 'Start a new login. If it still fails, check the Auth0 tenant logs for this error code. Provider callback URLs and credentials are not displayed here.' };
}

export function loginOptions(mode: 'login' | 'signup') {
  return {
    appState: { returnTo: '/#play' },
    authorizationParams: { prompt: 'login' as const, screen_hint: mode },
  };
}

export function logoutOptions(origin: string) {
  // Auth0's /v2/logout allowlist compares the URL without its fragment.
  // Keep the existing allowed origin while returning to the hero ledger.
  return { logoutParams: { returnTo: new URL('/#login', origin).href } };
}
