'use strict';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function sheetsRequest(env, accessToken, path, options = {}) {
  const fetcher = env.fetch || globalThis.fetch;
  const response = await fetcher(`${SHEETS_API_BASE}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Sheets API request failed: HTTP ${response.status} — ${body}`);
  }
  return body ? JSON.parse(body) : {};
}

async function getValues(env, accessToken, sheetId, range) {
  return sheetsRequest(env, accessToken, `${sheetId}/values/${encodeURIComponent(range)}`, { method: 'GET' });
}

async function batchUpdateValues(env, accessToken, sheetId, data) {
  return sheetsRequest(env, accessToken, `${sheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data })
  });
}

async function appendValues(env, accessToken, sheetId, range, rows) {
  const path = `${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return sheetsRequest(env, accessToken, path, {
    method: 'POST',
    body: JSON.stringify({ values: rows })
  });
}

module.exports = { getValues, batchUpdateValues, appendValues };
