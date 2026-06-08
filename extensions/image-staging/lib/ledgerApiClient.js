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

module.exports = {
  createLedgerApiClient,
  createLedgerWriterFromSettings,
  requestJson
};
