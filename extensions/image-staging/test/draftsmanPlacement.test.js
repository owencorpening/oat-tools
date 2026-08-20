'use strict';

const assert = require('assert');
const Module = require('module');

const fakeVscode = {
  window: { activeTextEditor: null },
  workspace: {
    getConfiguration: () => ({ get: () => '' }),
    getWorkspaceFolder: () => ({ uri: { fsPath: '/repo/oat-content' } })
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const { buildDraftsmanPlacement, resolvePlaceholderLine, runPlacement } = require('../lib/draftsmanPlacement');

Module._load = originalLoad;

function fakeEditor({ path = '/repo/oat-content/substack-unpublished/water-series/part-09-title/part-09.md', lines, cursorLine = 0 } = {}) {
  const docLines = lines || ['# Part IX Title', '', 'Some prose.'];
  return {
    document: {
      uri: { fsPath: path },
      lineCount: docLines.length,
      lineAt: line => ({
        text: docLines[line],
        range: { start: { line, character: 0 }, end: { line, character: docLines[line].length } }
      }),
      getText: () => docLines.join('\n'),
      save: async function save() { this.saved = true; }
    },
    selection: { active: { line: cursorLine } }
  };
}

function testBuildDraftsmanPlacementSetsTargetAndSnippetFormat() {
  const editor = fakeEditor();
  const asset = { id: 'asset-123' };

  const { contentDraft, placement, saga } = buildDraftsmanPlacement({ vscode: fakeVscode, editor, asset });

  assert.strictEqual(placement.target, 'other');
  assert.strictEqual(placement.snippetFormat, 'markdown-image');
  assert.strictEqual(placement.assetId, 'asset-123');
  assert.strictEqual(placement.contentDraftId, contentDraft.id);
  assert.strictEqual(placement.series, 'water-series');
  assert.strictEqual(placement.partDir, 'part-09');
  assert.strictEqual(typeof placement.id, 'string');
  assert.strictEqual(typeof saga.id, 'string');
}

function testBuildDraftsmanPlacementIdsAreDeterministic() {
  const editor = fakeEditor();
  const asset = { id: 'asset-123' };

  const first = buildDraftsmanPlacement({ vscode: fakeVscode, editor, asset });
  const second = buildDraftsmanPlacement({ vscode: fakeVscode, editor, asset });

  assert.strictEqual(first.placement.id, second.placement.id, 'same asset+draft should produce the same placement id');
}

async function testResolvePlaceholderLineReplacesExactLineNotWholeDoc() {
  const lines = [
    '# Heading',
    '',
    '![TODO:IMG "context"](.draftsman/placeholder-image-needed.png)',
    '',
    'Unrelated trailing paragraph.'
  ];
  const editor = fakeEditor({ lines });
  let editedRange = null;
  editor.edit = async editFn => {
    const editBuilder = {
      replace: (range, newText) => {
        editedRange = range;
        lines[2] = newText;
      }
    };
    editFn(editBuilder);
    return true;
  };

  const writeSnippet = resolvePlaceholderLine({ vscode: fakeVscode, editor, lineNumber: 2 });
  await writeSnippet({ snippet: '![Resolved](https://raw.githubusercontent.com/x/y/z.jpg)' });

  assert.strictEqual(editedRange.start.line, 2);
  assert.strictEqual(editedRange.end.line, 2);
  assert.strictEqual(lines[2], '![Resolved](https://raw.githubusercontent.com/x/y/z.jpg)');
  assert.strictEqual(lines[0], '# Heading', 'other lines must be untouched');
  assert.strictEqual(lines[4], 'Unrelated trailing paragraph.', 'other lines must be untouched');
  assert.strictEqual(editor.document.saved, true);
}

async function testResolvePlaceholderLineThrowsWhenEditRejected() {
  const editor = fakeEditor({ lines: ['line one'] });
  editor.edit = async () => false;
  const writeSnippet = resolvePlaceholderLine({ vscode: fakeVscode, editor, lineNumber: 0 });

  await assert.rejects(() => writeSnippet({ snippet: 'x' }), /rejected/);
}

async function testRunPlacementIsInjectable() {
  let capturedOptions = null;
  const fakePlace = async options => { capturedOptions = options; return { placed: true }; };

  const result = await runPlacement({ db: {}, sagaId: 'saga_x' }, fakePlace);

  assert.deepStrictEqual(result, { placed: true });
  assert.deepStrictEqual(capturedOptions, { db: {}, sagaId: 'saga_x' });
}

(async () => {
  testBuildDraftsmanPlacementSetsTargetAndSnippetFormat();
  testBuildDraftsmanPlacementIdsAreDeterministic();
  await testResolvePlaceholderLineReplacesExactLineNotWholeDoc();
  await testResolvePlaceholderLineThrowsWhenEditRejected();
  await testRunPlacementIsInjectable();
  console.log('draftsmanPlacement tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
