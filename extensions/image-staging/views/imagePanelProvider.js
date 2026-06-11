'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const downloadsProvider = require('../lib/downloadsProvider');
const { placeAsset } = require('../lib/imagePipeline');
const { imagesRepoPath } = require('../lib/plannedPlacementRunCommand');
const {
  buildContentDraftRecord,
  buildDraftLocation
} = require('../lib/reviewImageNeedCommand');

class ImagePanelProvider {
  static viewId = 'oatImages.panel';

  constructor(context, {
    ledgerWriter,
    localDownloadsProvider = downloadsProvider,
    runPlacement = placeAsset,
    getImagesRepoPath = imagesRepoPath,
    writeSnippet = writeSnippetToActiveEditor,
    outputChannel
  } = {}) {
    this._context = context;
    this._ledgerWriter = ledgerWriter;
    this._downloadsProvider = localDownloadsProvider;
    this._runPlacement = runPlacement;
    this._getImagesRepoPath = getImagesRepoPath;
    this._writeSnippet = writeSnippet;
    this._outputChannel = outputChannel;
    this._view = null;
  }

  _log(message) {
    if (this._outputChannel) {
      this._outputChannel.appendLine(message);
    }
  }

  // Called by VS Code when the panel becomes visible
  resolveWebviewView(webviewView) {
    this._log('[OAT] resolveWebviewView called');
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      ...(vscode.Uri?.file ? { localResourceRoots: [
        vscode.Uri.file(path.join(os.homedir(), 'Downloads'))
      ] } : {})
    };
    webviewView.webview.html = this._html(webviewView.webview);
    this._log('[OAT] Webview HTML set');

    // Proactive ping — confirms extension→webview channel works
    setTimeout(() => {
      this._send({ type: 'ping' });
    }, 1000);

    webviewView.webview.onDidReceiveMessage(async msg => {
      this._log('[OAT] Received message: ' + msg.type);
      try {
        switch (msg.type) {
          case 'webviewReady': {
            console.log('[OAT] ✓ Webview is ready and channel is working');
            return;
          }
          case 'refresh': {
            console.log('[OAT] Handling refresh. ledgerWriter available:', !!this._ledgerWriter, 'has listStagedAssets:', !!(this._ledgerWriter && this._ledgerWriter.listStagedAssets));
            return await this._loadStaged();
          }
          case 'providerSearch': return await this._handleProviderSearch(msg);
          case 'stageProviderImage': return await this._handleStageProviderImage(msg.result);
          case 'place':   return await this._handlePlace(msg.image);
          case 'discard': return await this._handleDiscard(msg.image);
        }
      } catch (err) {
        console.error('[OAT] Error handling message:', err);
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
    const providers = [{ id: 'downloads', label: 'Downloads' }];
    if (!this._ledgerWriter || !this._ledgerWriter.listImageProviders) {
      this._send({ type: 'providers', providers });
      return;
    }

    try {
      const result = await this._ledgerWriter.listImageProviders();
      providers.push(...(Array.isArray(result?.providers) ? result.providers : []));
      this._send({ type: 'providers', providers });
    } catch {
      this._send({ type: 'providers', providers });
    }
  }

  async _loadD1Staged() {
    try {
      const result = await this._ledgerWriter.listStagedAssets();
      console.log('[OAT] _loadD1Staged result:', result);
      const assets = Array.isArray(result?.assets) ? result.assets : [];
      console.log('[OAT] assets count:', assets.length);
      const images = assets.map(normalizeD1AssetForPanel);
      this._send({ type: 'staged', images, source: 'd1' });
    } catch (err) {
      console.error('[OAT] _loadD1Staged error:', err);
      this._send({ type: 'error', message: err.message });
    }
  }

  async _handleProviderSearch({ query, providers } = {}) {
    if (!this._downloadsProvider?.searchDownloads && !this._ledgerWriter?.searchImageProviders) {
      this._send({ type: 'error', message: 'Set oatImages.ledgerApiUrl or enable a local provider to search images.' });
      return null;
    }

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      this._send({ type: 'providerResults', query: cleanQuery, results: [] });
      return { query: cleanQuery, results: [] };
    }

    const requestedProviders = providers && providers.length ? providers : ['pexels', 'downloads'];
    const results = [];

    if (requestedProviders.includes('downloads') && this._downloadsProvider?.searchDownloads) {
      const localResult = await this._downloadsProvider.searchDownloads({ query: cleanQuery, limit: 12 });
      results.push(...this._prepareProviderResultsForPanel(localResult?.results));
    }

    if (requestedProviders.includes('pexels') && this._ledgerWriter?.searchImageProviders) {
      try {
        const result = await this._ledgerWriter.searchImageProviders({
          query: cleanQuery,
          providers: ['pexels'],
          perPage: 12
        });
        results.push(...this._prepareProviderResultsForPanel(result?.results));
      } catch (err) {
        this._send({ type: 'providerNotice', message: `Pexels search skipped: ${err.message}` });
      }
    }

    this._send({ type: 'providerResults', query: cleanQuery, results });
    return { query: cleanQuery, results };
  }

  async _handleStageProviderImage(result) {
    if (!result || !result.provider) return null;

    if (result.provider === 'downloads') {
      return this._handleStageDownloadsImage(result);
    }

    if (!this._ledgerWriter || !this._ledgerWriter.stageProviderImage) {
      vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before staging provider images.');
      return null;
    }

    try {
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
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed: asset.content_hash')) {
        vscode.window.showInformationMessage('OAT: This image is already staged.');
        await this._loadStaged();
        return null;
      }
      throw err;
    }
  }

  async _handleStageDownloadsImage(result) {
    this._log('[OAT] _handleStageDownloadsImage called');
    if (!this._ledgerWriter || !this._ledgerWriter.saveAsset) {
      this._log('[OAT] ERROR: No ledger writer or saveAsset method');
      vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before staging Downloads images.');
      return null;
    }
    if (!this._downloadsProvider || !this._downloadsProvider.stageDownloadsResult) {
      this._log('[OAT] ERROR: No downloads provider or stageDownloadsResult method');
      return null;
    }

    try {
      this._log('[OAT] Calling stageDownloadsResult...');
      const asset = await this._downloadsProvider.stageDownloadsResult(result);
      this._log('[OAT] Asset created: ' + asset.slug);

      this._log('[OAT] Saving asset to ledger...');
      await this._ledgerWriter.saveAsset({ asset });
      this._log('[OAT] Asset saved successfully');

      vscode.window.showInformationMessage(`OAT: Staged ${asset.displayName || result.title || 'Downloads image'}.`);
      this._send({ type: 'providerStaged', asset });
      await this._loadStaged();
      return { asset };
    } catch (err) {
      this._log('[OAT] Error in _handleStageDownloadsImage: ' + err.message);
      if (err.message && err.message.includes('UNIQUE constraint failed: asset.content_hash')) {
        vscode.window.showInformationMessage('OAT: This image is already staged.');
        await this._loadStaged();
        return null;
      }
      throw err;
    }
  }

  // ── Place ─────────────────────────────────────────────────────────────────

  async _handlePlace(image) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('OAT: Open the target markdown draft before placing a notebook image.');
      return null;
    }

    if (!isMarkdownDraft(editor)) {
      vscode.window.showWarningMessage('OAT: Open a markdown draft before placing a notebook image.');
      return null;
    }

    const target = placementTargetFromEditor(editor);
    if (!target) {
      vscode.window.showWarningMessage('OAT: Open a Substack draft under substack-ideas or a carousel draft ending in carousel.md before placing.');
      return null;
    }

    if (!hasDirectPlacementLedgerMethods(this._ledgerWriter)) {
      vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before placing figures.');
      return null;
    }

    const contentDraft = buildContentDraftRecord({ vscode, editor });
    const figureNumber = await nextFigureNumber({ editor, ledgerWriter: this._ledgerWriter, contentDraftId: contentDraft.id });
    const caption = captionSuggestionForImage(image);

    const placement = {
      id: placementId({ assetId: image.id, contentDraftId: contentDraft.id, target, figureNumber }),
      assetId: image.id,
      contentDraftId: contentDraft.id,
      target,
      figureNumber,
      draftLocation: {
        ...buildDraftLocation(editor),
        caption
      },
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

    const { series, partDir } = extractSeriesAndPartDir(editor);
    const placed = await this._runPlacement({
      db: {},
      sagaId: saga.id,
      repoPath: this._getImagesRepoPath(vscode),
      asset: image,
      placement,
      series,
      partDir,
      ledger: this._ledgerWriter,
      download: true,
      commit: true,
      writeSnippet: payload => this._writeSnippet(vscode, payload)
    });

    vscode.window.showInformationMessage(`OAT: Placed Figure ${figureNumber} for ${image.displayName || image.name}.`);
    await this._loadStaged();

    return { contentDraft, placement, saga, placed };
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

  _prepareProviderResultsForPanel(results) {
    if (!Array.isArray(results)) return [];
    return results.map(result => this._prepareProviderResultForPanel(result));
  }

  _prepareProviderResultForPanel(result) {
    if (
      !result ||
      result.provider !== 'downloads' ||
      !result.sourcePath ||
      !this._view?.webview?.asWebviewUri ||
      !vscode.Uri?.file
    ) {
      return {
        ...result,
        provenance: buildProvenanceForPanel(result)
      };
    }

    return {
      ...result,
      previewUrl: this._view.webview.asWebviewUri(vscode.Uri.file(result.sourcePath)).toString(),
      provenance: buildProvenanceForPanel(result)
    };
  }

  // ── Webview HTML ──────────────────────────────────────────────────────────

  _html(webview) {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">

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
.card-content {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 8px;
  padding: 8px;
}
.thumb-wrap {
  width: 112px; height: 112px; overflow: hidden;
  background: var(--vscode-input-background);
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--vscode-panel-border);
  position: relative;
  z-index: 0;
}
.thumb-wrap:hover {
  overflow: visible;
  z-index: 2;
}
.thumb {
  width: 100%; height: 100%; object-fit: contain; display: block;
  background: var(--vscode-input-background);
  transition: transform 140ms ease, box-shadow 140ms ease;
  transform-origin: center;
}
.thumb-wrap:hover .thumb {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
  transform: scale(1.45);
}
.no-thumb {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.4; font-size: 11px;
}
.meta { min-width: 0; padding: 0; }
.meta-title { font-weight: 600; font-size: 12px; line-height: 1.25; overflow-wrap: anywhere; }
.photographer { font-size: 11px; opacity: 0.68; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.license { font-size: 11px; opacity: 0.65; margin-top: 1px; }
.url-line { font-size: 10px; opacity: 0.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.provenance {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-top: 6px;
}
.prov-pill {
  max-width: 100%;
  padding: 2px 5px;
  border: 1px solid var(--vscode-badge-background, var(--vscode-panel-border));
  border-radius: 3px;
  color: var(--vscode-foreground);
  background: color-mix(in srgb, var(--vscode-badge-background, transparent) 18%, transparent);
  font-size: 10px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-pill-warning {
  border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
  background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, transparent) 35%, transparent);
}
.prov-label { opacity: 0.72; }
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
@media (max-width: 285px) {
  .card-content { grid-template-columns: 1fr; }
  .thumb-wrap { width: 100%; height: 160px; }
}
</style>
</head>
<body>
<div class="toolbar">
  <span class="count" id="count"></span>
  <button class="refresh-btn" id="refreshBtn" title="Refresh">↻</button>
</div>
<form class="searchbar" id="searchForm">
  <input class="search-input" id="searchInput" type="search" placeholder="Search Pexels + Downloads">
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
let availableProviders = [{ id: 'downloads', label: 'Downloads' }];

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
  vscode.postMessage({ type: 'providerSearch', query, providers: ['downloads', 'pexels'] });
});

const resultsEl = document.getElementById('results');
const listEl = document.getElementById('list');
console.log('[OAT-Webview] Attaching click handlers to:', resultsEl, listEl);
resultsEl.addEventListener('click', e => {
  console.log('[OAT-Webview] Click on results:', e.target);
  handleCardAction(e);
});
listEl.addEventListener('click', e => {
  console.log('[OAT-Webview] Click on list:', e.target);
  handleCardAction(e);
});

let _timeoutId = null;
let _lastStagedIndex = null;

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'ping') {
    document.getElementById('status').textContent = 'Extension alive — waiting for data…';
  } else if (msg.type === 'staged') {
    clearTimeout(_timeoutId);
    images = msg.images;
    render();
    renderProviderResults('');
  } else if (msg.type === 'providers') {
    availableProviders = msg.providers || [];
    renderProviderAvailability();
  } else if (msg.type === 'providerResults') {
    providerResults = msg.results || [];
    renderProviderResults(providerResults.length ? '' : 'No provider results.');
  } else if (msg.type === 'providerStaged') {
    if (_lastStagedIndex !== null && providerResults[_lastStagedIndex]) {
      providerResults.splice(_lastStagedIndex, 1);
      _lastStagedIndex = null;
    }
    renderProviderResults('Staged.');
  } else if (msg.type === 'providerNotice') {
    renderProviderResults(msg.message || '');
  } else if (msg.type === 'error') {
    clearTimeout(_timeoutId);
    document.getElementById('status').textContent = '⚠ ' + msg.message;
    document.getElementById('status').className = 'error';
    document.getElementById('status').style.display = 'block';
    document.getElementById('list').innerHTML = '';
    document.getElementById('count').textContent = '';
    _lastStagedIndex = null;
  }
});

function renderProviderAvailability() {
  const input = document.getElementById('searchInput');
  const button = document.querySelector('.search-btn');
  const enabled = availableProviders.length > 0;
  input.disabled = !enabled;
  button.disabled = !enabled;
  input.placeholder = enabled ? providerPlaceholder() : 'No providers available';
}

function providerPlaceholder() {
  const names = availableProviders.map(provider => provider.label || provider.id);
  if (names.length === 1) return 'Search ' + names[0];
  return 'Search ' + names.join(' + ');
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

  console.log('[OAT-Webview] Filtering results. staged images:', images.length, 'provider results:', providerResults.length);
  const filterableResults = providerResults.filter((img, i) => {
    const isStaged = isImageAlreadyStaged(img);
    if (isStaged) console.log('[OAT-Webview] Filtered out:', img.title || img.sourcePath || img.sourceUrl);
    return !isStaged;
  });

  results.innerHTML = '<div class="section-title">Provider Results</div>' + filterableResults.map((img, displayIndex) => {
    const actualIndex = providerResults.indexOf(img);
    const previewSrc = img.previewUrl || img.thumbnailUrl || img.imageSrc;
    const thumbHtml = previewSrc
      ? '<img class="thumb" src="' + esc(previewSrc) + '" alt="" loading="lazy">'
      : '<div class="no-thumb">No preview</div>';
    return (
      '<div class="card">' +
        '<div class="card-content">' +
          '<div class="thumb-wrap">' + thumbHtml + '</div>' +
          '<div class="meta">' +
            renderImageMeta(img) +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-stage" type="button" data-action="stage" data-i="' + actualIndex + '">Stage</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  results.querySelectorAll('.thumb').forEach(img => {
    img.addEventListener('error', function() {
      this.parentNode.innerHTML = '<div class="no-thumb">No preview</div>';
    });
  });
}

function isImageAlreadyStaged(providerResult) {
  if (!providerResult) return false;

  return images.some(stagedImg => {
    if (providerResult.provider === 'downloads' && providerResult.sourcePath) {
      const match = stagedImg.sourcePath === providerResult.sourcePath;
      if (match) console.log('[OAT] downloads match:', stagedImg.sourcePath);
      return match;
    }
    if (providerResult.sourceUrl && stagedImg.sourceUrl) {
      const match = stagedImg.sourceUrl === providerResult.sourceUrl;
      if (match) console.log('[OAT] sourceUrl match:', stagedImg.sourceUrl);
      if (!match && providerResult.sourceUrl) {
        console.log('[OAT] sourceUrl mismatch - provider:', providerResult.sourceUrl, 'staged:', stagedImg.sourceUrl);
      }
      return match;
    }
    return false;
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
    const previewSrc = img.previewUrl || img.thumbUrl;
    const thumbHtml = previewSrc
      ? '<img class="thumb" src="' + esc(previewSrc) + '" alt="" loading="lazy">'
      : '<div class="no-thumb">No preview</div>';
    return (
      '<div class="card">' +
        '<div class="card-content">' +
          '<div class="thumb-wrap">' + thumbHtml + '</div>' +
          '<div class="meta">' +
            renderImageMeta(img) +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn btn-place" type="button" data-action="place" data-i="' + i + '">Place Figure</button>' +
          '<button class="btn btn-discard" type="button" data-action="discard" data-i="' + i + '">Discard</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  list.querySelectorAll('.thumb').forEach(img => {
    img.addEventListener('error', function() {
      this.parentNode.innerHTML = '<div class="no-thumb">No preview</div>';
    });
  });
}

function handleCardAction(event) {
  console.log('[OAT-Webview] Card action clicked:', event.target);
  const button = event.target.closest('button[data-action]');
  if (!button) {
    console.log('[OAT-Webview] No button found');
    return;
  }

  const index = Number(button.dataset.i);
  console.log('[OAT-Webview] Button action:', button.dataset.action, 'index:', index, 'providerResults length:', providerResults.length);
  if (!Number.isInteger(index) || index < 0) return;

  if (button.dataset.action === 'stage') {
    console.log('[OAT-Webview] Posting stageProviderImage, result:', providerResults[index]);
    _lastStagedIndex = index;
    vscode.postMessage({ type: 'stageProviderImage', result: providerResults[index] });
  } else if (button.dataset.action === 'place') {
    vscode.postMessage({ type: 'place', image: images[index] });
  } else if (button.dataset.action === 'discard') {
    vscode.postMessage({ type: 'discard', image: images[index] });
  }
}

function renderImageMeta(img) {
  const title = img.title || img.displayName || img.name || img.sourceName || '(untitled image)';
  const creator = img.photographer ? '<div class="photographer">' + esc(img.photographer) + '</div>' : '';
  const source = img.sourceUrl || img.url || img.imageSrc || img.sourcePath || '';
  const sourceLine = source ? '<div class="url-line">' + esc(source) + '</div>' : '';
  return (
    '<div class="meta-title">' + esc(title) + '</div>' +
    creator +
    renderProvenance(img.provenance || fallbackProvenance(img)) +
    sourceLine
  );
}

function renderProvenance(items) {
  if (!items || items.length === 0) return '';
  return '<div class="provenance">' + items.map(item => {
    const toneClass = item.tone === 'warning' ? ' prov-pill-warning' : '';
    return (
      '<span class="prov-pill' + toneClass + '" title="' + esc(item.label + ': ' + item.value) + '">' +
        '<span class="prov-label">' + esc(item.label) + ':</span> ' + esc(item.value) +
      '</span>'
    );
  }).join('') + '</div>';
}

function fallbackProvenance(img) {
  return [
    { label: 'Source', value: img.provider || img.sourceName || 'unknown', tone: img.provider || img.sourceName ? undefined : 'warning' },
    { label: img.license ? 'License' : 'Rights', value: img.license || 'unknown', tone: img.license ? undefined : 'warning' },
    { label: 'Status', value: img.status || 'unknown', tone: img.status ? undefined : 'warning' }
  ];
}

function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Webview sends refresh on load; extension responds with staged data
console.log('[OAT-Webview] Webview loaded, sending refresh message');
vscode.postMessage({ type: 'refresh' });
vscode.postMessage({ type: 'webviewReady' });

// Test that click handler is attached
document.addEventListener('DOMContentLoaded', () => {
  console.log('[OAT-Webview] DOM ready');
  const resultsEl = document.getElementById('results');
  const listEl = document.getElementById('list');
  console.log('[OAT-Webview] Elements found - results:', !!resultsEl, 'list:', !!listEl);
});

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

module.exports = { ImagePanelProvider, placementTargetFromDraftPath };

function isMarkdownDraft(editor) {
  return /\.md$/i.test(editor?.document?.uri?.fsPath || '');
}

function placementTargetFromEditor(editor) {
  return placementTargetFromDraftPath(editor?.document?.uri?.fsPath);
}

function extractSeriesAndPartDir(editor) {
  const filePath = editor?.document?.uri?.fsPath || '';
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  // Find substack-ideas or standalone
  const ideaIndex = segments.findIndex(seg => seg === 'substack-ideas' || seg === 'standalone');
  if (ideaIndex === -1 || ideaIndex + 2 >= segments.length) {
    return { series: '', partDir: '' };
  }

  // Series is the directory after substack-ideas/
  const series = segments[ideaIndex + 1];

  // PartDir is the filename without .md extension
  const filename = segments[segments.length - 1];
  const partDir = filename.replace(/\.md$/i, '');

  return { series, partDir };
}

function placementTargetFromDraftPath(draftPath) {
  const normalized = String(draftPath || '').replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] || '';

  if (/carousel\.md$/.test(fileName)) return 'carousel';
  if (segments.includes('substack-ideas')) return 'substack';
  return null;
}

async function nextFigureNumber({ editor, ledgerWriter, contentDraftId } = {}) {
  const numbers = figureNumbersFromText(editor?.document?.getText?.() || '');

  if (ledgerWriter?.listPlannedPlacements && contentDraftId) {
    try {
      const result = await ledgerWriter.listPlannedPlacements({ contentDraftId });
      for (const placement of result?.placements || []) {
        const value = Number(placement.figure_number || placement.figureNumber);
        if (Number.isInteger(value) && value > 0) numbers.push(value);
      }
    } catch {
      // Draft text still gives a deterministic local figure hint.
    }
  }

  return String(numbers.length ? Math.max(...numbers) + 1 : 1);
}

function figureNumbersFromText(text = '') {
  const matches = String(text).match(/Figure\s+(\d+)/gi) || [];
  return matches
    .map(match => Number((match.match(/\d+/) || [])[0]))
    .filter(value => Number.isInteger(value) && value > 0);
}

function captionSuggestionForImage(image = {}) {
  const title = image.title || image.displayName || image.name || image.sourceName || 'Untitled image';
  const parts = [title];

  if (image.attribution) {
    parts.push(image.attribution);
  } else {
    const rights = [];
    if (image.photographer) rights.push(`image by ${image.photographer}`);
    if (image.license) rights.push(image.license);
    if (rights.length) parts.push(rights.join(', '));
  }

  const origin = sourceDomain(image.sourceUrl || image.url || image.imageSrc);
  if (origin) parts.push(`source: ${origin}`);

  return parts
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join('. ')
    .replace(/\.+$/g, '') + '.';
}

function normalizeD1AssetForPanel(asset) {
  const imageSrc = asset.image_src || asset.imageSrc || asset.raw_asset_url || asset.rawAssetUrl || '';
  const sourceUrl = asset.source_url || asset.sourceUrl || '';
  const rawAssetUrl = asset.raw_asset_url || asset.rawAssetUrl || '';

  const image = {
    source: 'd1',
    id: asset.id,
    slug: asset.slug || '',
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
  image.provenance = buildProvenanceForPanel(image);
  return image;
}

function buildProvenanceForPanel(record = {}) {
  const items = [];
  const sourceKind = record.sourceKind || sourceKindFromRecord(record);
  const sourceLabel = sourceLabelFor(record, sourceKind);
  items.push({ label: 'Source', value: sourceLabel.value, tone: sourceLabel.tone });

  const origin = sourceDomain(record.sourceUrl || record.url || record.imageSrc) ||
    record.sourceName ||
    fileNameFromPath(record.sourcePath);
  items.push({ label: 'Origin', value: origin || 'unknown', tone: origin ? undefined : 'warning' });

  if (record.photographer) {
    items.push({ label: 'Creator', value: record.photographer });
  }

  if (record.attribution) {
    items.push({ label: 'Attribution', value: record.attribution });
  }

  items.push({
    label: record.license ? 'License' : 'Rights',
    value: record.license || 'unknown',
    tone: record.license ? undefined : 'warning'
  });

  if (record.status) {
    items.push({
      label: 'Status',
      value: statusLabel(record.status),
      tone: record.status === 'needs-provenance' ? 'warning' : undefined
    });
  }

  if (record.proposedTool) {
    items.push({ label: 'Tool', value: record.proposedTool });
  }
  if (record.provenanceConfidence) {
    items.push({ label: 'Hint', value: provenanceConfidenceLabel(record.provenanceConfidence) });
  }

  return items;
}

function sourceKindFromRecord(record = {}) {
  if (record.provider === 'downloads') return 'downloads';
  if (record.sourcePath) return 'local-file';
  if (record.provider) return record.provider;
  return '';
}

function sourceLabelFor(record = {}, sourceKind = '') {
  switch (sourceKind) {
    case 'ai-generated':
      return { value: 'AI generated' };
    case 'downloads':
      return { value: 'Downloads' };
    case 'user-provided':
      return { value: 'User provided' };
    case 'local-file':
      return { value: 'Local file' };
    default:
      if (record.provider) return { value: titleCase(record.provider) };
      if (record.sourceUrl || record.url || record.imageSrc) return { value: 'Web' };
      return { value: 'unknown', tone: 'warning' };
  }
}

function statusLabel(status = '') {
  return String(status).replace(/-/g, ' ');
}

function provenanceConfidenceLabel(value = '') {
  return String(value).replace(/-/g, ' ');
}

function sourceDomain(value = '') {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function fileNameFromPath(value = '') {
  if (!value) return '';
  return path.basename(value);
}

function titleCase(value = '') {
  const clean = String(value).replace(/[-_]+/g, ' ').trim();
  return clean ? clean.replace(/\b\w/g, char => char.toUpperCase()) : '';
}

function snippetFormatForTarget(target) {
  if (target === 'substack') return 'html-figure';
  if (target === 'carousel') return 'marp-image';
  if (target === 'linkedin-post') return 'linkedin-handoff-text';
  return 'other';
}

async function writeSnippetToActiveEditor(vscode, { snippet } = {}) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error('Open the target draft before writing the figure snippet.');
  }

  const document = editor.document;
  const ok = await editor.edit(editBuilder => {
    if (editor.selection && !editor.selection.isEmpty) {
      editBuilder.replace(editor.selection, snippet);
    } else {
      editBuilder.insert(editor.selection.active, snippet);
    }
  });

  if (!ok) throw new Error('VS Code rejected the figure snippet edit.');
  if (document.save) await document.save();

  return { path: document.uri && document.uri.fsPath };
}

function hasDirectPlacementLedgerMethods(ledgerWriter) {
  return [
    'savePlacement',
    'markSagaStep',
    'markAssetPublishing',
    'markPlacementPublishing',
    'updateAssetPublication',
    'updatePlacementSnippet',
    'markPlaced',
    'markFailed'
  ].every(name => ledgerWriter && typeof ledgerWriter[name] === 'function');
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

  // Check environment variable as fallback (for testing, e.g., OAT_IMAGES_LEDGER_API_URL)
  const envVarName = 'OAT_IMAGES_' + key.replace(/([A-Z])/g, '_$1').toUpperCase();
  const envValue = process.env[envVarName];
  if (envValue !== undefined && envValue !== '') return envValue;

  return vscode.workspace.getConfiguration('oat').get(key, defaultValue);
}
