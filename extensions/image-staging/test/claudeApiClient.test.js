'use strict';

const assert = require('assert');
const { callClaude, extractText } = require('../lib/claudeApiClient');

async function testRejectsWithoutApiKey() {
  await assert.rejects(
    () => callClaude({ model: 'claude-sonnet-5', system: 's', userText: 'u' }),
    /API key/
  );
}

async function testSendsExpectedPayload() {
  const calls = [];
  const fakeRequest = async (url, opts) => {
    calls.push([url, opts]);
    return { content: [{ type: 'text', text: '{"quote": null}' }] };
  };

  const text = await callClaude(
    { apiKey: 'sk-test', model: 'claude-sonnet-5', system: 'SOP TEXT', userText: 'DOC TEXT', maxTokens: 512 },
    { request: fakeRequest }
  );

  assert.strictEqual(text, '{"quote": null}');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(calls[0][1].apiKey, 'sk-test');
  assert.strictEqual(calls[0][1].anthropicVersion, '2023-06-01');
  assert.strictEqual(calls[0][1].body.model, 'claude-sonnet-5');
  assert.strictEqual(calls[0][1].body.system, 'SOP TEXT');
  assert.strictEqual(calls[0][1].body.max_tokens, 512);
  assert.deepStrictEqual(calls[0][1].body.messages, [{ role: 'user', content: 'DOC TEXT' }]);
}

async function testPropagatesRequestFailure() {
  const fakeRequest = async () => { throw new Error('boom'); };
  await assert.rejects(
    () => callClaude({ apiKey: 'sk-test', userText: 'u' }, { request: fakeRequest }),
    /boom/
  );
}

function testExtractTextJoinsTextBlocksOnly() {
  const result = extractText({
    content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'other', text: 'c' }]
  });
  assert.strictEqual(result, 'ab');
}

function testExtractTextHandlesMissingContent() {
  assert.strictEqual(extractText({}), '');
}

(async () => {
  await testRejectsWithoutApiKey();
  await testSendsExpectedPayload();
  await testPropagatesRequestFailure();
  testExtractTextJoinsTextBlocksOnly();
  testExtractTextHandlesMissingContent();
  console.log('claudeApiClient tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
