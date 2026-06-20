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

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('oatTables.promoteAllTables', promoteAllTables),
    vscode.commands.registerCommand('oatTables.repairFigures', repairFigures)
  );
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

          const embed =
            `<figure>\n` +
            `  <img width="${imageWidth}" src="${pngUrl}" alt="${descriptor} data table">\n` +
            `  <figcaption><a href="${sheetUrl}">View full data table</a></figcaption>\n` +
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

  const text = editor.document.getText();
  const lines = text.split('\n');
  const figures = findFigures(lines);

  if (figures.length === 0) {
    vscode.window.showInformationMessage('OAT: No figures found.');
    return;
  }

  const repairs = computeRepairs(lines);

  if (repairs.length === 0) {
    vscode.window.showInformationMessage('OAT: All figures are properly formatted.');
    return;
  }

  // Apply repairs in reverse order to preserve line indices
  repairs.reverse();
  const succeeded = await editor.edit(editBuilder => {
    for (const repair of repairs) {
      const line = new vscode.Position(repair.lineIdx, 0);
      const endOfLine = new vscode.Position(repair.lineIdx, repair.oldLine.length);
      editBuilder.replace(new vscode.Range(line, endOfLine), repair.newLine);
    }
  });

  if (succeeded) {
    vscode.window.showInformationMessage(
      `OAT: ${repairs.length} figure${repairs.length === 1 ? '' : 's'} repaired and renumbered.`
    );
  } else {
    vscode.window.showErrorMessage('OAT: Repair failed — document may have changed.');
  }
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
    || path.join(os.homedir(), 'dev', 'images');
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
  th{background:#005f73;color:#fff;font-size:16px;font-weight:bold;padding:0 12px;height:40px;vertical-align:middle;text-align:left;border-right:1px solid #94d2bd;white-space:nowrap;}
  th:last-child{border-right:none;}
  thead tr{border-bottom:2px solid #94d2bd;}
  td{font-size:15px;padding:0 12px;min-height:40px;vertical-align:top;border-right:1px solid #94d2bd;color:#000;word-wrap:break-word;}
  td:last-child{border-right:none;}
  tr.even td{background:#f0f7f8;}
  tr.odd td{background:#fff;}
  tr.total td{font-weight:bold;background:#e8f4f5;border-top:2px solid #94d2bd;}
</style></head>
<body><div class="table-frame"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div></body></html>`;
}

async function renderLocalPng(title, headers, rows, partNum, series, imageWidth) {
  const html = renderOatHtml(headers, rows);
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
  const screenshotOutput = await execFile('bash', [script, tmpHtml, outPng, String(imageWidth)]);
  const renderedWidth = parseRenderedWidth(screenshotOutput) || imageWidth;

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
