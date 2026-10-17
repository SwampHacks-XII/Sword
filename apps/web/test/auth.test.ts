import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAuthError, loginOptions } from '../src/auth/errors';

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
