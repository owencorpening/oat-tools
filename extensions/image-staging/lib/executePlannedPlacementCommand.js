'use strict';

const { placeAsset } = require('./imagePipeline');
const { buildPlacementRunInput } = require('./plannedPlacementRun');
const { placementItem } = require('./ledgerBrowseCommands');
const { imagesRepoPath } = require('./plannedPlacementRunCommand');

function registerExecutePlannedPlacementCommand(context, vscode, options = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.executePlannedPlacementRun', () =>
      executePlannedPlacementRun({ vscode, ...options })
    )
  );
}

async function executePlannedPlacementRun({
  vscode,
  ledgerWriter,
  buildRunInput = buildPlacementRunInput,
  runPlacement = placeAsset,
  existsSync = require('fs').existsSync
} = {}) {
  if (!hasPlacementLedgerMethods(ledgerWriter)) {
    vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl to execute image placement runs.');
    return null;
  }

  const result = await ledgerWriter.listPlannedPlacements();
  const placements = result.placements || [];
  if (placements.length === 0) {
    vscode.window.showInformationMessage('OAT: No planned placements yet — open the OAT Image Staging panel and click Place on a staged image first.');
    return [];
  }

  const repoPath = imagesRepoPath(vscode);
  if (!existsSync(repoPath)) {
    const choice = await vscode.window.showWarningMessage(
      `OAT: Images repo not found at ${repoPath}. Set oatImages.imagesRepoPath before executing.`,
      'Open Settings'
    );
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'oatImages.imagesRepoPath');
    }
    return null;
  }

  const picked = await vscode.window.showQuickPick(placements.map(placementItem), {
    placeHolder: 'Planned placement to execute'
  });
  if (!picked) return placements;

  const payload = buildRunInput(picked.record, {
    repoPath,
    download: true,
    commit: true
  });

  const confirmation = await vscode.window.showWarningMessage(
    `OAT: Place "${payload.asset.displayName || payload.asset.slug}" now? This writes image files, commits and pushes the asset repo, edits the draft, and updates the ledger.`,
    { modal: true },
    'Place Image'
  );
  if (confirmation !== 'Place Image') return payload;

  const editor = await prepareDraftEditor(vscode, picked.record);
  if (!editor) return payload;

  const placed = await runPlacement({
    ...payload,
    db: {},
    ledger: ledgerWriter,
    writeSnippet: ({ snippet, snippetFormat, placement }) =>
      writeSnippetToActiveEditor(vscode, { snippet, snippetFormat, placement })
  });

  vscode.window.showInformationMessage('OAT: Image placement completed.');
  return placed;
}

async function prepareDraftEditor(vscode, record) {
  if (vscode.window.activeTextEditor) return vscode.window.activeTextEditor;

  const contentRepoPath = record.content_repo_path || record.contentRepoPath;
  const draftPath = record.draft_path || record.draftPath;
  if (!contentRepoPath || !draftPath || !vscode.workspace.openTextDocument || !vscode.window.showTextDocument) {
    vscode.window.showWarningMessage('OAT: Open the target draft before executing this placement.');
    return null;
  }

  const path = require('path');
  const absPath = path.isAbsolute(draftPath) ? draftPath : path.join(contentRepoPath, draftPath);
  const uri = vscode.Uri && vscode.Uri.file ? vscode.Uri.file(absPath) : absPath;
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document);
}

async function writeSnippetToActiveEditor(vscode, { snippet, placement } = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error('Open the target draft before writing the image snippet.');
  }

  const document = editor.document;
  const range = rangeForSnippet(vscode, editor, placement);
  const ok = await editor.edit(editBuilder => {
    if (range) editBuilder.replace(range, snippet);
    else editBuilder.insert(editor.selection.active, snippet);
  });

  if (!ok) throw new Error('VS Code rejected the snippet edit.');
  if (document.save) await document.save();

  return { path: document.uri && document.uri.fsPath };
}

function rangeForSnippet(vscode, editor, placement = {}) {
  const document = editor.document;
  if (placement.snippet) {
    const existing = document.getText().indexOf(placement.snippet);
    if (existing >= 0) {
      return new vscode.Range(
        document.positionAt(existing),
        document.positionAt(existing + placement.snippet.length)
      );
    }
  }

  if (editor.selection && !editor.selection.isEmpty) return editor.selection;

  const location = placement.draftLocation;
  const lineStart = Number.isInteger(location && location.lineStart) ? location.lineStart : null;
  const lineEnd = Number.isInteger(location && location.lineEnd) ? location.lineEnd : lineStart;
  if (lineStart !== null && document.lineAt) {
    return new vscode.Range(
      new vscode.Position(lineStart, 0),
      document.lineAt(lineEnd).range.end
    );
  }

  return null;
}

function hasPlacementLedgerMethods(ledgerWriter) {
  return [
    'listPlannedPlacements',
    'markSagaStep',
    'markAssetPublishing',
    'markPlacementPublishing',
    'updateAssetPublication',
    'updatePlacementSnippet',
    'markPlaced',
    'markFailed'
  ].every(name => ledgerWriter && typeof ledgerWriter[name] === 'function');
}

module.exports = {
  registerExecutePlannedPlacementCommand,
  executePlannedPlacementRun,
  prepareDraftEditor,
  writeSnippetToActiveEditor,
  rangeForSnippet,
  hasPlacementLedgerMethods
};
