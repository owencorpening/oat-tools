'use strict';

const { callClaudeCli } = require('./claudeCliClient');
const { findQuoteRange } = require('./findQuoteRange');
const { resolvePullquoteSopPath } = require('./pullquoteSop');

const USER_PROMPT_HEADER = `Scan the article excerpt below for the single next best pullquote candidate, per the SOP above. Start scanning from the beginning of the excerpt and return only the strongest candidate you find — do not return more than one, even if several qualify.

Respond with ONLY a JSON object, no prose before or after it and no markdown code fence, in exactly this shape:
{"quote": "<verbatim text span, copied exactly as it appears below>", "type": "thesis|mechanism|number|reversal", "why": "<one line, per the SOP's output format>"}

If nothing in this excerpt qualifies, respond with exactly:
{"quote": null}

--- ARTICLE EXCERPT START ---
`;

const USER_PROMPT_FOOTER = `
--- ARTICLE EXCERPT END ---`;

function registerPullquoteCommands(context, vscode, options = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatImages.findNextPullquote', () =>
      findNextPullquote({ vscode, ...options })
    ),
    vscode.commands.registerCommand('oatImages.insertPullquote', () =>
      insertPullquote({ vscode, ...options })
    ),
    vscode.commands.registerCommand('oatImages.insertPullquoteAndContinue', () =>
      insertPullquoteAndContinue({ vscode, ...options })
    )
  );
}

// Scans from the current cursor position forward and, on a hit, sets the
// editor selection to the candidate's exact span with the active (cursor)
// position at the span's end. That's what lets a plain re-run of this same
// command — after a skip, or chained from insertPullquoteAndContinue — pick
// up past the last candidate with no separate scan-position bookkeeping.
async function findNextPullquote({
  vscode,
  callClaudeCliFn = callClaudeCli,
  resolveSopPath = resolvePullquoteSopPath,
  findRange = findQuoteRange
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

  const config = vscode.workspace.getConfiguration('oatImages');
  const model = config.get('pullquoteModel', 'claude-sonnet-5');
  const cliBin = config.get('claudeCliPath', 'claude');
  const windowChars = config.get('pullquoteScanWindowChars', 8000);

  let systemPromptFile;
  try {
    systemPromptFile = resolveSopPath(vscode);
  } catch (err) {
    vscode.window.showErrorMessage(`OAT: ${err.message}`);
    return null;
  }

  const fullText = editor.document.getText();
  const fromOffset = editor.document.offsetAt(editor.selection.active);
  const excerpt = fullText.slice(fromOffset, fromOffset + windowChars);
  if (!excerpt.trim()) {
    vscode.window.showInformationMessage('OAT: Nothing left to scan from the cursor position.');
    return null;
  }

  const userText = `${USER_PROMPT_HEADER}${excerpt}${USER_PROMPT_FOOTER}`;

  let responseText;
  try {
    responseText = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'OAT: Scanning for next pullquote', cancellable: false },
      () => callClaudeCliFn({ model, systemPromptFile, userText, cliBin })
    );
  } catch (err) {
    vscode.window.showErrorMessage(`OAT: Pullquote scan failed — ${err.message}`);
    return null;
  }

  const parsed = parseCandidateResponse(responseText);
  if (!parsed) {
    vscode.window.showErrorMessage(`OAT: Could not parse model response as a pullquote candidate: ${String(responseText).slice(0, 200)}`);
    return null;
  }
  if (!parsed.quote) {
    vscode.window.showInformationMessage('OAT: No pullquote candidate found in the remaining text.');
    return null;
  }

  const range = findRange(fullText, parsed.quote, fromOffset);
  if (!range) {
    vscode.window.showErrorMessage(`OAT: Model returned a quote not found verbatim in the document: "${parsed.quote}"`);
    return null;
  }

  const startPos = editor.document.positionAt(range.start);
  const endPos = editor.document.positionAt(range.end);
  editor.selection = new vscode.Selection(startPos, endPos);
  editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  vscode.window.showInformationMessage(`OAT: Pullquote candidate (${parsed.type || 'unlabeled'}) — ${parsed.why || ''}`);

  return { ...parsed, range };
}

// Delegates rendering/insertion to table-tools' own promoteSelection command
// rather than reimplementing it — see sop-blockquote-image.md for that
// command's styling and embed behavior.
async function insertPullquote({ vscode, executeCommand } = {}) {
  const exec = executeCommand || ((...args) => vscode.commands.executeCommand(...args));
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return false;
  }
  if (editor.selection.isEmpty) {
    vscode.window.showErrorMessage('OAT: No pullquote selected — run "Find Next Pullquote" first or select text manually.');
    return false;
  }

  const preSelection = editor.selection;
  try {
    await exec('oatTables.promotePullquote');
  } catch (err) {
    vscode.window.showErrorMessage(
      `OAT: Could not run table-tools' pullquote command — is the OAT Table Tools extension installed and enabled? (${err.message})`
    );
    return false;
  }

  // table-tools inserts the rendered embed after the quote's paragraph, so
  // the original selection is still valid — restore it explicitly so the
  // cursor doesn't drift even if that insertion point ever changes.
  editor.selection = preSelection;
  return true;
}

async function insertPullquoteAndContinue(options = {}) {
  const inserted = await insertPullquote(options);
  if (!inserted) return null;
  return findNextPullquote(options);
}

function parseCandidateResponse(responseText) {
  const jsonText = extractJson(responseText);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed.quote === null || parsed.quote === undefined) return { quote: null };
    if (typeof parsed.quote !== 'string') return null;
    return { quote: parsed.quote, type: parsed.type, why: parsed.why };
  } catch {
    return null;
  }
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  return candidate.slice(firstBrace, lastBrace + 1);
}

module.exports = {
  registerPullquoteCommands,
  findNextPullquote,
  insertPullquote,
  insertPullquoteAndContinue,
  parseCandidateResponse,
  extractJson
};
