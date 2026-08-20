'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  reviewImage,
  findImageLineAtCursor,
  pickEngineChoice
} = require('../lib/draftsmanReviewCommand');

Module._load = originalLoad;

const PLACEHOLDER_LINE = '![TODO:IMG "wetland context"](.draftsman/placeholder-image-needed.png)';
const STOCK_RESOLVED_LINE = '![Wetland Restoration](https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/wetland/wetland.jpg)';
const GENERATED_RESOLVED_LINE = '![Generated Cyanotype Illustration](https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/illustration/illustration.png)';

function fakeEditor(lineText) {
  return {
    document: {
      languageId: 'markdown',
      lineAt: () => ({ text: lineText, range: { end: { line: 0, character: lineText.length } } })
    },
    selection: { active: { line: 0 } },
    edit: async () => true
  };
}

function fakeVscode(editor, { engineChoiceValue = 'stock' } = {}) {
  return {
    window: {
      activeTextEditor: editor,
      showErrorMessage: () => {},
      showInformationMessage: () => {},
      showQuickPick: async items => items.find(item => item.value === engineChoiceValue) || null
    }
  };
}

function testFindImageLineAtCursorDetectsPlaceholder() {
  const doc = { lineAt: () => ({ text: PLACEHOLDER_LINE }) };
  const result = findImageLineAtCursor(doc, 0);
  assert.strictEqual(result.isPlaceholder, true);
  assert.strictEqual(result.alt, 'TODO:IMG "wetland context"');
}

function testFindImageLineAtCursorDetectsResolvedImage() {
  const doc = { lineAt: () => ({ text: STOCK_RESOLVED_LINE }) };
  const result = findImageLineAtCursor(doc, 0);
  assert.strictEqual(result.isPlaceholder, false);
  assert.strictEqual(result.currentSrc, 'https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/wetland/wetland.jpg');
}

function testFindImageLineAtCursorReturnsNullForNonImageLine() {
  const doc = { lineAt: () => ({ text: 'Just a plain sentence, no image here.' }) };
  assert.strictEqual(findImageLineAtCursor(doc, 0), null);
}

async function testReviewImageOnPlaceholderViaStockDoesNotRemoveAnything() {
  const editor = fakeEditor(PLACEHOLDER_LINE);
  const vscode = fakeVscode(editor, { engineChoiceValue: 'stock' });
  let removeCalled = false;

  const result = await reviewImage({
    vscode,
    ledgerWriter: {},
    stageEngine1Result: async () => ({ asset: { id: 'asset-1' } }),
    runManualSearch: async () => ({ provider: 'pexels', sourceUrl: 'https://pexels.com/x' }),
    place: async options => ({ placed: options }),
    buildPlacement: ({ asset }) => ({ placement: { id: 'p', assetId: asset.id }, saga: { id: 's' } }),
    resolveLine: () => async () => {},
    repoPath: '/repo/oat-assets',
    removeOldAsset: () => { removeCalled = true; }
  });

  assert.strictEqual(removeCalled, false, 'a placeholder has no old asset to remove');
  assert.strictEqual(result.placed.asset.id, 'asset-1');
}

async function testReviewImageOnStockResolvedViaGenerateRemovesOldAsset() {
  const editor = fakeEditor(STOCK_RESOLVED_LINE);
  const vscode = fakeVscode(editor, { engineChoiceValue: 'generate' });
  let removedWith = null;

  await reviewImage({
    vscode,
    ledgerWriter: { saveAsset: async ({ asset }) => ({ asset: { ...asset, id: 'asset-2' } }) },
    buildGeneratePrompt: () => 'a prompt',
    presentPromptForRefinement: async () => {},
    awaitGeneratedIntake: async () => ({ id: 'pre-save-id', title: 'Generated' }),
    place: async options => ({ placed: options }),
    buildPlacement: ({ asset }) => ({ placement: { id: 'p', assetId: asset.id }, saga: { id: 's' } }),
    resolveLine: () => async () => {},
    repoPath: '/repo/oat-assets',
    removeOldAsset: options => { removedWith = options; }
  });

  assert.deepStrictEqual(removedWith, {
    repoPath: '/repo/oat-assets',
    rawAssetUrl: 'https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/wetland/wetland.jpg'
  });
}

async function testReviewImageOnGeneratedResolvedViaStockRemovesOldAsset() {
  const editor = fakeEditor(GENERATED_RESOLVED_LINE);
  const vscode = fakeVscode(editor, { engineChoiceValue: 'stock' });
  let removedWith = null;

  await reviewImage({
    vscode,
    ledgerWriter: {},
    stageEngine1Result: async () => ({ asset: { id: 'asset-3' } }),
    runManualSearch: async () => ({ provider: 'pexels', sourceUrl: 'https://pexels.com/y' }),
    place: async options => ({ placed: options }),
    buildPlacement: ({ asset }) => ({ placement: { id: 'p', assetId: asset.id }, saga: { id: 's' } }),
    resolveLine: () => async () => {},
    repoPath: '/repo/oat-assets',
    removeOldAsset: options => { removedWith = options; }
  });

  assert.strictEqual(
    removedWith.rawAssetUrl,
    'https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/illustration/illustration.png'
  );
}

async function testReviewImageErrorsWhenCursorNotOnImageLine() {
  const editor = fakeEditor('Not an image line at all.');
  const vscode = fakeVscode(editor);
  let errorShown = false;
  vscode.window.showErrorMessage = () => { errorShown = true; };

  const result = await reviewImage({ vscode, ledgerWriter: {} });

  assert.strictEqual(result, null);
  assert.strictEqual(errorShown, true);
}

async function testReviewImageReturnsNullWhenEngineChoiceCancelled() {
  const editor = fakeEditor(PLACEHOLDER_LINE);
  const vscode = fakeVscode(editor, { engineChoiceValue: 'nonexistent' }); // showQuickPick returns null
  const result = await reviewImage({ vscode, ledgerWriter: {} });
  assert.strictEqual(result, null);
}

async function testReviewImageGenerateReturnsNullWhenNothingIntakeYet() {
  const editor = fakeEditor(PLACEHOLDER_LINE);
  const vscode = fakeVscode(editor, { engineChoiceValue: 'generate' });
  let placeCalled = false;

  const result = await reviewImage({
    vscode,
    ledgerWriter: {},
    buildGeneratePrompt: () => 'a prompt',
    presentPromptForRefinement: async () => {},
    awaitGeneratedIntake: async () => null, // nothing generated yet
    place: async () => { placeCalled = true; }
  });

  assert.strictEqual(result, null);
  assert.strictEqual(placeCalled, false, 'must not place anything when Engine 2 has nothing to intake yet');
}

(async () => {
  testFindImageLineAtCursorDetectsPlaceholder();
  testFindImageLineAtCursorDetectsResolvedImage();
  testFindImageLineAtCursorReturnsNullForNonImageLine();
  await testReviewImageOnPlaceholderViaStockDoesNotRemoveAnything();
  await testReviewImageOnStockResolvedViaGenerateRemovesOldAsset();
  await testReviewImageOnGeneratedResolvedViaStockRemovesOldAsset();
  await testReviewImageErrorsWhenCursorNotOnImageLine();
  await testReviewImageReturnsNullWhenEngineChoiceCancelled();
  await testReviewImageGenerateReturnsNullWhenNothingIntakeYet();
  console.log('draftsmanReviewCommand tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
