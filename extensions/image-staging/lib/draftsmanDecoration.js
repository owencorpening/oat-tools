'use strict';

const { PLACEHOLDER_LINE_RE } = require('./draftsmanMarker');

// First TextEditorDecorationType in this codebase — no existing pattern to
// match, kept deliberately simple: one decoration type, one regex, applied
// to whole placeholder lines only. Resolved images (stock or generated)
// aren't decorated — only unresolved placeholders need visual attention.

function buildDecorationType(vscode) {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(245, 166, 35, 0.25)',
    border: '1px solid #F5A623',
    fontWeight: 'bold',
    isWholeLine: true
  });
}

function findPlaceholderRanges(document, vscode) {
  const lines = document.getText().split(/\r?\n/);
  const ranges = [];
  lines.forEach((line, index) => {
    if (PLACEHOLDER_LINE_RE.test(line)) {
      ranges.push(new vscode.Range(index, 0, index, line.length));
    }
  });
  return ranges;
}

function applyDecorations(editor, decorationType, vscode) {
  if (!editor) return;
  editor.setDecorations(decorationType, findPlaceholderRanges(editor.document, vscode));
}

function registerDraftsmanDecoration(context, vscode) {
  const decorationType = buildDecorationType(vscode);
  context.subscriptions.push(decorationType);

  const refresh = editor => applyDecorations(editor, decorationType, vscode);
  refresh(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => refresh(editor)),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) refresh(editor);
    })
  );
}

module.exports = {
  registerDraftsmanDecoration,
  buildDecorationType,
  findPlaceholderRanges,
  applyDecorations
};
