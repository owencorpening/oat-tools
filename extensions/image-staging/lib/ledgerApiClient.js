'use strict';

const http = require('http');
const https = require('https');

function createLedgerApiClient({ baseUrl, token, request = requestJson } = {}) {
  if (!baseUrl) return null;
  const normalizedBase = String(baseUrl).replace(/\/+$/, '');

  return {
    saveReviewImageNeed(payload) {
      return request(`${normalizedBase}/review-image-needs`, {
        method: 'POST',
        token,
        body: payload
      });
    },
    saveAsset(payload) {
      return request(`${normalizedBase}/assets`, {
        method: 'POST',
        token,
        body: payload
      });
    },
    savePlacement(payload) {
      return request(`${normalizedBase}/placements`, {
        method: 'POST',
        token,
        body: payload
      });
    },
    listImageProviders() {
      return request(`${normalizedBase}/image-providers`, {
        method: 'GET',
        token
      });
    },
    searchImageProviders({ query, providers, page, perPage } = {}) {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (providers) params.set('providers', Array.isArray(providers) ? providers.join(',') : providers);
      if (page) params.set('page', String(page));
      if (perPage) params.set('perPage', String(perPage));
      return request(`${normalizedBase}/image-providers/search?${params.toString()}`, {
        method: 'GET',
        token
      });
    },
    stageProviderImage(payload) {
      return request(`${normalizedBase}/captures/provider-image`, {
        method: 'POST',
        token,
        body: payload
      });
    },
    listOpenNeeds({ contentDraftId } = {}) {
      const query = contentDraftId ? `?contentDraftId=${encodeURIComponent(contentDraftId)}` : '';
      return request(`${normalizedBase}/image-needs/open${query}`, {
        method: 'GET',
        token
      });
    },
    listStagedAssets() {
      return request(`${normalizedBase}/assets/staged`, {
        method: 'GET',
        token
      });
    },
    listPlannedPlacements({ contentDraftId } = {}) {
      const query = contentDraftId ? `?contentDraftId=${encodeURIComponent(contentDraftId)}` : '';
      return request(`${normalizedBase}/placements/planned${query}`, {
        method: 'GET',
        token
      });
    },
    markSagaStep(db, sagaId, updates) {
      return request(`${normalizedBase}/sagas/${encodeURIComponent(sagaId)}/step`, {
        method: 'POST',
        token,
        body: updates
      });
    },
    markAssetPublishing(db, assetId) {
      return request(`${normalizedBase}/assets/${encodeURIComponent(assetId)}/publishing`, {
        method: 'POST',
        token
      });
    },
    markPlacementPublishing(db, placementId) {
      return request(`${normalizedBase}/placements/${encodeURIComponent(placementId)}/publishing`, {
        method: 'POST',
        token
      });
    },
    updateAssetPublication(db, { assetId, assetPath, rawAssetUrl } = {}) {
      return request(`${normalizedBase}/assets/${encodeURIComponent(assetId)}/publication`, {
        method: 'POST',
        token,
        body: { assetPath, rawAssetUrl }
      });
    },
    discardAsset(assetId) {
      return request(`${normalizedBase}/assets/${encodeURIComponent(assetId)}/discarded`, {
        method: 'POST',
        token
      });
    },
    recordAssetUse(db, { assetId } = {}) {
      return request(`${normalizedBase}/assets/${encodeURIComponent(assetId)}/record-use`, {
        method: 'POST',
        token
      });
    },
    updatePlacementSnippet(db, { placementId, snippet, snippetFormat } = {}) {
      return request(`${normalizedBase}/placements/${encodeURIComponent(placementId)}/snippet`, {
        method: 'POST',
        token,
        body: { snippet, snippetFormat }
      });
    },
    markPlaced(db, { placementId, assetId, publishedUrl } = {}) {
      return request(`${normalizedBase}/placements/${encodeURIComponent(placementId)}/placed`, {
        method: 'POST',
        token,
        body: { assetId, publishedUrl }
      });
    },
    markFailed(db, { sagaId, error, resolution, nextRetryAt } = {}) {
      return request(`${normalizedBase}/sagas/${encodeURIComponent(sagaId)}/failed`, {
        method: 'POST',
        token,
        body: { error: messageFor(error), resolution, nextRetryAt }
      });
    }
  };
}

function createLedgerWriterFromSettings(vscode) {
  const config = vscode.workspace.getConfiguration('oatImages');
  return createLedgerApiClient({
    baseUrl: config.get('ledgerApiUrl', ''),
    token: config.get('ledgerApiToken', '')
  });
}

function requestJson(url, { method = 'GET', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyText = body === undefined ? undefined : JSON.stringify(body);
    const transport = parsed.protocol === 'http:' ? http : https;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(bodyText ? { 'Content-Length': Buffer.byteLength(bodyText) } : {})
    };

    const req = transport.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers,
      timeout: 10000
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const parsedBody = parseResponseBody(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsedBody);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timeout (10s)')));
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

function parseResponseBody(data) {
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function messageFor(error) {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

module.exports = {
  createLedgerApiClient,
  createLedgerWriterFromSettings,
  requestJson,
  messageFor
};
