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
            this._log('[OAT] ✓ Webview is ready and channel is working');
            this._log('[OAT] Auto-loading Downloads on startup');
            return await this._handleProviderSearch({ query: '*', providers: ['downloads'] });
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
      const baseUrl = vscode.workspace.getConfiguration('oatImages').get('ledgerApiUrl', '');
      const isUnreachable = err.code === 'ECONNREFUSED' || (err.message || '').includes('ECONNREFUSED');
      const isUnauthorized = (err.message || '').includes('401');
      let message;
      if (isUnreachable) {
        message = `Can't reach the ledger at ${baseUrl || '(no URL set)'} — is the Worker running? Try: npm run ledger:dev`;
      } else if (isUnauthorized) {
        message = `Ledger returned 401 — check oatImages.ledgerApiToken.`;
      } else {
        message = err.message;
      }
      this._send({ type: 'error', message });
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

    // Every non-downloads provider goes through the same ledger search call
    // — a new provider needs zero changes here, just its own registry entry
    // on the worker side.
    for (const providerId of requestedProviders) {
      if (providerId === 'downloads' || !this._ledgerWriter?.searchImageProviders) continue;
      try {
        const result = await this._ledgerWriter.searchImageProviders({
          query: cleanQuery,
          providers: [providerId],
          perPage: 12
        });
        results.push(...this._prepareProviderResultsForPanel(result?.results));
      } catch (err) {
        const label = this._providerLabel(providerId);
        this._send({ type: 'providerNotice', message: `${label} search skipped: ${err.message}` });
      }
    }

    this._send({ type: 'providerResults', query: cleanQuery, providers: requestedProviders, results });
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
    try {
      this._log('[OAT] _handlePlace called with image: ' + (image?.name || image?.slug || 'unknown'));

      const editor = vscode.window.activeTextEditor;
      this._log('[OAT] Editor found: ' + (!!editor));
      if (!editor) {
        vscode.window.showWarningMessage('OAT: Open the target markdown draft before placing a notebook image.');
        return null;
      }

      if (!isMarkdownDraft(editor)) {
        vscode.window.showWarningMessage('OAT: Open a markdown draft before placing a notebook image.');
        return null;
      }

      this._log('[OAT] Editor path: ' + (editor?.document?.uri?.fsPath || '(none)'));
      const target = placementTargetFromEditor(editor);
      this._log('[OAT] Placement target: ' + target);
      if (!target) {
        vscode.window.showWarningMessage('OAT: Open a Substack draft under substack-unpublished/ (or a carousel draft ending in carousel.md) before placing.');
        return null;
      }

      if (!hasDirectPlacementLedgerMethods(this._ledgerWriter)) {
        vscode.window.showWarningMessage('OAT: Set oatImages.ledgerApiUrl before placing figures.');
        return null;
      }

      this._log('[OAT] Building content draft...');
      const contentDraft = buildContentDraftRecord({ vscode, editor });
      this._log('[OAT] Content draft built: ' + contentDraft.id);

      this._log('[OAT] Getting figure number...');
      const figureNumber = await nextFigureNumber({ editor, ledgerWriter: this._ledgerWriter, contentDraftId: contentDraft.id });
      this._log('[OAT] Figure number: ' + figureNumber);

      const caption = captionSuggestionForImage(image);
      this._log('[OAT] Caption: ' + caption);

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
      this._log('[OAT] Placement object created');

      const saga = {
        id: sagaId(placement.id),
        assetId: image.id,
        assetPlacementId: placement.id,
        currentStep: 1,
        status: 'running',
        resolution: 'auto-retry',
        compensation: 'Ready for local placement saga'
      };
      this._log('[OAT] Saga object created');

      await this._ledgerWriter.savePlacement({ contentDraft, placement, saga });
      this._log('[OAT] Placement saved to ledger');

      const { series, partDir } = extractSeriesAndPartDir(editor);
      this._log('[OAT] Series: ' + series + ', PartDir: ' + partDir);

      this._log('[OAT] Downloading and pushing image to oat-assets...');
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
      this._log('[OAT] Placement completed');

      vscode.window.showInformationMessage(`OAT: Placed and pushed Figure ${figureNumber} for ${image.displayName || image.name}.`);
      await this._loadStaged();

      return { contentDraft, placement, saga, placed };
    } catch (err) {
      this._log('[OAT] ERROR in _handlePlace: ' + (err?.message || err?.toString()));
      vscode.window.showErrorMessage('OAT: ' + (err?.message || 'Unknown error during placement'));
      throw err;
    }
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

  _providerLabel(providerId) {
    return String(providerId || '')
      .split(/[-_]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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
.tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-panel-background);
  padding: 0;
}
.tab-btn {
  flex: 1; padding: 8px 6px;
  border: none; border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer; font-family: var(--vscode-font-family);
  font-size: 12px;
  opacity: 0.7;
  transition: opacity 0.2s, border-color 0.2s;
}
.tab-btn:hover { opacity: 0.9; }
.tab-btn.active {
  opacity: 1;
  border-bottom-color: var(--vscode-focusBorder, #007acc);
}
.tab-content {
  display: flex; flex-direction: column;
  flex: 1;
}
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
.browse-btn {
  padding: 4px 8px; border: none; border-radius: 3px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer; font-family: var(--vscode-font-family);
  font-size: 12px;
}
.browse-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #555); }
.search-input:disabled,
.search-btn:disabled,
.browse-btn:disabled {
  opacity: 0.55; cursor: not-allowed;
}
.section-title {
  padding: 10px 8px 8px;
  margin-top: 8px;
  border-top: 1px solid var(--vscode-panel-border);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
  text-transform: uppercase;
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

<div class="tabs" id="tabBar">
  <button class="tab-btn active" data-tab="downloads">Downloads</button>
  <button class="tab-btn" data-tab="staged">Staged</button>
</div>

<div class="tab-content" id="downloads-tab">
  <form class="searchbar" id="searchForm">
    <input class="search-input" id="searchInput" type="search" placeholder="Search Downloads">
    <button class="search-btn" type="submit">Search</button>
    <button class="browse-btn" id="browseBtn" type="button" title="Browse all Downloads">⬇ All</button>
  </form>
  <div id="searchStatus" class="search-status" style="display:none"></div>
  <div id="results"></div>
  <div id="status">Loading…</div>
</div>

<div id="providerTabContents"></div>

<div class="tab-content" id="staged-tab" style="display:none">
  <div id="list"></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let images = [];
let providerResults = [];
let availableProviders = [{ id: 'downloads', label: 'Downloads' }];

// Tab switching. Delegated on the tab bar itself (rather than binding each
// button individually) so provider tabs added dynamically after page load
// work without any extra wiring.
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  document.getElementById(tabName + '-tab').style.display = 'flex';
  document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
}

document.getElementById('tabBar').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab);
});

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
  _currentProvider = 'Downloads';
  _currentSearchProvider = 'downloads';
  providerResults = [];
  renderProviderResults('Searching…');
  vscode.postMessage({ type: 'providerSearch', query, providers: ['downloads'] });
});

if (document.getElementById('browseBtn')) {
  document.getElementById('browseBtn').addEventListener('click', event => {
    event.preventDefault();
    _currentProvider = 'Downloads';
    _currentSearchProvider = 'downloads';
    providerResults = [];
    renderProviderResults('Loading Downloads…');
    vscode.postMessage({ type: 'providerSearch', query: '*', providers: ['downloads'] });
  });
}

// Provider tabs (Pexels, Unsplash, Pixabay, ...) are built dynamically from
// the "providers" message rather than hardcoded per provider — see
// buildProviderTab() below, invoked once availableProviders is known.
const builtProviderTabs = new Set();

function buildProviderTab(provider) {
  if (!provider || !provider.id || provider.id === 'downloads' || builtProviderTabs.has(provider.id)) return;
  builtProviderTabs.add(provider.id);
  const label = provider.label || provider.id;

  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab-btn';
  tabBtn.dataset.tab = provider.id;
  tabBtn.textContent = label;
  document.getElementById('tabBar').insertBefore(tabBtn, document.querySelector('[data-tab="staged"]'));

  const container = document.createElement('div');
  container.className = 'tab-content';
  container.id = provider.id + '-tab';
  container.style.display = 'none';
  container.innerHTML =
    '<form class="searchbar" id="' + provider.id + 'Form">' +
      '<input class="search-input" id="' + provider.id + 'Input" type="search" placeholder="Search ' + esc(label) + '">' +
      '<button class="search-btn" type="submit">Search</button>' +
    '</form>' +
    '<div id="' + provider.id + 'Status" class="search-status" style="display:none"></div>' +
    '<div id="' + provider.id + 'Results"></div>';
  document.getElementById('providerTabContents').appendChild(container);

  document.getElementById(provider.id + 'Form').addEventListener('submit', event => {
    event.preventDefault();
    const query = document.getElementById(provider.id + 'Input').value.trim();
    if (!query) return;
    _currentProvider = label;
    _currentSearchProvider = provider.id;
    providerResults = [];
    renderResultsForProvider(provider.id, 'Searching…');
    vscode.postMessage({ type: 'providerSearch', query, providers: [provider.id] });
  });
}

const resultsEl = document.getElementById('results');
const listEl = document.getElementById('list');
const providerTabContentsEl = document.getElementById('providerTabContents');
console.log('[OAT-Webview] Attaching click handlers to:', resultsEl, providerTabContentsEl, listEl);
resultsEl.addEventListener('click', e => {
  console.log('[OAT-Webview] Click on results:', e.target);
  handleCardAction(e);
});
// Delegated: covers every dynamically-built provider results div at once.
providerTabContentsEl.addEventListener('click', e => {
  console.log('[OAT-Webview] Click on provider results:', e.target);
  handleCardAction(e);
});
listEl.addEventListener('click', e => {
  console.log('[OAT-Webview] Click on list:', e.target);
  handleCardAction(e);
});

let _timeoutId = null;
let _lastStagedIndex = null;
let _currentProvider = 'downloads + pexels';
let _currentSearchProvider = 'downloads';

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
    availableProviders.forEach(buildProviderTab);
    renderProviderAvailability();
  } else if (msg.type === 'providerResults') {
    providerResults = msg.results || [];
    if (msg.providers) {
      _currentProvider = msg.providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' + ');
      if (msg.providers.length === 1 && msg.providers[0] !== 'downloads') {
        const label = _currentProvider;
        renderResultsForProvider(msg.providers[0], providerResults.length ? '' : ('No ' + label + ' results.'));
      } else {
        renderProviderResults(providerResults.length ? '' : 'No provider results.');
      }
    } else {
      renderProviderResults(providerResults.length ? '' : 'No provider results.');
    }
  } else if (msg.type === 'providerStaged') {
    if (_lastStagedIndex !== null && providerResults[_lastStagedIndex]) {
      providerResults.splice(_lastStagedIndex, 1);
      _lastStagedIndex = null;
    }
    if (_currentSearchProvider && _currentSearchProvider !== 'downloads' && builtProviderTabs.has(_currentSearchProvider)) {
      renderResultsForProvider(_currentSearchProvider, 'Staged.');
    } else {
      renderProviderResults('Staged.');
    }
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

function renderResults(resultsElementId, statusElementId, message) {
  const results = document.getElementById(resultsElementId);
  const searchStatus = document.getElementById(statusElementId);

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

  results.innerHTML = '<div class="section-title">Showing: ' + _currentProvider + '</div>' + filterableResults.map((img, displayIndex) => {
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

function renderProviderResults(message) {
  return renderResults('results', 'searchStatus', message);
}

function renderResultsForProvider(providerId, message) {
  return renderResults(providerId + 'Results', providerId + 'Status', message);
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
    status.textContent = 'No staged images. Use the search above to find one, or run OAT Images: Intake Local File to add a file from Downloads.';
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

const DRAFT_ROOT_DIRS = ['substack-unpublished', 'substack-published', 'substack-ideas'];

function extractSeriesAndPartDir(editor) {
  const filePath = editor?.document?.uri?.fsPath || '';
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  // Find the draft root (oat-content layout) or legacy substack-ideas/standalone
  const ideaIndex = segments.findIndex(seg => DRAFT_ROOT_DIRS.includes(seg) || seg === 'standalone');
  if (ideaIndex === -1 || ideaIndex + 2 >= segments.length) {
    return { series: '', partDir: '' };
  }

  // Series is the directory after the draft root
  const series = segments[ideaIndex + 1];

  // oat-content layout: series/<article-folder>/<file>.md — partDir comes from
  // the article folder, shortened to its part-NN prefix to match the
  // oat-assets convention (part-10-gwetc-execution → part-10).
  const articleFolder = ideaIndex + 3 < segments.length ? segments[ideaIndex + 2] : '';
  if (articleFolder) {
    const partMatch = articleFolder.match(/^(part-\d+)/i);
    return { series, partDir: partMatch ? partMatch[1].toLowerCase() : articleFolder };
  }

  // Legacy layout: partDir is the filename without .md extension
  const filename = segments[segments.length - 1];
  return { series, partDir: filename.replace(/\.md$/i, '') };
}

function placementTargetFromDraftPath(draftPath) {
  const normalized = String(draftPath || '').replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] || '';

  if (/carousel\.md$/.test(fileName)) return 'carousel';
  if (DRAFT_ROOT_DIRS.some(dir => segments.includes(dir))) return 'substack';
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

  // For provider images (Pexels, etc.), format: title. By photographer | license
  if (image.sourceUrl && !image.sourcePath) {
    const creditParts = [];
    if (image.photographer) creditParts.push(image.photographer);
    if (image.license) creditParts.push(image.license);
    const credit = creditParts.length ? ' By ' + creditParts.join(' | ') : '';
    return title + '.' + credit;
  }

  // For Downloads images, include full attribution
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
