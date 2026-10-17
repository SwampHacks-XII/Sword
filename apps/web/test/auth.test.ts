import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAuthError, loginOptions, logoutOptions } from '../src/auth/errors';
import { loginInPopup } from '../src/auth/popupLogin';

test('the observed API denial explains the required user-delegated grant', () => {
  const error = { error: 'invalid_request', message: 'Client "public-client" is not authorized to access resource server "https://sword-api".' };
  const result = describeAuthError(error);
  assert.equal(result.code, 'api_access_denied');
  assert.match(result.details, /Sword API → Application Access/);
  assert.match(result.details, /User-Delegated Access/);
});

test('login and sign-up explicitly show the appropriate hosted credential form', () => {
  for (const mode of ['login', 'signup'] as const) {
    const result = loginOptions(mode);
    assert.equal(result.authorizationParams.prompt, 'login');
    assert.equal(result.authorizationParams.screen_hint, mode);
    assert.equal(result.appState.returnTo, '/#play');
  }
});

test('sign-out returns to the login ledger on the same local or hosted website', () => {
  for (const origin of ['http://localhost:5173', 'https://sword-example.onrender.com']) {
    const destination = new URL(logoutOptions(origin).logoutParams.returnTo);
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname, '/');
    assert.equal(destination.hash, '#login');
    assert.equal(destination.search, '');
  }
});

test('expired callbacks are recoverable and unknown messages cannot expose secrets', () => {
  assert.equal(describeAuthError({ error: 'missing_transaction', message: 'Invalid state' }).code, 'login_expired');
  const secret = 'do-not-display-this-code';
  const result = describeAuthError({ error: `bad_${secret}`, message: `https://localhost/?code=${secret}&state=private` });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.code, 'login_failed');
});

test('an unspecified access denial does not report that the player canceled', () => {
  const issue = describeAuthError({ error: 'access_denied', error_description: 'An organization policy denied this request.' });
  assert.equal(issue.code, 'access_denied');
  assert.doesNotMatch(issue.message, /cancel/i);
  assert.match(issue.details, /Monitoring → Logs/);
});

test('known signup and verification denials explain the required account step', () => {
  assert.equal(describeAuthError({ error: 'access_denied', error_description: 'Signups are disabled' }).code, 'signup_disabled');
  assert.equal(describeAuthError({ error: 'access_denied', error_description: 'Please verify your email before logging in.' }).code, 'email_verification_required');
});

test('a blocked popup leaves authentication untouched and gives a recoverable message', async () => {
  let authenticated = false;
  let tracked = false;
  await assert.rejects(loginInPopup('login', {
    open: () => null,
    track: () => { tracked = true; },
    authenticate: async () => { authenticated = true; },
  }), error => {
    assert.equal(describeAuthError(error).code, 'popup_blocked');
    return true;
  });
  assert.equal(authenticated, false);
  assert.equal(tracked, false);
});

test('each popup supplies the requested form and releases its window on success or failure', async () => {
  for (const mode of ['login', 'signup'] as const) {
    for (const cancel of [false, true]) {
      let closed = false;
      let tracked: Window | null = null;
      let complete!: () => void;
      let reject!: (error: unknown) => void;
      const response = new Promise<void>((resolve, rejectResponse) => { complete = resolve; reject = rejectResponse; });
      const popup = { close: () => { closed = true; } } as unknown as Window;
      const attempt = loginInPopup(mode, {
        open: () => popup,
        track: value => { tracked = value; },
        authenticate: (options, config) => {
          assert.equal(options.authorizationParams?.screen_hint, mode);
          assert.equal(options.authorizationParams?.prompt, 'login');
          assert.equal(config.popup, popup);
          assert.equal(config.timeoutInSeconds, 300);
          return response;
        },
      });
      assert.equal(tracked, popup);
      assert.equal(closed, false);
      if (cancel) {
        reject({ error: 'cancelled' });
        await assert.rejects(attempt, error => describeAuthError(error).code === 'popup_closed');
      } else {
        complete();
        await attempt;
      }
      assert.equal(closed, true);
      assert.equal(tracked, null);
    }
  }
  assert.equal(describeAuthError({ error: 'timeout', popup: {} }).code, 'popup_timeout');
});
