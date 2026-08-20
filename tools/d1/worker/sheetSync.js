'use strict';

const ledger = require('../../../extensions/image-staging/lib/assetLedgerD1');
const { getAccessToken } = require('./googleServiceAccountAuth');
const { getValues, batchUpdateValues, appendValues } = require('./sheetsClient');

const SHEET_NAME = 'Sheet1';

function buildSyncPlan(assets, sheetValues) {
  const rowByUrl = {};
  for (let i = 1; i < sheetValues.length; i++) {
    const rowUrl = String((sheetValues[i] || [])[2] || '').trim();
    if (rowUrl && !(rowUrl in rowByUrl)) rowByUrl[rowUrl] = i + 1; // 1-indexed sheet row
  }

  const updates = [];
  const appendRows = [];

  assets.forEach(asset => {
    const sourceUrl = String(asset.source_url || '').trim();
    if (!sourceUrl) return;
    if (asset.status === 'discarded' && !rowByUrl[sourceUrl]) return;

    const status = asset.placement_status === 'placed' ? 'placed' : asset.status;
    const placedIn = asset.draft_title || asset.draft_path || '';
    const placedDate = asset.placement_status === 'placed' && asset.placement_updated_at
      ? String(asset.placement_updated_at).slice(0, 10) : '';
    const target = asset.placement_target || '';
    const postTitle = asset.draft_title || asset.intake_section || '';

    const rowIndex = rowByUrl[sourceUrl];
    if (rowIndex) {
      const existingRow = sheetValues[rowIndex - 1] || [];
      updates.push({ row: rowIndex, statusCols: [status, placedIn, placedDate, target] });
      if (!existingRow[5] && postTitle) updates.push({ row: rowIndex, fillF: postTitle });
      if (!existingRow[11] && asset.image_src) updates.push({ row: rowIndex, fillL: asset.image_src });
    } else {
      appendRows.push([
        asset.created_at ? new Date(asset.created_at).toISOString() : new Date().toISOString(),
        asset.source_name || asset.slug || asset.display_name || '',
        sourceUrl,
        asset.photographer || 'UNKNOWN',
        asset.license || '',
        postTitle,
        asset.attribution || '',
        status,
        placedIn,
        placedDate,
        target,
        asset.image_src || ''
      ]);
    }
  });

  return { updates, appendRows };
}

function updatesToBatchData(updates) {
  return updates.map(u => {
    if (u.statusCols) return { range: `${SHEET_NAME}!H${u.row}:K${u.row}`, values: [u.statusCols] };
    if (u.fillF !== undefined) return { range: `${SHEET_NAME}!F${u.row}`, values: [[u.fillF]] };
    return { range: `${SHEET_NAME}!L${u.row}`, values: [[u.fillL]] };
  });
}

async function syncLedgerToSheet(env) {
  if (!env.SHEET_ID) throw new Error('SHEET_ID not set');

  const accessToken = await getAccessToken(env);
  const assets = await ledger.listAssets(env.DB);
  const sheetData = await getValues(env, accessToken, env.SHEET_ID, SHEET_NAME);
  const sheetValues = sheetData.values || [];

  const { updates, appendRows } = buildSyncPlan(assets, sheetValues);

  if (updates.length) {
    await batchUpdateValues(env, accessToken, env.SHEET_ID, updatesToBatchData(updates));
  }
  if (appendRows.length) {
    await appendValues(env, accessToken, env.SHEET_ID, SHEET_NAME, appendRows);
  }

  const updatedRows = new Set(updates.filter(u => u.statusCols).map(u => u.row)).size;
  return { updated: updatedRows, appended: appendRows.length, total: assets.length };
}

module.exports = { SHEET_NAME, buildSyncPlan, syncLedgerToSheet };
