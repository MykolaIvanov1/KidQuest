import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateE2EDatabase } from './e2e-environment.mjs';
test('E2E refuses non-local, non-e2e and application database targets', () => {
  for (const url of [
    'postgresql://x:y@remote.example/kidquest_e2e',
    'postgresql://x:y@localhost/kidquest',
    'not a URL',
  ]) {
    assert.throws(() => validateE2EDatabase(url));
  }
  assert.throws(() =>
    validateE2EDatabase('postgresql://a:b@localhost:5432/kidquest_e2e', [
      'postgresql://other:secret@127.0.0.1/kidquest_e2e',
    ]),
  );
  assert.throws(() =>
    validateE2EDatabase('postgresql://a:b@localhost/kidquest_e2e', [
      'postgresql://a:b@localhost/kidquest_e2e?schema=public',
    ]),
  );
});
test('E2E accepts only a distinct database and bounds its connection pool', () => {
  const value = validateE2EDatabase('postgresql://a:b@127.0.0.1:56180/kidquest_e2e', [
    'postgresql://a:b@127.0.0.1:56180/kidquest_test',
  ]);
  assert.equal(new URL(value).searchParams.get('connection_limit'), '4');
});

test('E2E fails closed without exposing malformed comparison credentials', () => {
  assert.throws(
    () =>
      validateE2EDatabase('postgresql://a:b@localhost/kidquest_e2e', [
        'postgresql://private-password@[::1',
      ]),
    { message: 'Invalid application or integration database configuration.' },
  );
});

test('E2E compares decoded database names before allowing a target', () => {
  assert.throws(
    () =>
      validateE2EDatabase('postgresql://a:b@localhost/%6bidquest_e2e', [
        'postgresql://other:secret@LOCALHOST:5432/kidquest_e2e',
      ]),
    /must differ/,
  );
});
