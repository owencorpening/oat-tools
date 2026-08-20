'use strict';

const assert = require('assert');
const { flagImage } = require('../lib/draftsmanFlagCommand');

function fakeDocument(text, languageId = 'markdown') {
  const lines = text.split('\n');
  return {
    languageId,
    saved: false,
    getText: () => lines.join('\n'),
    lineAt: line => ({
      range: { end: { line, character: lines[line].length } }
    }),
    save: async function save() { this.saved = true; }
  };
}

function fakeEditor(text, cursorLine, languageId = 'markdown') {
  const document = fakeDocument(text, languageId);
  const edits = [];
  return {
    document,
    selection: { active: { line: cursorLine } },
    edit: async editFn => {
      const editBuilder = {
        insert: (position, newText) => edits.push({ position, newText })
      };
      editFn(editBuilder);
      // Apply the recorded edit(s) to the fake document's text so
      // subsequent getText() calls (and assertions) see the result.
      for (const { position, newText } of edits) {
        const docLines = document.getText().split('\n');
        const targetLine = docLines[position.line];
        docLines[position.line] =
          targetLine.slice(0, position.character) + newText + targetLine.slice(position.character);
        document.getText = () => docLines.join('\n');
        document.lineAt = line => ({
          range: { end: { line, character: docLines[line].length } }
        });
      }
      return true;
    }
  };
}

function fakeVscodeWithEditor(editor) {
  const errors = [];
  return {
    window: {
      activeTextEditor: editor,
      showErrorMessage: message => errors.push(message)
    },
    _errors: errors
  };
}

async function testInsertsPlaceholderWithRealCapturedContext() {
  const doc = [
    'This is a real paragraph the author is reading.',
    'It has two lines of actual prose.',
    '',
    'A second, unrelated paragraph.'
  ].join('\n');
  const editor = fakeEditor(doc, 1); // cursor on the second line of the first paragraph
  const vscode = fakeVscodeWithEditor(editor);

  const ok = await flagImage({ vscode });
  assert.strictEqual(ok, true);

  const resultText = editor.document.getText();
  assert.strictEqual(
    resultText.includes('![TODO:IMG "This is a real paragraph the author is reading. It has two lines of actual prose."](.draftsman/placeholder-image-needed.png)'),
    true,
    `expected real captured context in the inserted line, got:\n${resultText}`
  );
  assert.strictEqual(editor.document.saved, true);
}

async function testDoesNotInsertEmptyOrWrongContext() {
  const doc = 'Only paragraph in the whole document.';
  const editor = fakeEditor(doc, 0);
  const vscode = fakeVscodeWithEditor(editor);

  await flagImage({ vscode });

  const resultText = editor.document.getText();
  assert.strictEqual(resultText.includes('![TODO:IMG ""]'), false, 'should not insert an empty context snippet when real context exists');
  assert.strictEqual(resultText.includes('Only paragraph in the whole document.'), true);
}

async function testNoActiveEditorShowsError() {
  const vscode = fakeVscodeWithEditor(null);
  const ok = await flagImage({ vscode });
  assert.strictEqual(ok, false);
  assert.strictEqual(vscode._errors.length, 1);
}

async function testNonMarkdownDocumentShowsError() {
  const editor = fakeEditor('some text', 0, 'plaintext');
  const vscode = fakeVscodeWithEditor(editor);
  const ok = await flagImage({ vscode });
  assert.strictEqual(ok, false);
  assert.strictEqual(vscode._errors.length, 1);
}

(async () => {
  await testInsertsPlaceholderWithRealCapturedContext();
  await testDoesNotInsertEmptyOrWrongContext();
  await testNoActiveEditorShowsError();
  await testNonMarkdownDocumentShowsError();
  console.log('draftsmanFlagCommand tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
