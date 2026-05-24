'use strict';
const vscode = require('vscode');
const https = require('https');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTables } = require('./lib/parseTables');
const { ImagePanelProvider } = require('./views/imagePanelProvider');

function activate(context) {
  // Existing command: promote all markdown tables in active document
  context.subscriptions.push(
    vscode.commands.registerCommand('oat.promoteAllTables', promoteAllTables)
  );

  // Image staging panel
  const imagePanel = new ImagePanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ImagePanelProvider.viewId, imagePanel)
  );

  // Manual refresh command (e.g. from command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('oat.refreshImagePanel', () => imagePanel.refresh())
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

  const gasUrl = vscode.workspace.getConfiguration('oat').get('gasWebAppUrl', '');
  if (!gasUrl) {
    vscode.window.showErrorMessage(
      'OAT: GAS web app URL not set. Add oat.gasWebAppUrl to VS Code settings.'
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
          const { spreadsheetId, sheetUrl } = await callGas(gasUrl, {
            title,
            headers: table.headers,
            rows: table.rows
          });

          const pngUrl = await renderLocalPng(
            title, table.headers, table.rows,
            partNum.trim(), series.trim()
          );
          const imgWidth = Math.max(400, table.headers.length * 140);

          const embed =
            `<figure>\n` +
            `  <img width="${imgWidth}" src="${pngUrl}" alt="${descriptor} data table">\n` +
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

// ── GAS web app call ─────────────────────────────────────────────────────────

function callGas(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    function doRequest(opts, postBody) {
      const req = https.request({ ...opts, timeout: 30000 }, res => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          // GAS redirects the POST to an echo endpoint that only accepts GET
          const loc = new URL(res.headers.location);
          return doRequest({
            hostname: loc.hostname,
            path: loc.pathname + loc.search,
            method: 'GET',
            headers: {}
          }, null);
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const r = JSON.parse(data);
            if (r.error) reject(new Error(r.error));
            else if (!r.spreadsheetId) reject(new Error(`Unexpected GAS response: ${data}`));
            else resolve(r);
          } catch {
            reject(new Error(`GAS returned non-JSON: ${data.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('GAS request timeout (30s)')));
      if (postBody) req.write(postBody);
      req.end();
    }

    doRequest(options, body);
  });
}

// ── Local render pipeline ────────────────────────────────────────────────────

function execCmd(cmd) {
  return new Promise((resolve, reject) => {
    cp.exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
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
  body{margin:0;padding:16px;background:#fff;font-family:Arial,sans-serif;}
  table{border-collapse:collapse;width:100%;}
  th{background:#005f73;color:#fff;font-size:14px;font-weight:bold;padding:0 16px;height:48px;vertical-align:middle;text-align:left;border-right:1px solid #94d2bd;white-space:nowrap;}
  th:last-child{border-right:none;}
  thead tr{border-bottom:2px solid #94d2bd;}
  td{font-size:13px;padding:0 16px;height:48px;vertical-align:middle;border-right:1px solid #94d2bd;color:#000;white-space:nowrap;}
  td:last-child{border-right:none;}
  tr.even td{background:#f0f7f8;}
  tr.odd td{background:#fff;}
  tr.total td{font-weight:bold;background:#e8f4f5;border-top:2px solid #94d2bd;}
</style></head>
<body><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}

async function renderLocalPng(title, headers, rows, partNum, series) {
  const html = renderOatHtml(headers, rows);
  const tmpHtml = path.join(os.tmpdir(), `${title}.html`);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const imagesRepo = path.join(os.homedir(), 'dev', 'images');
  const outDir = path.join(imagesRepo, 'generated', series, `part-${partNum}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outPng = path.join(outDir, `${title}.png`);

  const script = path.join(os.homedir(), 'dev', 'wraith', 'scripts', 'screenshot-html.sh');
  await execCmd(`bash "${script}" "${tmpHtml}" "${outPng}" 700`);

  const relPath = `generated/${series}/part-${partNum}/${title}.png`;
  await execCmd(`git -C "${imagesRepo}" add "${relPath}"`);
  try {
    await execCmd(`git -C "${imagesRepo}" commit -m "Add ${title}.png"`);
    await execCmd(`git -C "${imagesRepo}" push`);
  } catch (e) {
    if (!e.message.includes('nothing to commit')) throw e;
  }

  return `https://raw.githubusercontent.com/owencorpening/images/main/${relPath}`;
}

function deactivate() {}

module.exports = { activate, deactivate };
