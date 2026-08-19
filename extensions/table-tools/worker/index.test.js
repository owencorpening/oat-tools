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
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z' };
    const request = new Request('https://worker.example.com/', {
      method: 'POST',
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
    const env = { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REFRESH_TOKEN: 'z' };
    const request = new Request('https://worker.example.com/', {
      method: 'POST',
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

async function main() {
  await testInvalidGrantThrowsReauthRequired();
  await testOtherTokenErrorStaysGeneric();
  await testFetchHandlerReturns401ForReauth();
  await testFetchHandlerReturns500ForOtherFailure();
  console.log('worker/index.js re-auth resilience tests passed');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
