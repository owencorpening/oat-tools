import assert from 'assert';
import { handler, getAccessToken, ReauthRequiredError } from './index.js';

function mockFetchOnce(status, body) {
  const original = global.fetch;
  global.fetch = async () => ({
    status,
    json: async () => body,
  });
  return () => { global.fetch = original; };
}

async function testInvalidGrantThrowsReauthRequired() {
  const restore = mockFetchOnce(400, {
    error: 'invalid_grant',
    error_description: 'Token has been expired or revoked.',
  });
  try {
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z' };
    let thrown = null;
    try {
      await getAccessToken(env);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof ReauthRequiredError, 'expected a ReauthRequiredError');
    assert.match(thrown.message, /get-refresh-token\.js/, 'message should point to the fix script');
    assert.match(thrown.message, /Token has been expired or revoked/, 'message should include Google\'s own description');
  } finally {
    restore();
  }
}

async function testOtherTokenErrorStaysGeneric() {
  const restore = mockFetchOnce(400, { error: 'invalid_client', error_description: 'bad client_id' });
  try {
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z' };
    let thrown = null;
    try {
      await getAccessToken(env);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'expected an error to be thrown');
    assert.ok(!(thrown instanceof ReauthRequiredError), 'invalid_client should NOT be treated as a re-auth case');
    assert.match(thrown.message, /Token exchange failed/);
  } finally {
    restore();
  }
}

async function testFetchHandlerReturns401ForReauth() {
  const restore = mockFetchOnce(400, {
    error: 'invalid_grant',
    error_description: 'Token has been expired or revoked.',
  });
  try {
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z', PROMOTE_TABLES_TOKEN: 'secret' };
    const request = new Request('https://worker.example.com/', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({ title: 't', headers: ['a'], rows: [['1']] }),
    });
    const res = await handler.fetch(request, env);
    assert.strictEqual(res.status, 401, 'expected HTTP 401 for a re-auth-required failure');
    const body = await res.json();
    assert.strictEqual(body.reauthRequired, true);
    assert.match(body.error, /get-refresh-token\.js/);
  } finally {
    restore();
  }
}

async function testFetchHandlerReturns500ForOtherFailure() {
  const restore = mockFetchOnce(400, { error: 'invalid_client', error_description: 'bad client_id' });
  try {
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z', PROMOTE_TABLES_TOKEN: 'secret' };
    const request = new Request('https://worker.example.com/', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret' },
      body: JSON.stringify({ title: 't', headers: ['a'], rows: [['1']] }),
    });
    const res = await handler.fetch(request, env);
    assert.strictEqual(res.status, 500, 'a non-auth failure should stay a plain 500, not look like a re-auth case');
    const body = await res.json();
    assert.strictEqual(body.reauthRequired, undefined);
  } finally {
    restore();
  }
}

// #11: the Worker must reject callers without the shared secret, and must
// fail closed when the secret isn't configured. Google is never called.
async function testAuthRejectsMissingWrongAndUnconfigured() {
  const original = global.fetch;
  let googleCalls = 0;
  global.fetch = async () => { googleCalls++; return { status: 200, json: async () => ({}) }; };
  const body = JSON.stringify({ title: 't', headers: ['a'], rows: [['1']] });
  const make = auth => new Request('https://worker.example.com/', {
    method: 'POST', body, headers: auth ? { Authorization: auth } : {},
  });
  const env = { PROMOTE_TABLES_TOKEN: 'secret' };
  try {
    for (const [label, req, e] of [
      ['no header', make(null), env],
      ['wrong token', make('Bearer nope'), env],
      ['token without Bearer prefix', make('secret'), env],
      ['secret unset on the Worker', make('Bearer secret'), {}],
      ['empty bearer against unset secret', make('Bearer '), {}],
    ]) {
      const res = await handler.fetch(req, e);
      assert.strictEqual(res.status, 401, `${label}: expected 401`);
    }
    assert.strictEqual(googleCalls, 0, 'unauthorized requests must never reach Google');
  } finally {
    global.fetch = original;
  }
}

async function testAuthAcceptsCorrectToken() {
  // Correct token gets past auth and reaches body validation (400 for a bad body).
  const req = new Request('https://worker.example.com/', {
    method: 'POST', headers: { Authorization: 'Bearer secret' }, body: '{}',
  });
  const res = await handler.fetch(req, { PROMOTE_TABLES_TOKEN: 'secret' });
  assert.strictEqual(res.status, 400);
}

async function main() {
  await testInvalidGrantThrowsReauthRequired();
  await testOtherTokenErrorStaysGeneric();
  await testFetchHandlerReturns401ForReauth();
  await testFetchHandlerReturns500ForOtherFailure();
  await testAuthRejectsMissingWrongAndUnconfigured();
  await testAuthAcceptsCorrectToken();
  console.log('worker/index.js re-auth resilience tests passed');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
