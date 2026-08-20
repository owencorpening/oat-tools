'use strict';

const { captureSurroundingParagraph } = require('./draftsmanContext');
const { buildPlaceholderLine } = require('./draftsmanMarker');

function registerDraftsmanFlagCommand(context, vscode, options = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.flagImage', () => flagImage({ vscode, ...options }))
  );
}

// Must stay genuinely fast: no dialogs, no network/ledger call — a single
// local editor.edit() insertion. "Flag and move on," per the SOP's core
// principle; anything that makes the author wait defeats the point.
async function flagImage({
  vscode,
  captureContext = captureSurroundingParagraph,
  buildLine = buildPlaceholderLine
} = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return false;
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return false;
  }

  const cursorLine = editor.selection.active.line;
  const documentText = editor.document.getText();
  const context = captureContext(documentText, cursorLine);
  const placeholderLine = buildLine(context);

  const insertAt = editor.document.lineAt(cursorLine).range.end;
  const ok = await editor.edit(editBuilder => {
    editBuilder.insert(insertAt, `\n\n${placeholderLine}`);
  });

  if (!ok) {
    vscode.window.showErrorMessage('OAT: Draftsman could not insert the placeholder.');
    return false;
  }
  if (editor.document.save) await editor.document.save();
  return true;
}

module.exports = { registerDraftsmanFlagCommand, flagImage };
