'use strict';

const { parseImageLine } = require('./draftsmanMarker');
const engine1 = require('./draftsmanEngine1');
const engine2 = require('./draftsmanEngine2');
const { buildDraftsmanPlacement, resolvePlaceholderLine, runPlacement } = require('./draftsmanPlacement');
const { removePlacedAssetByRawAssetUrl } = require('./imageAssetsRepo');
const { imagesRepoPath } = require('./plannedPlacementRunCommand');

function registerDraftsmanReviewCommand(context, vscode, options = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.reviewImage', () => reviewImage({ vscode, ...options }))
  );
}

function findImageLineAtCursor(document, cursorLine) {
  const lineText = document.lineAt(cursorLine).text;
  const parsed = parseImageLine(lineText);
  if (!parsed) return null;
  return { line: cursorLine, isPlaceholder: parsed.isPlaceholder, currentSrc: parsed.src, alt: parsed.alt };
}

async function pickEngineChoice(vscode) {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Search stock photos', description: 'Manual browsing, pre-filled query', value: 'stock' },
      { label: 'Generate new image', description: 'Single-image prompt-craft session', value: 'generate' }
    ],
    { placeHolder: 'Draftsman: how do you want to resolve this image?' }
  );
  return picked ? picked.value : null;
}

// Deliberately not the full webview (ImagePanelProvider is a singleton
// view provider, not reusable headlessly outside its own message loop) —
// a lighter QuickPick-based picker. No thumbnails is the accepted
// tradeoff of not reusing the webview for this pass.
async function runManualStockSearch({ vscode, ledgerWriter, prefilledQuery = '' } = {}) {
  const query = await vscode.window.showInputBox({ prompt: 'Search stock photos', value: prefilledQuery });
  if (!query) return null;

  const response = await ledgerWriter.searchImageProviders({ query });
  const results = (response && response.results) || [];
  if (results.length === 0) {
    vscode.window.showInformationMessage('OAT: No stock results found for that query.');
    return null;
  }

  const picked = await vscode.window.showQuickPick(
    results.map(result => ({
      label: result.title || result.provider,
      description: [result.provider, result.license].filter(Boolean).join(' · '),
      detail: result.sourceUrl,
      result
    })),
    { placeHolder: 'Select an image to insert' }
  );
  return picked ? picked.result : null;
}

// Must literally reuse Engine 1/Engine 2 from Sweep — no fourth mechanism.
async function reviewImage({
  vscode,
  ledgerWriter,
  stageEngine1Result = engine1.stageResult,
  buildGeneratePrompt = engine2.buildGeneratePrompt,
  presentPromptForRefinement = engine2.presentPromptForRefinement,
  awaitGeneratedIntake = engine2.awaitGeneratedIntake,
  place = runPlacement,
  buildPlacement = buildDraftsmanPlacement,
  resolveLine = resolvePlaceholderLine,
  runManualSearch = runManualStockSearch,
  pickEngine = pickEngineChoice,
  removeOldAsset = removePlacedAssetByRawAssetUrl,
  repoPath
} = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return null;
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return null;
  }

  const cursorLine = editor.selection.active.line;
  const imageLine = findImageLineAtCursor(editor.document, cursorLine);
  if (!imageLine) {
    vscode.window.showErrorMessage('OAT: Cursor must be on a Draftsman image line (placeholder or resolved).');
    return null;
  }

  const engineChoice = await pickEngine(vscode);
  if (!engineChoice) return null;

  let asset = null;
  if (engineChoice === 'stock') {
    const result = await runManualSearch({ vscode, ledgerWriter, prefilledQuery: imageLine.alt || '' });
    if (!result) return null;
    const staged = await stageEngine1Result({ ledgerWriter, result });
    asset = staged && staged.asset;
  } else {
    const prompt = buildGeneratePrompt({ context: imageLine.alt });
    await presentPromptForRefinement({ vscode, prompt });
    const generatedAsset = await awaitGeneratedIntake({ vscode, query: imageLine.alt });
    if (!generatedAsset) return null; // nothing to place yet — author re-runs Review once generated
    if (ledgerWriter && ledgerWriter.saveAsset) {
      const saved = await ledgerWriter.saveAsset({ asset: generatedAsset });
      asset = (saved && saved.asset) || generatedAsset;
    } else {
      asset = generatedAsset;
    }
  }

  if (!asset) return null;

  const resolvedRepoPath = repoPath || imagesRepoPath(vscode);
  const { placement, saga } = buildPlacement({ vscode, editor, asset });
  const placed = await place({
    db: {},
    sagaId: saga.id,
    repoPath: resolvedRepoPath,
    ledger: ledgerWriter,
    asset,
    placement,
    writeSnippet: resolveLine({ vscode, editor, lineNumber: imageLine.line })
  });

  // Delete-after-success: if a failed new placement never got this far,
  // the old image stays live rather than leaving zero images placed.
  if (!imageLine.isPlaceholder && imageLine.currentSrc) {
    removeOldAsset({ repoPath: resolvedRepoPath, rawAssetUrl: imageLine.currentSrc });
  }

  vscode.window.showInformationMessage('OAT: Draftsman replaced the image.');
  return placed;
}

module.exports = {
  registerDraftsmanReviewCommand,
  reviewImage,
  findImageLineAtCursor,
  pickEngineChoice,
  runManualStockSearch
};
