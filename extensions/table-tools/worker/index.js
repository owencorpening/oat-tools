'use strict';

const DEEP_WATER_BLUE = { red: 0, green: 0.3725, blue: 0.4510 };
const WHITE            = { red: 1, green: 1, blue: 1 };
const LIGHT_TEAL       = { red: 0.5804, green: 0.8235, blue: 0.7412 };
const ROW_TINT         = { red: 0.9412, green: 0.9686, blue: 0.9725 };
const TOTAL_BG         = { red: 0.9098, green: 0.9569, blue: 0.9608 };

const handler = {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return json({ error: 'POST required' }, 405);
    }

    let title, headers, rows;
    try {
      ({ title, headers, rows } = await request.json());
      if (!title || !headers || !rows) throw new Error('missing fields');
    } catch (e) {
      return json({ error: 'Invalid request body: ' + e.message }, 400);
    }

    try {
      const token = await getAccessToken(env);
      const { spreadsheetId, sheetId } = await createSheet(token, title, headers, rows);
      await applyOatStyle(token, spreadsheetId, sheetId, headers.length, rows.length);
      await makePublic(token, spreadsheetId);
      return json({
        spreadsheetId,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
      });
    } catch (e) {
      if (e instanceof ReauthRequiredError) {
        console.error('OAT table promotion: re-auth required', { message: e.message });
        return json({ error: e.message, reauthRequired: true }, 401);
      }
      console.error('OAT table promotion failed', { message: e.message });
      return json({ error: e.message }, 500);
    }
  }
};

export default handler;
// Named exports for testing (Cloudflare only looks for the default
// export above; these don't affect the deployed Worker at all).
export { handler, getAccessToken, ReauthRequiredError };

// ── Auth ─────────────────────────────────────────────────────────────────────

// The OAuth app ("OAT Table Promotion", project oat-tools-owen) is in
// Google's "Testing" publishing status, which caps refresh token
// lifetime at 7 days regardless of use — this is expected to happen
// periodically, not a bug, until/unless the app is published to
// Production. See ../../../oat-standards/credentials-inventory.md,
// oat-promote-tables-google-refresh-token row.
class ReauthRequiredError extends Error {
  constructor(googleError) {
    super(
      'Google authorization has expired or been revoked (refresh token invalid — ' +
      'expected every ~7 days while this OAuth app is in "Testing" publishing status). ' +
      'Fix: run `node extensions/table-tools/scripts/get-refresh-token.js` from the ' +
      'oat-tools repo root, complete the browser consent flow, then retry. ' +
      `(Google's error: ${googleError})`
    );
    this.name = 'ReauthRequiredError';
  }
}

async function getAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN secret');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();

  if (!data.access_token) {
    // invalid_grant is Google's specific, documented error for an
    // expired or revoked refresh token — distinct from other failure
    // modes (bad client_id/secret, network issues, etc.) that a re-auth
    // wouldn't fix.
    if (data.error === 'invalid_grant') {
      throw new ReauthRequiredError(data.error_description || data.error);
    }
    throw new Error('Token exchange failed: ' + JSON.stringify(data));
  }

  return data.access_token;
}

// ── Sheets ───────────────────────────────────────────────────────────────────

async function createSheet(token, title, headers, rows) {
  const res = await sheetsRequest(token, 'POST', 'spreadsheets', {
    properties: { title },
    sheets: [{ properties: { title: 'Sheet1' } }]
  });
  const { spreadsheetId } = res;
  const sheetId = res.sheets[0].properties.sheetId;

  const values = [headers, ...rows];
  await sheetsRequest(
    token, 'PUT',
    `spreadsheets/${spreadsheetId}/values/A1?valueInputOption=RAW`,
    { values }
  );

  return { spreadsheetId, sheetId };
}

async function applyOatStyle(token, spreadsheetId, sheetId, numCols, numDataRows) {
  const totalRows = numDataRows + 1;

  const requests = [
    // ── Header row ────────────────────────────────────────────────────────
    repeatCell(sheetId, 0, 1, 0, numCols, {
      userEnteredFormat: {
        backgroundColor:  DEEP_WATER_BLUE,
        textFormat:       { foregroundColor: WHITE, bold: true, fontSize: 16, fontFamily: 'Arial' },
        verticalAlignment: 'MIDDLE',
        borders: { bottom: solidBorder(LIGHT_TEAL, 'SOLID_MEDIUM') }
      }
    }),

    // ── Data rows (even / odd) ─────────────────────────────────────────────
    ...buildDataRowRequests(sheetId, numDataRows, numCols),

    // ── Column right-borders ─────────────────────────────────────────────
    ...buildColumnBorders(sheetId, numCols, totalRows),

    // ── Freeze header ────────────────────────────────────────────────────
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }
    },

    // ── Row heights ───────────────────────────────────────────────────────
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: totalRows },
        properties: { pixelSize: 40 },
        fields: 'pixelSize'
      }
    },

    // ── Auto-resize columns ───────────────────────────────────────────────
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: numCols }
      }
    }
  ];

  await sheetsRequest(token, 'POST', `spreadsheets/${spreadsheetId}:batchUpdate`, { requests });
}

function buildDataRowRequests(sheetId, numDataRows, numCols) {
  const reqs = [];
  const lastDataRow = numDataRows; // 1-indexed header at row 0

  for (let i = 0; i < numDataRows; i++) {
    const rowIndex = i + 1;
    const isLast   = i === numDataRows - 1;
    const bg = isLast ? TOTAL_BG : (i % 2 === 0 ? WHITE : ROW_TINT);
    const fmt = {
      backgroundColor: bg,
      textFormat: {
        fontSize: 15,
        fontFamily: 'Arial',
        bold: isLast
      },
      verticalAlignment: 'MIDDLE'
    };
    if (isLast) fmt.borders = { top: solidBorder(LIGHT_TEAL, 'SOLID_MEDIUM') };
    reqs.push(repeatCell(sheetId, rowIndex, rowIndex + 1, 0, numCols, { userEnteredFormat: fmt }));
  }
  return reqs;
}

function buildColumnBorders(sheetId, numCols, totalRows) {
  const reqs = [];
  for (let col = 0; col < numCols - 1; col++) {
    reqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: 0, endRowIndex: totalRows, startColumnIndex: col, endColumnIndex: col + 1 },
        right: solidBorder(LIGHT_TEAL, 'SOLID')
      }
    });
  }
  return reqs;
}

function repeatCell(sheetId, startRow, endRow, startCol, endCol, cell) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
      cell,
      fields: 'userEnteredFormat'
    }
  };
}

function solidBorder(color, style) {
  return { style, colorStyle: { rgbColor: color } };
}

// ── Drive ─────────────────────────────────────────────────────────────────────

async function makePublic(token, spreadsheetId) {
  await driveRequest(token, 'POST', `files/${spreadsheetId}/permissions`, {
    role: 'reader',
    type: 'anyone'
  });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function sheetsRequest(token, method, path, body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API ${path}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

async function driveRequest(token, method, path, body) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive API ${path}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
