import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAuthError, loginOptions, logoutOptions } from '../src/auth/errors';
import { createPopupLogin, loginInPopup } from '../src/auth/popupLogin';
import { BOOK_SPREAD, BOOK_TIMING, playBookOpening, reportBookArrival, signOutFromBook } from '../src/story/bookNavigation';

test('Start opens the cover, shows the first leaf, then turns it before the prologue is ready', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stages: string[] = [];
  const cancel = playBookOpening(stage => stages.push(stage));
  assert.deepEqual(stages, ['opening']);
  t.mock.timers.tick(BOOK_TIMING.open - 1);
  assert.deepEqual(stages, ['opening']);
  t.mock.timers.tick(1);
  assert.deepEqual(stages, ['opening', 'first-page']);
  t.mock.timers.tick(BOOK_TIMING.firstPagePause);
  assert.deepEqual(stages, ['opening', 'first-page', 'revealing']);
  t.mock.timers.tick(BOOK_TIMING.firstPageTurn - 1);
  assert.equal(stages.at(-1), 'revealing');
  t.mock.timers.tick(1);
  assert.equal(stages.at(-1), 'revealing', 'The fallback must not cut off the CSS landing');
  t.mock.timers.tick(BOOK_TIMING.firstPageFallback);
  assert.equal(stages.at(-1), 'open');
  cancel();
});

test('leaving during opening cancels the remaining page turn and narration readiness', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const elapsed of [0, BOOK_TIMING.open, BOOK_TIMING.open + BOOK_TIMING.firstPagePause,
    BOOK_TIMING.open + BOOK_TIMING.firstPagePause + BOOK_TIMING.firstPageTurn]) {
    const stages: string[] = [];
    const cancel = playBookOpening(stage => stages.push(stage));
    t.mock.timers.tick(elapsed);
    cancel();
    const before = [...stages];
    t.mock.timers.tick(10_000);
    assert.deepEqual(stages, before);
    assert.ok(!stages.includes('open'));
  }
});

test('sign-out turns back to login and waits for that page before redirecting', async () => {
  const calls: string[] = [];
  reportBookArrival(BOOK_SPREAD.hub);
  const result = signOutFromBook(() => calls.push('login'), async () => { calls.push('logout'); });
  await Promise.resolve();
  assert.deepEqual(calls, ['login']);
  reportBookArrival(BOOK_SPREAD.sword);
  await Promise.resolve();
  assert.deepEqual(calls, ['login'], 'An unrelated or interrupted turn must not start logout');
  reportBookArrival(BOOK_SPREAD.auth);
  await result;
  assert.deepEqual(calls, ['login', 'logout']);
  reportBookArrival(null);
});

test('sign-out from login or outside the book needs no extra animation wait', async () => {
  for (const spread of [BOOK_SPREAD.auth, null]) {
    reportBookArrival(spread);
    let loggedOut = false;
    await signOutFromBook(() => {}, async () => { loggedOut = true; });
    assert.equal(loggedOut, true);
  }
  await assert.rejects(signOutFromBook(() => {}, async () => { throw new Error('Logout failed'); }), /Logout failed/);
});

test('an unavailable animation cannot trap the user before logout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  reportBookArrival(BOOK_SPREAD.hub);
  let loggedOut = false;
  const result = signOutFromBook(() => {}, async () => { loggedOut = true; });
  t.mock.timers.tick(BOOK_TIMING.turn * 3 - 1);
  await Promise.resolve();
  assert.equal(loggedOut, false);
  t.mock.timers.tick(1);
  await result;
  assert.equal(loggedOut, true);
  reportBookArrival(null);
});

test('unmounting the book releases a pending logout without stale listeners', async () => {
  reportBookArrival(BOOK_SPREAD.hub);
  let calls = 0;
  const result = signOutFromBook(() => {}, async () => { calls++; });
  reportBookArrival(null);
  await result;
  reportBookArrival(BOOK_SPREAD.auth);
  assert.equal(calls, 1);
  reportBookArrival(null);
});

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

test('repeated login and signup clicks share one popup until the transaction finishes', async () => {
  for (const cancel of [false, true]) {
    let opened = 0;
    let focused = 0;
    let closed = 0;
    let complete!: () => void;
    let reject!: (error: unknown) => void;
    let response = new Promise<void>((resolve, fail) => { complete = resolve; reject = fail; });
    const popup = { focus: () => { focused++; }, close: () => { closed++; } } as unknown as Window;
    const forms: unknown[] = [];
    const login = createPopupLogin({
      open: () => { opened++; return popup; },
      track: () => {},
      authenticate: options => { forms.push(options.authorizationParams?.screen_hint); return response; },
    });
    const first = login('login');
    assert.equal(login('login'), first);
    assert.equal(login('signup'), first);
    await Promise.resolve();
    assert.equal(login('login'), first, 'An unrelated render or async task must not release the attempt');
    assert.equal(opened, 1);
    assert.equal(focused, 3);
    assert.equal(closed, 0);
    assert.deepEqual(forms, ['login']);
    if (cancel) {
      reject({ error: 'cancelled' });
      await assert.rejects(first);
    } else {
      complete();
      await first;
    }
    assert.equal(closed, 1);
    response = Promise.resolve();
    await login('signup');
    assert.equal(opened, 2, 'Finishing or cancelling must allow another sign-in');
    assert.deepEqual(forms, ['login', 'signup']);
  }
});
