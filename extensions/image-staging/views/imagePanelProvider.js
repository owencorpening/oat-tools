'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const { getServiceAccountToken } = require('../lib/serviceAccountAuth');
const { getStagedImages, updateRow } = require('../lib/imageStagingSheet');
const { placeImage, discardPlaced } = require('../lib/imageWorkflow');
const { resolveThumbUrl } = require('../lib/thumbResolver');

class ImagePanelProvider {
  static viewId = 'oatImages.panel';

  constructor(context, { ledgerWriter } = {}) {
    this._context = context;
    this._ledgerWriter = ledgerWriter;
    this._view = null;
  }

  // Called by VS Code when the panel becomes visible
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._html(webviewView.webview);

    // Proactive ping — confirms extension→webview channel works
    setTimeout(() => {
      this._send({ type: 'ping' });
    }, 1000);

    webviewView.webview.onDidReceiveMessage(async msg => {
      try {
        switch (msg.type) {
          case 'refresh': return await this._loadStaged();
          case 'place':   return await this._handlePlace(msg.image);
          case 'discard': return await this._handleDiscard(msg.image);
        }
      } catch (err) {
        this._send({ type: 'error', message: err.message });
      }
    }, null, this._context.subscriptions);

    // Webview initiates load by sending { type: 'refresh' } once ready
  }

  refresh() {
    if (this._view) this._loadStaged();
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async _loadStaged() {
    if (this._ledgerWriter && this._ledgerWriter.listStagedAssets) {
      await this._loadD1Staged();
      return;
    }

    await this._loadSheetStaged();
  }

  async _loadD1Staged() {
    try {
      const result = await this._ledgerWriter.listStagedAssets();
      const assets = Array.isArray(result?.assets) ? result.assets : [];
      const images = assets.map(normalizeD1AssetForPanel);
      this._send({ type: 'staged', images, source: 'd1' });
    } catch (err) {
      this._send({ type: 'error', message: err.message });
    }
  }

  async _loadSheetStaged() {
    const sheetId = this._sheetId();
    if (!sheetId) {
      this._send({ type: 'error', message: 'Set oatImages.sheetId in VS Code settings.' });
      return;
    }
    try {
      const unsplashKey = getSetting('unsplashAccessKey', '');
      const token = await getServiceAccountToken({ credentialPath: getSetting('serviceAccountPath', '') });
      const images = await getStagedImages(sheetId, token);
      await Promise.all(images.map(async img => {
        const resolved = await resolveThumbUrl(img.imageSrc, img.url, unsplashKey);
        img.thumbUrl = resolved.thumbUrl;
        if (resolved.url) img.url = resolved.url;
      }));
      this._send({ type: 'staged', images });
    } catch (err) {
      this._send({ type: 'error', message: err.message });
    }
  }

  // ── Place ─────────────────────────────────────────────────────────────────

  async _handlePlace(image) {
    if (image && image.source === 'd1') {
      vscode.window.showInformationMessage('OAT: D1 staged assets are visible; placement saga UI is the next step.');
      return;
    }

    const target = await vscode.window.showQuickPick(
      ['substack', 'carousel', 'linkedin-post'],
      { placeHolder: 'Publishing target' }
    );
    if (!target) return;

    // Auto-detect part number from active editor file path
    const editorPath = vscode.window.activeTextEditor?.document?.uri?.fsPath || '';
    const partMatch  = editorPath.match(/part-(\d+)/i);
    const detectedPart = partMatch ? partMatch[1] : '';

    const partNum = await vscode.window.showInputBox({
      prompt: 'Part number',
      value: detectedPart,
      validateInput: v => v && v.trim() ? null : 'Required'
    });
    if (!partNum) return;

    // Derive slug from image camelCase name → kebab-case
    const derivedSlug = (image.name || '')
      .replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');

    const slug = await vscode.window.showInputBox({
      prompt: 'Image slug',
      value: derivedSlug,
      validateInput: v => v && v.trim() ? null : 'Required'
    });
    if (!slug) return;

    const figNum = await vscode.window.showInputBox({
      prompt: 'Figure number',
      validateInput: v => v && v.trim() ? null : 'Required'
    });
    if (!figNum) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'OAT: Placing image…' },
      async () => {
        await placeImage({ image, target, partNum: partNum.trim(), slug: slug.trim(), figNum: figNum.trim() });
        const sheetId = this._sheetId();
        const token = await getServiceAccountToken({ credentialPath: getSetting('serviceAccountPath', '') });
        const today = new Date().toISOString().slice(0, 10);
        await updateRow(sheetId, image.rowIndex,
          { status: 'placed', placed_in: `part-${partNum.trim()}`, placed_date: today, target },
          token
        );
      }
    );

    vscode.window.showInformationMessage(`OAT: Image placed as ${target}.`);
    await this._loadStaged();
  }

  // ── Discard ───────────────────────────────────────────────────────────────

  async _handleDiscard(image) {
    if (image && image.source === 'd1') {
      vscode.window.showInformationMessage('OAT: D1 discard is not wired yet; use the ledger API or wait for the next panel action.');
      return;
    }

    const isPlaced = image.status === 'placed';
    const msg = isPlaced
      ? `This image is placed in ${image.placed_in}. Remove from article and repo?`
      : 'Discard this image? It has not been placed anywhere.';

    const choice = await vscode.window.showWarningMessage(msg, { modal: true }, 'Discard');
    if (choice !== 'Discard') return;

    if (isPlaced) await discardPlaced(image);

    const sheetId = this._sheetId();
    const token = await getServiceAccountToken({ credentialPath: getSetting('serviceAccountPath', '') });
    await updateRow(sheetId, image.rowIndex, { status: 'discarded' }, token);

    vscode.window.showInformationMessage('OAT: Image discarded.');
    await this._loadStaged();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _sheetId() {
    return process.env.OAT_IMAGE_SHEET_ID ||
      getSetting('sheetId', '') ||
      vscode.workspace.getConfiguration('oat').get('imageStagingSheetId', '');
  }

  _send(msg) {
    if (this._view) this._view.webview.postMessage(msg);
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  _html(webview) {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-panel-background);
}
.toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
  position: sticky; top: 0;
  background: var(--vscode-panel-background);
  z-index: 1;
}
.count { opacity: 0.6; font-size: 11px; flex: 1; }
.refresh-btn {
  background: none; border: none; color: var(--vscode-foreground);
  cursor: pointer; font-size: 14px; padding: 2px 5px; border-radius: 3px;
}
.refresh-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
#status { padding: 16px; text-align: center; opacity: 0.6; font-size: 12px; }
.error { color: var(--vscode-errorForeground); }
.card { border-bottom: 1px solid var(--vscode-panel-border); }
.thumb-wrap {
  width: 100%; height: 130px; overflow: hidden;
  background: var(--vscode-input-background);
}
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.no-thumb {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.4; font-size: 11px;
}
.meta { padding: 6px 8px 4px; }
.photographer { font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.license { font-size: 11px; opacity: 0.65; margin-top: 1px; }
.url-line { font-size: 10px; opacity: 0.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.actions { padding: 5px 8px 8px; display: flex; gap: 6px; }
.btn {
  flex: 1; padding: 4px 0; border: none; border-radius: 3px;
  cursor: pointer; font-size: 12px;
  font-family: var(--vscode-font-family);
}
.btn-place {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.btn-place:hover { background: var(--vscode-button-hoverBackground); }
.btn-discard {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.btn-discard:hover { background: var(--vscode-button-secondaryHoverBackground, #555); }
</style>
</head>
<body>
<div class="toolbar">
  <span class="count" id="count"></span>
  <button class="refresh-btn" id="refreshBtn" title="Refresh">↻</button>
</div>
<div id="status">Loading…</div>
<div id="list"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let images = [];

document.getElementById('refreshBtn').addEventListener('click', () => {
  document.getElementById('status').textContent = 'Loading…';
  document.getElementById('status').className = '';
  document.getElementById('status').style.display = 'block';
  document.getElementById('list').innerHTML = '';
  document.getElementById('count').textContent = '';
  vscode.postMessage({ type: 'refresh' });
});

let _timeoutId = null;

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'ping') {
    document.getElementById('status').textContent = 'Extension alive — waiting for data…';
  } else if (msg.type === 'staged') {
    clearTimeout(_timeoutId);
    images = msg.images;
    render();
  } else if (msg.type === 'error') {
    clearTimeout(_timeoutId);
    document.getElementById('status').textContent = '⚠ ' + msg.message;
    document.getElementById('status').className = 'error';
    document.getElementById('status').style.display = 'block';
    document.getElementById('list').innerHTML = '';
    document.getElementById('count').textContent = '';
  }
});

function render() {
  const status = document.getElementById('status');
  const list   = document.getElementById('list');
  const count  = document.getElementById('count');

  if (images.length === 0) {
    status.textContent = 'Queue empty — log an image to get started.';
    status.className = '';
    status.style.display = 'block';
    list.innerHTML = '';
    count.textContent = '';
    return;
  }

  status.style.display = 'none';
  count.textContent = images.length + ' staged';
  list.innerHTML = images.map((img, i) => {
    const thumbHtml = img.thumbUrl
      ? '<img class="thumb" src="' + esc(img.thumbUrl) + '" alt="" loading="lazy">'
      : '<div class="no-thumb">No preview</div>';
    return (
      '<div class="card">' +
        '<div class="thumb-wrap">' + thumbHtml + '</div>' +
        '<div class="meta">' +
          '<div class="photographer">' + esc(img.photographer || '(no photographer)') + '</div>' +
          '<div class="license">'      + esc(img.license      || '')                  + '</div>' +
          '<div class="url-line">'     + esc(img.url          || '')                  + '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-place"   data-i="' + i + '">Place</button>' +
          '<button class="btn btn-discard" data-i="' + i + '">Discard</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  list.querySelectorAll('.thumb').forEach(img => {
    img.addEventListener('error', function() {
      this.parentNode.innerHTML = '<div class="no-thumb">No preview</div>';
    });
  });
  list.querySelectorAll('.btn-place').forEach(btn => {
    btn.addEventListener('click', function() {
      vscode.postMessage({ type: 'place', image: images[+this.dataset.i] });
    });
  });
  list.querySelectorAll('.btn-discard').forEach(btn => {
    btn.addEventListener('click', function() {
      vscode.postMessage({ type: 'discard', image: images[+this.dataset.i] });
    });
  });
}

function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Webview sends refresh on load; extension responds with staged data
vscode.postMessage({ type: 'refresh' });

_timeoutId = setTimeout(() => {
  const s = document.getElementById('status');
  if (s && s.style.display !== 'none' && !s.classList.contains('error')) {
    s.textContent = '⚠ Timeout — no response from extension (check Output → Extension Host)';
    s.className = 'error';
    s.style.display = 'block';
  }
}, 8000);
</script>
</body>
</html>`;
  }
}

module.exports = { ImagePanelProvider };

function normalizeD1AssetForPanel(asset) {
  const imageSrc = asset.image_src || asset.imageSrc || asset.raw_asset_url || asset.rawAssetUrl || '';
  const sourceUrl = asset.source_url || asset.sourceUrl || '';
  const rawAssetUrl = asset.raw_asset_url || asset.rawAssetUrl || '';

  return {
    source: 'd1',
    id: asset.id,
    status: asset.status,
    name: asset.slug || asset.display_name || asset.displayName || asset.source_name || asset.sourceName || '',
    displayName: asset.display_name || asset.displayName || asset.slug || '',
    photographer: asset.photographer || '',
    license: asset.license || '',
    attribution: asset.attribution || '',
    url: rawAssetUrl || sourceUrl || imageSrc,
    imageSrc,
    thumbUrl: rawAssetUrl || imageSrc || sourceUrl,
    assetPath: asset.asset_path || asset.assetPath || '',
    rawAssetUrl,
    contentHash: asset.content_hash || asset.contentHash || '',
    sourcePath: asset.source_path || asset.sourcePath || '',
    sourceUrl,
    sourceName: asset.source_name || asset.sourceName || ''
  };
}

function getSetting(key, defaultValue) {
  const imageValue = vscode.workspace.getConfiguration('oatImages').get(key, undefined);
  if (imageValue !== undefined && imageValue !== '') return imageValue;
  return vscode.workspace.getConfiguration('oat').get(key, defaultValue);
}
