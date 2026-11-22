'use strict';

// Series records: one small JSON file in oat-content, read from main.
//
//   site/series.json
//   [
//     { "id": "water", "name": "Water Resilience", "description": "...", "order": 1 }
//   ]
//
// Only metadata lives here. A series is shown only if it has at least one
// published article, so a planned series stays invisible.

const { execFileSync } = require('child_process');

const SERIES_FILE = 'site/series.json';

// Articles with no `series` field belong to this series. It was called
// "standalone" until 2026-11-21; the old id still works everywhere (front
// matter `series: standalone`, pub/standalone/... tags) and old
// /standalone/ URLs get redirect pages.
const DEFAULT_SERIES = 'vectors';
const LEGACY_SERIES = new Map([['standalone', DEFAULT_SERIES]]);
const DEFAULT_RECORD = {
  id: DEFAULT_SERIES,
  name: 'Vectors',
  description: 'Single pieces outside a series.',
  order: 1000
};

// Series id for a front matter value or a tag segment.
function normalizeSeriesId(value) {
  const id = value && String(value).trim() ? String(value).trim() : DEFAULT_SERIES;
  return LEGACY_SERIES.get(id) || id;
}

function readSeries(repoDir, mainRef = 'main') {
  let text = null;
  try {
    text = execFileSync('git', ['-C', repoDir, 'show', `${mainRef}:${SERIES_FILE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    text = null; // no series file yet: only default-series articles can build
  }
  const records = new Map([[DEFAULT_RECORD.id, { ...DEFAULT_RECORD }]]);
  if (text === null) return records;

  let list;
  try {
    list = JSON.parse(text);
  } catch (err) {
    throw new Error(`${SERIES_FILE} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(list)) throw new Error(`${SERIES_FILE} must be a JSON list`);
  for (const s of list) {
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) {
      throw new Error(`${SERIES_FILE}: every series needs an id of lowercase letters, digits and hyphens`);
    }
    if (!s.name || !s.description || typeof s.order !== 'number') {
      throw new Error(`${SERIES_FILE}: series "${s.id}" needs name, description and a numeric order`);
    }
    if (LEGACY_SERIES.has(s.id)) {
      throw new Error(`${SERIES_FILE}: "${s.id}" is an old series id; use "${LEGACY_SERIES.get(s.id)}"`);
    }
    records.set(s.id, { id: s.id, name: s.name, description: s.description, order: s.order });
  }
  return records;
}

module.exports = { readSeries, SERIES_FILE, DEFAULT_SERIES, LEGACY_SERIES, normalizeSeriesId };
