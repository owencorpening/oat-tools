'use strict';

const https = require('https');

const DEFAULT_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

// request is injectable so callers/tests don't have to hit the real API —
// mirrors the requestJson injection pattern in ledgerApiClient.js.
function callClaude({
  apiKey,
  model,
  system,
  userText,
  maxTokens = 1024,
  apiUrl = DEFAULT_API_URL,
  anthropicVersion = DEFAULT_ANTHROPIC_VERSION
} = {}, { request = postJson } = {}) {
  if (!apiKey) {
    return Promise.reject(new Error('Anthropic API key not set (oatImages.anthropicApiKey).'));
  }

  return request(apiUrl, {
    apiKey,
    anthropicVersion,
    body: {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }]
    }
  }).then(extractText);
}

function extractText(response) {
  return (response.content || [])
    .filter(block => block && block.type === 'text')
    .map(block => block.text)
    .join('');
}

function postJson(url, { apiKey, anthropicVersion, body }) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': anthropicVersion,
        'content-length': Buffer.byteLength(bodyStr)
      },
      timeout: 60000
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          reject(new Error(`Claude API returned non-JSON: ${data.slice(0, 200)}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error((parsed.error && parsed.error.message) || `Claude API HTTP ${res.statusCode}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Claude API request timeout (60s)')));
    req.write(bodyStr);
    req.end();
  });
}

module.exports = { callClaude, postJson, extractText, DEFAULT_API_URL, DEFAULT_ANTHROPIC_VERSION };
