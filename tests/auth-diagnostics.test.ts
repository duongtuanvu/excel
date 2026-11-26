import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentials, providerCode, tokenFailure } from '../worker/auth-diagnostics.ts';

test('normalizes credentials without accepting malformed IDs or embedded whitespace', () => {
  assert.deepEqual(credentials('  123-abc.apps.googleusercontent.com\n', ' secret-token '), {clientId:'123-abc.apps.googleusercontent.com',clientSecret:'secret-token'});
  for (const id of ['123-abc','"123-abc.apps.googleusercontent.com"','a b.apps.googleusercontent.com','']) assert.equal(credentials(id,'test-secret'),null);
  for (const secret of ['','x y','"secret"','x\ny']) assert.equal(credentials('123-abc.apps.googleusercontent.com',secret),null);
});
test('only allowlisted Google error codes reach diagnostics', () => {
  assert.equal(providerCode('invalid_client'),'invalid_client');
  assert.equal(tokenFailure('invalid_grant'),'google_invalid_grant');
  for (const value of ['secret-token','invalid_client\nprivate','__proto__',null,{},42]) assert.equal(tokenFailure(value),'google_token_failed');
});
