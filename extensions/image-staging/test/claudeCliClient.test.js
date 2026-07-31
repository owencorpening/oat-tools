'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { callClaudeCli } = require('../lib/claudeCliClient');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  return child;
}

async function testSendsExpectedArgsAndParsesResult() {
  const calls = [];
  const child = fakeChild();
  const spawnFn = (cliBin, args, opts) => {
    calls.push({ cliBin, args, opts });
    process.nextTick(() => {
      child.stdout.emit('data', JSON.stringify({ is_error: false, result: '{"quote": null}' }));
      child.emit('close', 0);
    });
    return child;
  };

  const result = await callClaudeCli(
    { model: 'claude-sonnet-5', systemPromptFile: '/tmp/sop.md', userText: 'DOC TEXT', cliBin: 'claude' },
    { spawnFn }
  );

  assert.strictEqual(result, '{"quote": null}');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].cliBin, 'claude');
  assert.deepStrictEqual(calls[0].args, [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--system-prompt-file', '/tmp/sop.md',
    '--model', 'claude-sonnet-5'
  ]);
}

async function testWritesUserTextToStdin() {
  const child = fakeChild();
  const written = [];
  child.stdin = {
    write: chunk => written.push(chunk),
    end: () => { written.push('<end>'); }
  };
  const spawnFn = () => {
    process.nextTick(() => {
      child.stdout.emit('data', JSON.stringify({ is_error: false, result: 'ok' }));
      child.emit('close', 0);
    });
    return child;
  };

  await callClaudeCli(
    { model: 'sonnet', systemPromptFile: '/tmp/sop.md', userText: 'EXCERPT TEXT' },
    { spawnFn }
  );

  assert.deepStrictEqual(written, ['EXCERPT TEXT', '<end>']);
}

async function testRejectsWithoutSystemPromptFile() {
  await assert.rejects(
    () => callClaudeCli({ model: 'sonnet', userText: 'u' }, { spawnFn: () => fakeChild() }),
    /System prompt file/
  );
}

async function testRejectsOnLaunchError() {
  const child = fakeChild();
  const spawnFn = () => {
    process.nextTick(() => child.emit('error', new Error('ENOENT')));
    return child;
  };

  await assert.rejects(
    () => callClaudeCli({ model: 'sonnet', systemPromptFile: '/tmp/sop.md', userText: 'u' }, { spawnFn }),
    /Could not launch 'claude'/
  );
}

async function testRejectsWhenSpawnThrowsSynchronously() {
  const spawnFn = () => { throw new Error('spawn EACCES'); };

  await assert.rejects(
    () => callClaudeCli({ model: 'sonnet', systemPromptFile: '/tmp/sop.md', userText: 'u' }, { spawnFn }),
    /Could not launch 'claude'/
  );
}

async function testRejectsOnNonJsonOutput() {
  const child = fakeChild();
  const spawnFn = () => {
    process.nextTick(() => {
      child.stdout.emit('data', 'not json');
      child.emit('close', 1);
    });
    return child;
  };

  await assert.rejects(
    () => callClaudeCli({ model: 'sonnet', systemPromptFile: '/tmp/sop.md', userText: 'u' }, { spawnFn }),
    /non-JSON output/
  );
}

async function testRejectsWhenCliReportsError() {
  const child = fakeChild();
  const spawnFn = () => {
    process.nextTick(() => {
      child.stdout.emit('data', JSON.stringify({ is_error: true, result: 'rate limited' }));
      child.emit('close', 0);
    });
    return child;
  };

  await assert.rejects(
    () => callClaudeCli({ model: 'sonnet', systemPromptFile: '/tmp/sop.md', userText: 'u' }, { spawnFn }),
    /rate limited/
  );
}

(async () => {
  await testSendsExpectedArgsAndParsesResult();
  await testWritesUserTextToStdin();
  await testRejectsWithoutSystemPromptFile();
  await testRejectsOnLaunchError();
  await testRejectsWhenSpawnThrowsSynchronously();
  await testRejectsOnNonJsonOutput();
  await testRejectsWhenCliReportsError();
  console.log('claudeCliClient tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
