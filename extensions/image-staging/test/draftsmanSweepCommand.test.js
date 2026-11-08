'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { sweepArticle, findPlaceholders } = require('../lib/draftsmanSweepCommand');

Module._load = originalLoad;

const FIXTURE_ARTICLE = [
  '# Article Title',
  '',
  'Intro paragraph.',
  '',
  '![TODO:IMG "context for stock match"](.draftsman/placeholder-image-needed.png)',
  '',
  'Middle paragraph.',
  '',
  '![TODO:IMG "context already in downloads"](.draftsman/placeholder-image-needed.png)',
  '',
  'Later paragraph.',
  '',
  '![TODO:IMG "context with no match anywhere"](.draftsman/placeholder-image-needed.png)',
  '',
  'Final paragraph — this placeholder should never be reached this run.',
  '',
  '![TODO:IMG "context never reached"](.draftsman/placeholder-image-needed.png)'
].join('\n');

function fakeEditor(text) {
  const lines = text.split('\n');
  return {
    document: {
      languageId: 'markdown',
      uri: { fsPath: '/repo/article.md' },
      getText: () => lines.join('\n'),
      lineAt: line => ({ range: { end: { line, character: lines[line].length } } })
    }
  };
}

function fakeVscode(editor) {
  return {
    window: {
      activeTextEditor: editor,
      showErrorMessage: () => {},
      showInformationMessage: () => {},
      withProgress: async (options, task) => task({ report: () => {} })
    },
    ProgressLocation: { Notification: 1 }
  };
}

function testFindPlaceholdersLocatesAllFour() {
  const found = findPlaceholders(FIXTURE_ARTICLE);
  assert.strictEqual(found.length, 4);
  assert.strictEqual(found[0].context, 'context for stock match');
  assert.strictEqual(found[3].context, 'context never reached');
}

async function testSweepEngine1ThenEngine2FallbackOrdering() {
  const editor = fakeEditor(FIXTURE_ARTICLE);
  const vscode = fakeVscode(editor);

  const placedCalls = [];

  // Engine 1: only the first placeholder's query resolves to a stock match.
  const attemptAutoResolve = async ({ query }) =>
    query === 'context for stock match' ? { provider: 'pexels', title: 'Stock Match' } : null;
  const stageEngine1Result = async ({ result }) => ({ asset: { id: 'asset-stock', ...result } });

  // Engine 2 / Downloads check: for the second placeholder the author picks
  // an image already sitting in Downloads; for the third they pick nothing.
  // (Sweep passes the placeholder context for display; the fake keys on it.)
  const awaitGeneratedIntake = async ({ context }) =>
    context === 'context already in downloads' ? { id: 'asset-downloads', title: 'Downloads Match' } : null;

  let promptBuilt = null;
  const buildGeneratePrompt = ({ context }) => { promptBuilt = context; return `PROMPT for ${context}`; };
  let promptPresentedText = null;
  const presentPromptForRefinement = async ({ prompt }) => { promptPresentedText = prompt; };

  const place = async options => { placedCalls.push(options); };
  const buildPlacement = ({ asset }) => ({ placement: { id: `placement_${asset.id}`, assetId: asset.id }, saga: { id: `saga_${asset.id}` } });
  const resolveLine = ({ lineNumber }) => async ({ snippet }) => ({ lineNumber, snippet });

  const result = await sweepArticle({
    vscode,
    ledgerWriter: {},
    attemptAutoResolve,
    stageEngine1Result,
    buildGeneratePrompt,
    presentPromptForRefinement,
    awaitGeneratedIntake,
    place,
    buildPlacement,
    resolveLine,
    repoPath: '/repo/oat-assets'
  });

  // Placeholder 1 (stock match) and placeholder 2 (already in Downloads)
  // both resolve automatically — no prompt needed for either.
  assert.strictEqual(placedCalls.length, 2);
  assert.strictEqual(placedCalls[0].asset.id, 'asset-stock');
  assert.strictEqual(placedCalls[1].asset.id, 'asset-downloads');

  // Placeholder 3 has nothing available anywhere — Sweep hands off exactly
  // one prompt for it and stops, never reaching placeholder 4.
  assert.strictEqual(promptBuilt, 'context with no match anywhere');
  assert.strictEqual(promptPresentedText, 'PROMPT for context with no match anywhere');

  assert.deepStrictEqual(result, { resolved: 2, remaining: 2, promptPresented: true });
}

async function testSweepWithNoPlaceholdersReportsCleanRun() {
  const editor = fakeEditor('# No placeholders here.\n\nJust prose.');
  const vscode = fakeVscode(editor);
  const result = await sweepArticle({ vscode, ledgerWriter: {}, repoPath: '/repo/oat-assets' });
  assert.deepStrictEqual(result, { resolved: 0, remaining: 0, promptPresented: false });
}

async function testSweepAllResolvableViaEngine1NeverBuildsPrompt() {
  const article = [
    '![TODO:IMG "a"](.draftsman/placeholder-image-needed.png)',
    '![TODO:IMG "b"](.draftsman/placeholder-image-needed.png)'
  ].join('\n');
  const editor = fakeEditor(article);
  const vscode = fakeVscode(editor);

  let promptCalled = false;
  const result = await sweepArticle({
    vscode,
    ledgerWriter: {},
    attemptAutoResolve: async () => ({ provider: 'pexels' }),
    stageEngine1Result: async () => ({ asset: { id: 'x' } }),
    buildGeneratePrompt: () => { promptCalled = true; return 'unused'; },
    presentPromptForRefinement: async () => {},
    awaitGeneratedIntake: async () => { throw new Error('should never be called when Engine 1 always resolves'); },
    place: async () => {},
    buildPlacement: ({ asset }) => ({ placement: { id: 'p' }, saga: { id: 's' } }),
    resolveLine: () => async () => {},
    repoPath: '/repo/oat-assets'
  });

  assert.strictEqual(promptCalled, false);
  assert.deepStrictEqual(result, { resolved: 2, remaining: 0, promptPresented: false });
}

(async () => {
  testFindPlaceholdersLocatesAllFour();
  await testSweepEngine1ThenEngine2FallbackOrdering();
  await testSweepWithNoPlaceholdersReportsCleanRun();
  await testSweepAllResolvableViaEngine1NeverBuildsPrompt();
  console.log('draftsmanSweepCommand tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
