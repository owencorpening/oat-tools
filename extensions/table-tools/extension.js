'use strict';
const vscode = require('vscode');
const https = require('https');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTables } = require('./lib/parseTables');
const { estimateTableImageWidth } = require('./lib/tableImageWidth');
const { findFigures, extractSheetUrl, computeRepairs } = require('./lib/figureRepair');
const { parseBlockquotes } = require('./lib/parseBlockquotes');
const { findQuoteRange } = require('./lib/findQuoteRange');

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatTables.promoteAllTables', promoteAllTables),
    vscode.commands.registerCommand('oatTables.repairFigures', repairFigures),
    vscode.commands.registerCommand('oatTables.promotePullquote', promotePullquote),
    vscode.commands.registerCommand('oatTables.promoteAllPullquotes', promoteAllPullquotes),
    vscode.commands.registerCommand('oatTables.jumpToPullquoteSource', jumpToPullquoteSource)
  );

  return {
    extendMarkdownIt(md) {
      return md.use(require('./lib/pullquoteMarkdownItPlugin'));
    }
  };
}

// ── Promote All Tables ───────────────────────────────────────────────────────

async function promoteAllTables() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return;
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return;
  }

  const workerUrl = getSetting('workerUrl', '');
  if (!workerUrl) {
    vscode.window.showErrorMessage(
      'OAT Tables: Worker URL not set. Add oatTables.workerUrl to VS Code settings.'
    );
    return;
  }

  const partNum = await vscode.window.showInputBox({
    prompt: 'Part number (e.g. 09)',
    placeHolder: '09',
    validateInput: v => v && v.trim() ? null : 'Part number is required'
  });
  if (!partNum) return;

  const series = await vscode.window.showInputBox({
    prompt: 'Series slug',
    placeHolder: 'water-series',
    value: 'water-series',
    validateInput: v => v && v.trim() ? null : 'Series is required'
  });
  if (series === undefined) return;

  const text = editor.document.getText();
  const tables = parseTables(text);

  if (tables.length === 0) {
    vscode.window.showInformationMessage('OAT: No markdown tables found in document.');
    return;
  }

  const replacements = [];
  const descriptorCount = {};

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `OAT: Promoting ${tables.length} table${tables.length === 1 ? '' : 's'}`,
      cancellable: false
    },
    async progress => {
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        progress.report({
          message: `${i + 1}/${tables.length} — ${table.headers[0]}`,
          increment: (100 / tables.length)
        });

        let descriptor = generateDescriptor(table.headers);
        descriptorCount[descriptor] = (descriptorCount[descriptor] || 0) + 1;
        if (descriptorCount[descriptor] > 1) {
          descriptor = descriptor + descriptorCount[descriptor];
        }

        const title = `part${partNum.trim()}-table-${descriptor}`;

        try {
          const { spreadsheetId, sheetUrl } = await callWorker(workerUrl, {
            title,
            headers: table.headers,
            rows: table.rows
          });

          const fallbackImageWidth = estimateTableImageWidth(table.headers, table.rows);
          const { pngUrl, imageWidth } = await renderLocalPng(
            title, table.headers, table.rows,
            partNum.trim(), series.trim(), fallbackImageWidth
          );

          const caption = inferTableCaption(table.headers);
          const embed =
            `<figure>\n` +
            `  <img width="${imageWidth}" src="${pngUrl}" alt="${descriptor} data table">\n` +
            `  <figcaption>Figure — ${escapeHtml(caption)}<br><a href="${sheetUrl}">View full data table</a></figcaption>\n` +
            `</figure>`;

          replacements.push({ startLine: table.startLine, endLine: table.endLine, embed });
        } catch (err) {
          vscode.window.showWarningMessage(`OAT: Table ${i + 1} (${descriptor}) failed — ${err.message}`);
        }
      }
    }
  );

  if (replacements.length === 0) {
    vscode.window.showErrorMessage('OAT: All table promotions failed. Check token and API access.');
    return;
  }

  replacements.sort((a, b) => b.startLine - a.startLine);

  const succeeded = await editor.edit(editBuilder => {
    for (const r of replacements) {
      const start = new vscode.Position(r.startLine, 0);
      const end   = new vscode.Position(r.endLine + 1, 0);
      editBuilder.replace(new vscode.Range(start, end), r.embed + '\n');
    }
  });

  if (succeeded) {
    await applyFigureRepairs(editor);
    await editor.document.save();
    vscode.window.showInformationMessage(
      `OAT: ${replacements.length}/${tables.length} table${replacements.length === 1 ? '' : 's'} promoted.`
    );
  } else {
    vscode.window.showErrorMessage('OAT: Edit failed — document may have changed during processing.');
  }
}

function generateDescriptor(headers) {
  const raw = headers[0].replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'table';
  return words
    .map((w, i) => i === 0
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join('');
}

// Brief, structurally-derived caption — never fabricates an interpretation of
// the data, just names the columns, so it's always safe to auto-insert.
function inferTableCaption(headers) {
  if (headers.length <= 1) return headers[0] || 'Data table';
  return `${headers[0]} vs. ${headers[headers.length - 1]}`;
}

// ── Repair Figures ───────────────────────────────────────────────────────────

async function repairFigures() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return;
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return;
  }

  const figures = findFigures(editor.document.getText().split('\n'));
  if (figures.length === 0) {
    vscode.window.showInformationMessage('OAT: No figures found.');
    return;
  }

  const repaired = await applyFigureRepairs(editor);

  if (repaired === 0) {
    vscode.window.showInformationMessage('OAT: All figures are properly formatted.');
  } else if (repaired === null) {
    vscode.window.showErrorMessage('OAT: Repair failed — document may have changed.');
  } else {
    vscode.window.showInformationMessage(
      `OAT: ${repaired} figure${repaired === 1 ? '' : 's'} repaired and renumbered.`
    );
  }
}

// Renumbers every <figure> in the document sequentially and fills in any
// missing "Figure N —" prefix. Returns the repair count, or null on edit
// failure (document changed mid-operation). Shared by repairFigures and by
// promoteAllTables, which auto-runs this after inserting new table figures.
async function applyFigureRepairs(editor) {
  const lines = editor.document.getText().split('\n');
  const repairs = computeRepairs(lines);
  if (repairs.length === 0) return 0;

  repairs.reverse();
  const succeeded = await editor.edit(editBuilder => {
    for (const repair of repairs) {
      const line = new vscode.Position(repair.lineIdx, 0);
      const endOfLine = new vscode.Position(repair.lineIdx, repair.oldLine.length);
      editBuilder.replace(new vscode.Range(line, endOfLine), repair.newLine);
    }
  });

  return succeeded ? repairs.length : null;
}

// ── Cloudflare Worker call ────────────────────────────────────────────────────

function callWorker(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.error) reject(new Error(r.error));
          else if (!r.spreadsheetId) reject(new Error(`Unexpected Worker response: ${data}`));
          else resolve(r);
        } catch {
          reject(new Error(`Worker returned non-JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Worker request timeout (30s)')));
    req.write(body);
    req.end();
  });
}

// ── Local render pipeline ────────────────────────────────────────────────────

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    cp.execFile(command, args, options, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || '').trim() || err.message));
      else resolve(stdout);
    });
  });
}

function imagesRepoPath() {
  return getSetting('imagesRepoPath', '')
    || path.join(os.homedir(), 'dev', 'oat-assets');
}

function puppeteerDir() {
  return getSetting('puppeteerDir', '')
    || path.join(os.homedir(), 'dev', 'oat-tools', 'extensions', 'table-tools');
}

function screenshotScriptPath() {
  const configured = getSetting('screenshotScriptPath', '');
  if (configured) return configured;

  const localScript = path.join(__dirname, 'scripts', 'screenshot-html.sh');
  if (fs.existsSync(localScript)) return localScript;

  return path.join(os.homedir(), 'dev', 'wraith', 'scripts', 'screenshot-html.sh');
}

function getSetting(key, defaultValue) {
  const tableValue = vscode.workspace.getConfiguration('oatTables').get(key, undefined);
  if (tableValue !== undefined && tableValue !== '') return tableValue;
  return vscode.workspace.getConfiguration('oat').get(key, defaultValue);
}

function escapeHtml(s) {
  return String(s)
    .replace(/\\(.)/g, '$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderOatHtml(headers, rows) {
  const ths = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const trs = rows.map((row, i) => {
    const isLast = i === rows.length - 1;
    const cls = isLast ? 'total' : (i % 2 === 0 ? 'even' : 'odd');
    const tds = headers.map((_, j) => `<td>${escapeHtml(row[j] ?? '')}</td>`).join('');
    return `<tr class="${cls}">${tds}</tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{margin:0;background:transparent;font-family:Arial,sans-serif;}
  .table-frame{display:inline-block;padding:16px;background:#fff;}
  table{border-collapse:collapse;width:max-content;}
  th{background:#005f73;color:#fff;font-size:16px;font-weight:bold;padding:10px 14px;vertical-align:middle;text-align:left;border-right:1px solid #94d2bd;white-space:nowrap;}
  th:last-child{border-right:none;}
  thead tr{border-bottom:2px solid #94d2bd;}
  td{font-size:15px;padding:9px 14px;vertical-align:top;border-right:1px solid #94d2bd;color:#000;word-wrap:break-word;}
  td:last-child{border-right:none;}
  tr.even td{background:#f0f7f8;}
  tr.odd td{background:#fff;}
  tr.total td{font-weight:bold;background:#e8f4f5;border-top:2px solid #94d2bd;}
</style></head>
<body><div class="table-frame"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div></body></html>`;
}

// ── Promote Pullquote ────────────────────────────────────────────────────────

async function promotePullquote() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return;
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage('OAT: Select the quote text first.');
    return;
  }

  const rawText = editor.document.getText(selection);
  const text = cleanQuoteText(rawText);
  if (!text) {
    vscode.window.showErrorMessage('OAT: Selection has no text after removing blockquote markers.');
    return;
  }
  if (isLongForPullquote(text)) {
    vscode.window.showWarningMessage(
      `OAT: Selection is long for a pullquote (${LONG_QUOTE_WORD_THRESHOLD}+ words) — promoting anyway.`
    );
  }

  const partNum = await vscode.window.showInputBox({
    prompt: 'Part number (e.g. 09)',
    placeHolder: '09',
    validateInput: v => v && v.trim() ? null : 'Part number is required'
  });
  if (!partNum) return;

  const series = await vscode.window.showInputBox({
    prompt: 'Series slug',
    placeHolder: 'water-series',
    value: 'water-series',
    validateInput: v => v && v.trim() ? null : 'Series is required'
  });
  if (series === undefined) return;

  const descriptor = generateQuoteDescriptor(text);
  const title = `part${partNum.trim()}-pullquote-${descriptor}`;

  try {
    const { pngUrl } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'OAT: Rendering pullquote', cancellable: false },
      () => renderAndPushPng(renderPullquoteHtml(text), title, partNum.trim(), series.trim(), 900, '.pullquote-frame')
    );

    const embed = `<img class="oat-pullquote" src="${pngUrl}" width="900" alt="${escapeHtml(text)}">`;
    const insertLine = findParagraphEndLine(editor.document, selection.end.line);
    const insertPos = editor.document.lineAt(insertLine).range.end;

    const succeeded = await editor.edit(editBuilder => {
      editBuilder.insert(insertPos, `\n\n${embed}`);
    });

    if (succeeded) {
      await editor.document.save();
      vscode.window.showInformationMessage('OAT: Pullquote promoted.');
    } else {
      vscode.window.showErrorMessage('OAT: Edit failed — document may have changed during processing.');
    }
  } catch (err) {
    vscode.window.showErrorMessage(`OAT: Pullquote promotion failed — ${err.message}`);
  }
}

// Returns the last line of the paragraph (contiguous non-blank lines)
// containing/starting at startLine, so the pullquote can be inserted after
// the paragraph without disturbing the original text.
function findParagraphEndLine(document, startLine) {
  let line = startLine;
  while (line + 1 < document.lineCount && document.lineAt(line + 1).text.trim() !== '') {
    line++;
  }
  return line;
}

// Invoked from a command: link clicked on a pullquote image in the Markdown
// preview (see lib/pullquoteMarkdownItPlugin.js). Finds the quote in whichever
// open markdown document contains it, selects it, and copies it to the
// clipboard so the click feels like selecting the text directly off the image.
async function jumpToPullquoteSource(quoteText) {
  if (!quoteText) return;

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== 'markdown') continue;

    const range = findQuoteRange(document.getText(), quoteText);
    if (!range) continue;

    const startPos = document.positionAt(range.start);
    const endPos = document.positionAt(range.end);

    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(startPos, endPos)
    });
    await vscode.env.clipboard.writeText(document.getText(new vscode.Range(startPos, endPos)));
    return;
  }

  vscode.window.showWarningMessage('OAT: Could not find that pullquote\'s source text in an open document.');
}

// ── Promote All Pullquotes ───────────────────────────────────────────────────

async function promoteAllPullquotes() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('OAT: No active editor.');
    return;
  }
  if (editor.document.languageId !== 'markdown') {
    vscode.window.showErrorMessage('OAT: Active file must be a markdown document.');
    return;
  }

  const partNum = await vscode.window.showInputBox({
    prompt: 'Part number (e.g. 09)',
    placeHolder: '09',
    validateInput: v => v && v.trim() ? null : 'Part number is required'
  });
  if (!partNum) return;

  const series = await vscode.window.showInputBox({
    prompt: 'Series slug',
    placeHolder: 'water-series',
    value: 'water-series',
    validateInput: v => v && v.trim() ? null : 'Series is required'
  });
  if (series === undefined) return;

  const text = editor.document.getText();
  const allQuotes = parseBlockquotes(text);

  if (allQuotes.length === 0) {
    vscode.window.showInformationMessage('OAT: No blockquotes found in document.');
    return;
  }

  const quotes = allQuotes.filter(q => !q.skipReason);
  const skipped = allQuotes.filter(q => q.skipReason);

  if (skipped.length > 0) {
    vscode.window.showWarningMessage(
      `OAT: Skipped ${skipped.length} blockquote${skipped.length === 1 ? '' : 's'} that ` +
      `${skipped.length === 1 ? 'reads' : 'read'} as a structural callout, not a pullquote ` +
      `(${skipped.map(q => q.skipReason).join(', ')}) — promote ${skipped.length === 1 ? 'it' : 'them'} individually if intended.`
    );
  }

  if (quotes.length === 0) {
    vscode.window.showInformationMessage('OAT: No promotable pullquotes found (all blockquotes were structural).');
    return;
  }

  const replacements = [];
  const descriptorCount = {};
  const longQuotes = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `OAT: Promoting ${quotes.length} pullquote${quotes.length === 1 ? '' : 's'}`,
      cancellable: false
    },
    async progress => {
      for (let i = 0; i < quotes.length; i++) {
        const quote = quotes[i];
        progress.report({
          message: `${i + 1}/${quotes.length} — ${quote.text.slice(0, 40)}`,
          increment: 100 / quotes.length
        });

        if (isLongForPullquote(quote.text)) longQuotes.push(quote.text);

        let descriptor = generateQuoteDescriptor(quote.text);
        descriptorCount[descriptor] = (descriptorCount[descriptor] || 0) + 1;
        if (descriptorCount[descriptor] > 1) {
          descriptor = descriptor + descriptorCount[descriptor];
        }

        const title = `part${partNum.trim()}-pullquote-${descriptor}`;

        try {
          const { pngUrl } = await renderAndPushPng(
            renderPullquoteHtml(quote.text), title, partNum.trim(), series.trim(), 900, '.pullquote-frame'
          );
          const embed = `<img class="oat-pullquote" src="${pngUrl}" width="900" alt="${escapeHtml(quote.text)}">`;
          replacements.push({ endLine: quote.endLine, embed });
        } catch (err) {
          vscode.window.showWarningMessage(`OAT: Pullquote ${i + 1} failed — ${err.message}`);
        }
      }
    }
  );

  if (replacements.length === 0) {
    vscode.window.showErrorMessage('OAT: All pullquote promotions failed. Check images repo access.');
    return;
  }

  replacements.sort((a, b) => b.endLine - a.endLine);

  const succeeded = await editor.edit(editBuilder => {
    for (const r of replacements) {
      const insertPos = editor.document.lineAt(r.endLine).range.end;
      editBuilder.insert(insertPos, `\n\n${r.embed}`);
    }
  });

  if (succeeded) {
    await editor.document.save();
    vscode.window.showInformationMessage(
      `OAT: ${replacements.length}/${quotes.length} pullquote${replacements.length === 1 ? '' : 's'} promoted.`
    );
    if (longQuotes.length > 0) {
      vscode.window.showWarningMessage(
        `OAT: ${longQuotes.length} promoted quote${longQuotes.length === 1 ? ' is' : 's are'} long for a ` +
        `pullquote (${LONG_QUOTE_WORD_THRESHOLD}+ words) — worth checking it reads well as an image.`
      );
    }
  } else {
    vscode.window.showErrorMessage('OAT: Edit failed — document may have changed during processing.');
  }
}

const LONG_QUOTE_WORD_THRESHOLD = 60;

function isLongForPullquote(text) {
  return text.trim().split(/\s+/).filter(Boolean).length > LONG_QUOTE_WORD_THRESHOLD;
}

function cleanQuoteText(raw) {
  return raw
    .split('\n')
    .map(line => line.replace(/^\s*>\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .trim();
}

function generateQuoteDescriptor(text) {
  const words = text
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  if (words.length === 0) return 'quote';
  return words
    .map((w, i) => i === 0
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join('');
}

function renderPullquoteHtml(text) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{margin:0;background:transparent;font-family:Arial,'Helvetica Neue',sans-serif;}
  .pullquote-frame{
    display:inline-block;
    box-sizing:border-box;
    background:#d2e8ee;
    border-left:8px solid #005f73;
    padding:10px 40px 8px 36px;
    position:relative;
  }
  .quote-line{
    display:flex;
    align-items:baseline;
    white-space:nowrap;
  }
  .quote-open{
    font-size:48px;
    font-weight:bold;
    color:#005f73;
    line-height:0.8;
    align-self:flex-start;
    margin-right:6px;
    font-family:Georgia,'Times New Roman',serif;
  }
  .quote-text{
    font-size:24px;
    font-style:italic;
    color:#003366;
    line-height:1.15;
    margin:0;
  }
  .quote-close{
    font-size:20px;
    font-weight:bold;
    color:#005f73;
    margin-left:4px;
    font-family:Georgia,'Times New Roman',serif;
  }
  .watermark{
    margin-top:4px;
    text-align:right;
    font-size:11px;
    color:#5a7a8f;
  }
</style></head>
<body>
<div class="pullquote-frame">
  <div class="quote-line">
    <span class="quote-open">&ldquo;</span><span class="quote-text">${escapeHtml(text)}</span><span class="quote-close">&rdquo;</span>
  </div>
  <div class="watermark">owencorpening.substack.com</div>
</div>
</body></html>`;
}

async function renderLocalPng(title, headers, rows, partNum, series, imageWidth) {
  const html = renderOatHtml(headers, rows);
  return renderAndPushPng(html, title, partNum, series, imageWidth, '.table-frame');
}

async function renderAndPushPng(html, title, partNum, series, initialWidth, selector) {
  const tmpHtml = path.join(os.tmpdir(), `${title}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const imagesRepo = imagesRepoPath();
  const outDir = path.join(imagesRepo, 'generated', series, `part-${partNum}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outPng = path.join(outDir, `${title}.png`);

  const script = screenshotScriptPath();
  if (!fs.existsSync(script)) {
    throw new Error(`Screenshot script not found: ${script}`);
  }
  const screenshotOutput = await execFile('bash', [script, tmpHtml, outPng, String(initialWidth), selector], {
    env: { ...process.env, PUPPETEER_DIR: puppeteerDir() }
  });
  const renderedWidth = parseRenderedWidth(screenshotOutput) || initialWidth;

  const relPath = `generated/${series}/part-${partNum}/${title}.png`;
  await execFile('git', ['-C', imagesRepo, 'add', relPath]);
  try {
    await execFile('git', ['-C', imagesRepo, 'commit', '-m', `Add ${title}.png`]);
  } catch (e) {
    if (!e.message.includes('nothing to commit')) throw e;
  }
  // Do not block the markdown rewrite if the images repo push is temporarily unavailable.
  try {
    await execFile('git', ['-C', imagesRepo, 'push']);
  } catch (e) {
    vscode.window.showWarningMessage(
      `OAT Tables: Created ${title}.png locally, but could not push it to the images repo: ${e.message}`
    );
  }

  return {
    pngUrl: `https://raw.githubusercontent.com/owencorpening/images/main/${relPath}`,
    imageWidth: renderedWidth
  };
}

function parseRenderedWidth(output) {
  const text = String(output || '').trim();
  const jsonLine = text.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{'));
  if (!jsonLine) return null;

  try {
    const parsed = JSON.parse(jsonLine);
    const width = Number(parsed.width);
    return Number.isFinite(width) && width > 0 ? Math.ceil(width) : null;
  } catch {
    return null;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
