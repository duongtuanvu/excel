import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleFetch, isRedirectStatus, networkFailure } from '../worker/google-fetch.ts';

test('both Google requests use workerd-compatible manual redirects and fixed destinations', async () => {
  const calls: {url: string; init?: RequestInit}[] = [];
  const stub: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'manual');
    calls.push({url:String(input),init});
    return new Response(null,{status:302,headers:{Location:'https://example.invalid/'}});
  };
  const body = 'client_secret=test-only';
  const token = await googleFetch('token',{method:'POST',body,redirect:'error'},stub);
  const info = await googleFetch('userinfo',{headers:{Authorization:'Bearer test-only'}},stub);
  assert.deepEqual(calls.map(c=>c.url),['https://oauth2.googleapis.com/token','https://openidconnect.googleapis.com/v1/userinfo']);
  assert.equal(calls[0].init?.body,body);
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.init?.signal instanceof AbortSignal));
  assert.ok(isRedirectStatus(token.status));
  assert.ok(isRedirectStatus(info.status));
  assert.equal(token.ok,false);
  assert.equal(isRedirectStatus(200),false);
  assert.equal(isRedirectStatus(400),false);
});
test('classifies network failures without exposing raw exception messages', () => {
  assert.equal(networkFailure(new DOMException('sensitive detail','TimeoutError')),'timeout');
  assert.equal(networkFailure(new TypeError('sensitive detail')),'network');
});
