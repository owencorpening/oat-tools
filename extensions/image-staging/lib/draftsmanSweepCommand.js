'use strict';

const { parsePlaceholderLine } = require('./draftsmanMarker');
const engine1 = require('./draftsmanEngine1');
const engine2 = require('./draftsmanEngine2');
const { buildDraftsmanPlacement, resolvePlaceholderLine, runPlacement } = require('./draftsmanPlacement');
const { imagesRepoPath } = require('./plannedPlacementRunCommand');

function registerDraftsmanSweepCommand(context, vscode, options = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.sweepArticle', () => sweepArticle({ vscode, ...options }))
  );
}

function findPlaceholders(documentText) {
  const lines = String(documentText || '').split(/\r?\n/);
  const placeholders = [];
  lines.forEach((lineText, index) => {
    const parsed = parsePlaceholderLine(lineText);
    if (parsed) placeholders.push({ line: index, context: parsed.context });
  });
  return placeholders;
}

// Per placeholder: try Engine 1 (stock) first — a license-safe match
// auto-inserts with no author interaction. If Engine 1 finds nothing, check
// whether something's already sitting in Downloads for this context (an
// enhancement beyond the SOP's literal text, not a contradiction of it —
// it just means an image generated in an earlier session gets picked up
// for free, same as a stock match would). Only when there's truly nothing
// to intake yet does Sweep hand off a fresh Engine 2 prompt — and per the
// SOP's "single image at a time," it presents exactly ONE such prompt per
// run and stops there, rather than queuing several external-generation
// tasks in one go. Re-running Sweep after generating picks up right where
// it left off.
async function sweepArticle({
  vscode,
  ledgerWriter,
  attemptAutoResolve = engine1.attemptAutoResolve,
  stageEngine1Result = engine1.stageResult,
  buildGeneratePrompt = engine2.buildGeneratePrompt,
  presentPromptForRefinement = engine2.presentPromptForRefinement,
  awaitGeneratedIntake = engine2.awaitGeneratedIntake,
  place = runPlacement,
  buildPlacement = buildDraftsmanPlacement,
  resolveLine = resolvePlaceholderLine,
  repoPath = imagesRepoPath(vscode)
} = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return { resolved: 0, remaining: 0, promptPresented: false };
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return { resolved: 0, remaining: 0, promptPresented: false };
  }

  const placeholders = findPlaceholders(editor.document.getText());
  if (placeholders.length === 0) {
    vscode.window.showInformationMessage('OAT: No Draftsman placeholders found in this article.');
    return { resolved: 0, remaining: 0, promptPresented: false };
  }

  let resolved = 0;
  let promptPresented = false;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'OAT: Draftsman — sweeping article', cancellable: false },
    async progress => {
      for (let i = 0; i < placeholders.length; i++) {
        const placeholder = placeholders[i];
        progress.report({ message: `Resolving placeholder ${i + 1} of ${placeholders.length}` });

        const asset = await resolveOnePlaceholder(placeholder, {
          vscode,
          ledgerWriter,
          attemptAutoResolve,
          stageEngine1Result,
          awaitGeneratedIntake
        });

        if (asset) {
          await placeResolvedAsset({ vscode, editor, asset, placeholder, place, buildPlacement, resolveLine, ledgerWriter, repoPath });
          resolved++;
          continue;
        }

        const prompt = buildGeneratePrompt({ context: placeholder.context });
        await presentPromptForRefinement({ vscode, prompt });
        promptPresented = true;
        break;
      }
    }
  );

  const remaining = placeholders.length - resolved;
  vscode.window.showInformationMessage(
    `OAT: Draftsman swept "${editor.document.uri.fsPath.split('/').pop()}" — ${resolved} of ${placeholders.length} resolved.` +
      (promptPresented ? ' A generation prompt is on your clipboard for the next one.' : '')
  );
  return { resolved, remaining, promptPresented };
}

async function resolveOnePlaceholder(placeholder, { vscode, ledgerWriter, attemptAutoResolve, stageEngine1Result, awaitGeneratedIntake }) {
  const stockCandidate = await attemptAutoResolve({ query: placeholder.context, ledgerWriter });
  if (stockCandidate) {
    const staged = await stageEngine1Result({ ledgerWriter, result: stockCandidate });
    return staged && staged.asset;
  }

  const generatedAsset = await awaitGeneratedIntake({ vscode, query: placeholder.context });
  if (!generatedAsset) return null;

  if (ledgerWriter && ledgerWriter.saveAsset) {
    const saved = await ledgerWriter.saveAsset({ asset: generatedAsset });
    return (saved && saved.asset) || generatedAsset;
  }
  return generatedAsset;
}

async function placeResolvedAsset({ vscode, editor, asset, placeholder, place, buildPlacement, resolveLine, ledgerWriter, repoPath }) {
  const { placement, saga } = buildPlacement({ vscode, editor, asset });
  await place({
    db: {},
    sagaId: saga.id,
    repoPath,
    ledger: ledgerWriter,
    asset,
    placement,
    writeSnippet: resolveLine({ vscode, editor, lineNumber: placeholder.line })
  });
}

module.exports = { registerDraftsmanSweepCommand, sweepArticle, findPlaceholders };
