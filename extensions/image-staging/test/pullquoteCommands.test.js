'use strict';

const assert = require('assert');
const {
  findNextPullquote,
  insertPullquote,
  insertPullquoteAndContinue,
  parseCandidateResponse,
  extractJson
} = require('../lib/pullquoteCommands');

const DOC_TEXT = [
  '# Part IX',
  '',
  'Some scene-setting prose that is not a candidate.',
  '',
  'It is not activism. It is not theory. It is engineering.',
  '',
  'A closing paragraph with nothing quotable in it.'
].join('\n');

async function testSelectsReturnedCandidateFromCursor() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(0, 0));
  const vscode = fakeVscode(editor, {});
  const calls = [];

  const result = await findNextPullquote({
    vscode,
    resolveSopPath: () => '/tmp/sop.md',
    callClaudeCliFn: async args => {
      calls.push(args);
      return JSON.stringify({ quote: 'It is not activism. It is not theory. It is engineering.', type: 'thesis', why: 'compressed thesis' });
    }
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].systemPromptFile, '/tmp/sop.md');
  assert.ok(calls[0].userText.includes('It is not activism'));

  const selected = document.getText(editor.selection);
  assert.strictEqual(selected, 'It is not activism. It is not theory. It is engineering.');
  assert.strictEqual(editor.selection.isEmpty, false);
  assert.strictEqual(result.type, 'thesis');
  assert.ok(vscode.window._messages.some(m => m[0] === 'info' && m[1].includes('thesis')));
}

async function testSecondCallScansPastFirstFoundCandidate() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(0, 0));
  const vscode = fakeVscode(editor, {});
  const excerpts = [];

  await findNextPullquote({
    vscode,
    resolveSopPath: () => '/tmp/sop.md',
    callClaudeCliFn: async args => {
      excerpts.push(args.userText);
      return JSON.stringify({ quote: 'It is not activism. It is not theory. It is engineering.', type: 'thesis', why: 'x' });
    }
  });

  // No manual reposition — findNextPullquote itself left the cursor at the
  // end of the found candidate, so a bare re-run ("skip") should not scan
  // back over it.
  await findNextPullquote({
    vscode,
    resolveSopPath: () => '/tmp/sop.md',
    callClaudeCliFn: async args => {
      excerpts.push(args.userText);
      return '{"quote": null}';
    }
  });

  assert.strictEqual(excerpts.length, 2);
  assert.ok(excerpts[0].includes('It is not activism'));
  assert.ok(!excerpts[1].includes('It is not activism'));
  assert.ok(excerpts[1].includes('closing paragraph'));
}

async function testMissingSopStopsBeforeCallingCli() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(0, 0));
  const vscode = fakeVscode(editor, {});
  let called = false;

  const result = await findNextPullquote({
    vscode,
    resolveSopPath: () => { throw new Error('Could not find pullquote SOP at /tmp/missing.md'); },
    callClaudeCliFn: async () => { called = true; return '{"quote": null}'; }
  });

  assert.strictEqual(result, null);
  assert.strictEqual(called, false);
  assert.ok(vscode.window._messages.some(m => m[0] === 'error' && m[1].includes('Could not find pullquote SOP')));
}

async function testQuoteNotFoundVerbatimSurfacesError() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(0, 0));
  const vscode = fakeVscode(editor, {});

  const result = await findNextPullquote({
    vscode,
    resolveSopPath: () => '/tmp/sop.md',
    callClaudeCliFn: async () => JSON.stringify({ quote: 'This text does not appear anywhere in the doc.' })
  });

  assert.strictEqual(result, null);
  assert.ok(vscode.window._messages.some(m => m[0] === 'error' && m[1].includes('not found verbatim')));
}

async function testInsertPullquoteRequiresSelection() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(0, 0), pos(0, 0));
  const vscode = fakeVscode(editor, {});
  let executed = false;

  const ok = await insertPullquote({ vscode, executeCommand: async () => { executed = true; } });

  assert.strictEqual(ok, false);
  assert.strictEqual(executed, false);
  assert.ok(vscode.window._messages.some(m => m[0] === 'error' && m[1].includes('No pullquote selected')));
}

async function testInsertPullquoteDelegatesToTableToolsAndRestoresSelection() {
  const document = fakeDocument(DOC_TEXT);
  const start = document.positionAt(DOC_TEXT.indexOf('It is not activism'));
  const end = document.positionAt(DOC_TEXT.indexOf('It is not activism') + 'It is not activism. It is not theory. It is engineering.'.length);
  const editor = fakeEditor(document, start, end);
  const vscode = fakeVscode(editor, {});
  const executedCommands = [];

  const ok = await insertPullquote({
    vscode,
    executeCommand: async (...args) => {
      executedCommands.push(args);
      // Simulate table-tools mutating the selection mid-command.
      editor.selection = { start: pos(6, 0), end: pos(6, 0), isEmpty: true };
    }
  });

  assert.strictEqual(ok, true);
  assert.deepStrictEqual(executedCommands, [['oatTables.promotePullquote']]);
  assert.deepStrictEqual(editor.selection.start, start);
  assert.deepStrictEqual(editor.selection.end, end);
}

async function testInsertPullquoteSurfacesMissingTableToolsDependency() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(4, 0), pos(4, 5));
  const vscode = fakeVscode(editor, {});

  const ok = await insertPullquote({
    vscode,
    executeCommand: async () => { throw new Error("command 'oatTables.promotePullquote' not found"); }
  });

  assert.strictEqual(ok, false);
  assert.ok(vscode.window._messages.some(m => m[0] === 'error' && m[1].includes('OAT Table Tools extension')));
}

async function testInsertAndContinueChainsFindNextAfterSuccessfulInsert() {
  const document = fakeDocument(DOC_TEXT);
  const start = document.positionAt(DOC_TEXT.indexOf('It is not activism'));
  const end = document.positionAt(DOC_TEXT.indexOf('It is not activism') + 'It is not activism. It is not theory. It is engineering.'.length);
  const editor = fakeEditor(document, start, end);
  const vscode = fakeVscode(editor, {});
  let findCalls = 0;

  const result = await insertPullquoteAndContinue({
    vscode,
    executeCommand: async () => {},
    resolveSopPath: () => '/tmp/sop.md',
    callClaudeCliFn: async () => { findCalls++; return '{"quote": null}'; }
  });

  assert.strictEqual(findCalls, 1);
  assert.strictEqual(result, null);
}

async function testInsertAndContinueSkipsFindNextWhenInsertFails() {
  const document = fakeDocument(DOC_TEXT);
  const editor = fakeEditor(document, pos(0, 0), pos(0, 0));
  const vscode = fakeVscode(editor, {});
  let findCalls = 0;

  await insertPullquoteAndContinue({
    vscode,
    executeCommand: async () => {},
    callClaudeCliFn: async () => { findCalls++; return '{"quote": null}'; }
  });

  assert.strictEqual(findCalls, 0);
}

function testParseCandidateResponseHandlesFencedJson() {
  const parsed = parseCandidateResponse('```json\n{"quote": "x", "type": "mechanism", "why": "y"}\n```');
  assert.deepStrictEqual(parsed, { quote: 'x', type: 'mechanism', why: 'y' });
}

function testParseCandidateResponseHandlesNullQuote() {
  assert.deepStrictEqual(parseCandidateResponse('{"quote": null}'), { quote: null });
}

function testParseCandidateResponseRejectsGarbage() {
  assert.strictEqual(parseCandidateResponse('not json at all'), null);
}

function testExtractJsonStripsSurroundingProse() {
  assert.strictEqual(extractJson('Sure, here you go:\n{"quote": "x"}\nHope that helps!'), '{"quote": "x"}');
}

function pos(line, character) {
  return { line, character };
}

function fakeDocument(text) {
  const lines = text.split('\n');
  return {
    languageId: 'markdown',
    getText: selection => {
      if (!selection) return text;
      return sliceByPosition(text, lines, selection.start, selection.end);
    },
    offsetAt: position => offsetOf(lines, position),
    positionAt: offset => positionOf(lines, offset)
  };
}

function sliceByPosition(text, lines, start, end) {
  return text.slice(offsetOf(lines, start), offsetOf(lines, end));
}

function offsetOf(lines, position) {
  let offset = 0;
  for (let i = 0; i < position.line; i++) offset += lines[i].length + 1;
  return offset + position.character;
}

function positionOf(lines, offset) {
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line].length) return { line, character: remaining };
    remaining -= lines[line].length + 1;
  }
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function fakeEditor(document, activePos, endPos) {
  const start = activePos;
  const end = endPos || activePos;
  return {
    document,
    selection: { start, end, active: end, isEmpty: start.line === end.line && start.character === end.character },
    revealRange: () => {}
  };
}

function fakeVscode(editor, { settings = {} } = {}) {
  const messages = [];
  return {
    window: {
      activeTextEditor: editor,
      showErrorMessage: message => messages.push(['error', message]),
      showWarningMessage: message => messages.push(['warning', message]),
      showInformationMessage: message => messages.push(['info', message]),
      withProgress: (_options, task) => task({ report: () => {} }),
      _messages: messages
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, defaultValue) => (key in settings ? settings[key] : defaultValue)
      })
    },
    commands: {
      executeCommand: async () => { throw new Error("command not found in bare fakeVscode — pass executeCommand explicitly"); }
    },
    ProgressLocation: { Notification: 1 },
    Selection: function (anchor, active) {
      const anchorFirst = comparePositions(anchor, active) <= 0;
      this.anchor = anchor;
      this.active = active;
      this.start = anchorFirst ? anchor : active;
      this.end = anchorFirst ? active : anchor;
      this.isEmpty = comparePositions(anchor, active) === 0;
    },
    Range: function (start, end) { this.start = start; this.end = end; },
    TextEditorRevealType: { InCenterIfOutsideViewport: 1 }
  };
}

function comparePositions(a, b) {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

(async () => {
  await testSelectsReturnedCandidateFromCursor();
  await testSecondCallScansPastFirstFoundCandidate();
  await testMissingSopStopsBeforeCallingCli();
  await testQuoteNotFoundVerbatimSurfacesError();
  await testInsertPullquoteRequiresSelection();
  await testInsertPullquoteDelegatesToTableToolsAndRestoresSelection();
  await testInsertPullquoteSurfacesMissingTableToolsDependency();
  await testInsertAndContinueChainsFindNextAfterSuccessfulInsert();
  await testInsertAndContinueSkipsFindNextWhenInsertFails();
  testParseCandidateResponseHandlesFencedJson();
  testParseCandidateResponseHandlesNullQuote();
  testParseCandidateResponseRejectsGarbage();
  testExtractJsonStripsSurroundingProse();
  console.log('pullquoteCommands tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
