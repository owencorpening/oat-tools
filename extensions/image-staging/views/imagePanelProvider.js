'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const {
  buildContentDraftRecord,
  buildDraftLocation
} = require('../lib/reviewImageNeedCommand');

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
          case 'providerSearch': return await this._handleProviderSearch(msg);
          case 'stageProviderImage': return await this._handleStageProviderImage(msg.result);
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
    if (!this._ledgerWriter || !this._ledgerWriter.listStagedAssets) {
      this._send({ type: 'error', message: 'Set oatImages.ledgerApiUrl to load staged images from the D1 ledger.' });
      return;
    }

    await this._loadProviders();
    await this._loadD1Staged();
  }

  async _loadProviders() {
    if (!this._ledgerWriter || !this._ledgerWriter.listImageProviders) return;

    try {
      const result = await this._ledgerWriter.listImageProviders();
      this._send({ type: 'providers', providers: Array.isArray(result?.providers) ? result.providers : [] });
    } catch {
      this._send({ type: 'providers', providers: [] });
    }
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

  async _handleProviderSearch({ query, providers } = {}) {
    if (!this._ledgerWriter || !this._ledgerWriter.searchImageProviders) {
      this._send({ type: 'error', message: 'Set oatImages.ledgerApiUrl to search provider images.' });
      return null;
    }

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      this._send({ type: 'providerResults', query: cleanQuery, results: [] });
      return { query: cleanQuery, results: [] };
    }

    const result = await this._ledgerWriter.searchImageProviders({
      query: cleanQuery,
      providers: providers && providers.length ? providers : ['pexels'],
      perPage: 12
    });
    const results = Array.isArray(result?.results) ? result.results : [];
    this._send({ type: 'providerResults', query: cleanQuery, results });
    return { query: cleanQuery, results };
  }

  async _handleStageProviderImage(result) {
    if (!this._ledgerWriter || !this._ledgerWriter.stageProviderImage) {
      vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before staging provider images.');
      return null;
    }
    if (!result || !result.provider) return null;

    const response = await this._ledgerWriter.stageProviderImage({
      provider: result.provider,
      providerId: result.providerId,
      sourceUrl: result.sourceUrl,
      result
    });

    vscode.window.showInformationMessage(`OAT: Staged ${result.title || result.sourceUrl || 'provider image'}.`);
    this._send({ type: 'providerStaged', asset: response && response.asset });
    await this._loadStaged();
    return response;
  }

  // ── Place ─────────────────────────────────────────────────────────────────

  async _handlePlace(image) {
    if (!this._ledgerWriter || !this._ledgerWriter.savePlacement) {
      vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before creating notebook placements.');
      return null;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('OAT: Open the target markdown draft before placing a notebook image.');
      return null;
    }

    const target = await vscode.window.showQuickPick(
      ['substack', 'carousel', 'linkedin-post'],
      { placeHolder: 'Publishing target' }
    );
    if (!target) return null;

    const defaultFigureNumber = nextFigureNumberHint(editor);
    const figureNumber = await vscode.window.showInputBox({
      prompt: target === 'substack' ? 'Figure number' : 'Figure number or handoff label',
      value: defaultFigureNumber,
      validateInput: value => target === 'substack' && !String(value || '').trim() ? 'Required for Substack' : null
    });
    if (figureNumber === undefined) return null;

    const contentDraft = buildContentDraftRecord({ vscode, editor });
    const placement = {
      id: placementId({ assetId: image.id, contentDraftId: contentDraft.id, target, figureNumber }),
      assetId: image.id,
      contentDraftId: contentDraft.id,
      target,
      figureNumber: String(figureNumber || '').trim() || undefined,
      draftLocation: buildDraftLocation(editor),
      snippetFormat: snippetFormatForTarget(target),
      status: 'planned'
    };
    const saga = {
      id: sagaId(placement.id),
      assetId: image.id,
      assetPlacementId: placement.id,
      currentStep: 1,
      status: 'running',
      resolution: 'auto-retry',
      compensation: 'Ready for local placement saga'
    };

    await this._ledgerWriter.savePlacement({ contentDraft, placement, saga });
    vscode.window.showInformationMessage(`OAT: Planned ${target} placement for ${image.displayName || image.name}.`);
    await this._loadStaged();

    return { contentDraft, placement, saga };
  }

  // ── Discard ───────────────────────────────────────────────────────────────

  async _handleDiscard(image) {
    if (!this._ledgerWriter || !this._ledgerWriter.discardAsset) {
      vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before discarding notebook images.');
      return null;
    }

    const label = image.displayName || image.name || image.id || 'this image';
    const choice = await vscode.window.showWarningMessage(`Discard ${label}?`, { modal: true }, 'Discard');
    if (choice !== 'Discard') return;

    await this._ledgerWriter.discardAsset(image.id);

    vscode.window.showInformationMessage('OAT: Image discarded.');
    await this._loadStaged();
    return { assetId: image.id };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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
.searchbar {
  display: grid; grid-template-columns: 1fr auto;
  gap: 6px; padding: 7px 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.search-input {
  min-width: 0; padding: 4px 6px;
  border: 1px solid var(--vscode-input-border, transparent);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-font-family);
  font-size: 12px;
}
.search-btn {
  padding: 4px 8px; border: none; border-radius: 3px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer; font-family: var(--vscode-font-family);
  font-size: 12px;
}
.search-btn:hover { background: var(--vscode-button-hoverBackground); }
.search-input:disabled,
.search-btn:disabled {
  opacity: 0.55; cursor: not-allowed;
}
.section-title {
  padding: 7px 8px 4px;
  font-size: 11px; opacity: 0.72; text-transform: uppercase;
}
#status { padding: 16px; text-align: center; opacity: 0.6; font-size: 12px; }
.search-status { padding: 8px; opacity: 0.6; font-size: 11px; }
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
.btn-stage {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.btn-stage:hover { background: var(--vscode-button-hoverBackground); }
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
<form class="searchbar" id="searchForm">
  <input class="search-input" id="searchInput" type="search" placeholder="Search Pexels">
  <button class="search-btn" type="submit">Search</button>
</form>
<div id="searchStatus" class="search-status" style="display:none"></div>
<div id="results"></div>
<div id="status">Loading…</div>
<div id="list"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let images = [];
let providerResults = [];
let availableProviders = [{ id: 'pexels', label: 'Pexels' }];

document.getElementById('refreshBtn').addEventListener('click', () => {
  document.getElementById('status').textContent = 'Loading…';
  document.getElementById('status').className = '';
  document.getElementById('status').style.display = 'block';
  document.getElementById('list').innerHTML = '';
  document.getElementById('count').textContent = '';
  vscode.postMessage({ type: 'refresh' });
});

document.getElementById('searchForm').addEventListener('submit', event => {
  event.preventDefault();
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;
  providerResults = [];
  renderProviderResults('Searching…');
  vscode.postMessage({ type: 'providerSearch', query, providers: ['pexels'] });
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
  } else if (msg.type === 'providers') {
    availableProviders = msg.providers || [];
    renderProviderAvailability();
  } else if (msg.type === 'providerResults') {
    providerResults = msg.results || [];
    renderProviderResults(providerResults.length ? '' : 'No provider results.');
  } else if (msg.type === 'providerStaged') {
    renderProviderResults('Staged.');
  } else if (msg.type === 'error') {
    clearTimeout(_timeoutId);
    document.getElementById('status').textContent = '⚠ ' + msg.message;
    document.getElementById('status').className = 'error';
    document.getElementById('status').style.display = 'block';
    document.getElementById('list').innerHTML = '';
    document.getElementById('count').textContent = '';
  }
});

function renderProviderAvailability() {
  const input = document.getElementById('searchInput');
  const button = document.querySelector('.search-btn');
  const enabled = availableProviders.some(provider => provider.id === 'pexels');
  input.disabled = !enabled;
  button.disabled = !enabled;
  input.placeholder = enabled ? 'Search Pexels' : 'Pexels unavailable';
}

function renderProviderResults(message) {
  const results = document.getElementById('results');
  const searchStatus = document.getElementById('searchStatus');

  if (message) {
    searchStatus.textContent = message;
    searchStatus.style.display = 'block';
  } else {
    searchStatus.textContent = '';
    searchStatus.style.display = 'none';
  }

  if (providerResults.length === 0) {
    results.innerHTML = '';
    return;
  }

  results.innerHTML = '<div class="section-title">Provider Results</div>' + providerResults.map((img, i) => {
    const thumbHtml = img.thumbnailUrl || img.imageSrc
      ? '<img class="thumb" src="' + esc(img.thumbnailUrl || img.imageSrc) + '" alt="" loading="lazy">'
      : '<div class="no-thumb">No preview</div>';
    return (
      '<div class="card">' +
        '<div class="thumb-wrap">' + thumbHtml + '</div>' +
        '<div class="meta">' +
          '<div class="photographer">' + esc(img.photographer || '(no photographer)') + '</div>' +
          '<div class="license">'      + esc(img.license      || '')                  + '</div>' +
          '<div class="url-line">'     + esc(img.sourceUrl    || '')                  + '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-stage" data-i="' + i + '">Stage</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  results.querySelectorAll('.thumb').forEach(img => {
    img.addEventListener('error', function() {
      this.parentNode.innerHTML = '<div class="no-thumb">No preview</div>';
    });
  });
  results.querySelectorAll('.btn-stage').forEach(btn => {
    btn.addEventListener('click', function() {
      vscode.postMessage({ type: 'stageProviderImage', result: providerResults[+this.dataset.i] });
    });
  });
}

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
  list.innerHTML = '<div class="section-title">Staged Images</div>' + images.map((img, i) => {
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

function snippetFormatForTarget(target) {
  if (target === 'substack') return 'html-figure';
  if (target === 'carousel') return 'marp-image';
  if (target === 'linkedin-post') return 'linkedin-handoff-text';
  return 'other';
}

function nextFigureNumberHint(editor) {
  const document = editor && editor.document;
  if (!document || typeof document.getText !== 'function') return '';

  const matches = document.getText().match(/Figure\s+(\d+)/gi) || [];
  const numbers = matches
    .map(match => Number((match.match(/\d+/) || [])[0]))
    .filter(Number.isFinite);
  if (numbers.length === 0) return '';

  return String(Math.max(...numbers) + 1);
}

function placementId({ assetId, contentDraftId, target, figureNumber }) {
  return `placement_${shortHash(`${assetId}:${contentDraftId}:${target}:${figureNumber || ''}`)}`;
}

function sagaId(placementIdValue) {
  return `saga_${shortHash(placementIdValue)}`;
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

function getSetting(key, defaultValue) {
  const imageValue = vscode.workspace.getConfiguration('oatImages').get(key, undefined);
  if (imageValue !== undefined && imageValue !== '') return imageValue;
  return vscode.workspace.getConfiguration('oat').get(key, defaultValue);
}
