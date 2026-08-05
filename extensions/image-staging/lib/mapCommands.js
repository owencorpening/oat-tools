'use strict';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'oat-image-staging (github.com/owencorpening/oat-tools)';
// Nominatim's usage policy caps free/unauthenticated use at ~1 request/sec —
// a corridor has a handful of waypoints, so a fixed delay between sequential
// requests is simpler than a token-bucket for what's a rare, small burst.
const NOMINATIM_THROTTLE_MS = 1100;

const NODE_COLOR = '#005f73'; // Deep Water Blue, table-style-standard.md
const LINE_COLOR = '#0a9396'; // Teal, table-style-standard.md

// Leaflet's default zoomSnap of 1 rounds every zoom to an integer, which
// makes both framing knobs unusable: fitBounds picks the largest integer
// zoom that fits, so padding changes are swallowed unless they happen to
// cross a level boundary, and a fractional zoomDelta rounds away entirely.
// The only zoom step available would be a 2x jump. zoomSnap 0 makes both
// continuous. Its cost is that tiles land on fractional scales and soften —
// paid for by detectRetina below, which pulls @2x tiles (the {r} slot in the
// URL template) so there are pixels to spare when they're scaled.
const ZOOM_SNAP = 0;
const MAX_ZOOM_DELTA = 4;

// How long tile loading must stay quiet before the map counts as ready. Long
// enough to bridge the gap between two back-to-back tile batches, short enough
// that it stays well inside mapScreenshot's ready timeout.
const TILE_SETTLE_MS = 400;

// Coerces a caller-supplied number, falling back when it isn't finite so a
// stray '' or NaN from the panel's number input can't produce a map with a
// NaN zoom (which Leaflet renders as a blank tile field, not an error).
function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

// Splits a corridor description like "Alexandria, Egypt (Mediterranean
// desal) → Cairo → Aswan" into ordered waypoints. This is the same
// arrow-delimited shorthand already used for corridor descriptions in
// article prose, so a plain parser is more reliable here than another
// AI-JSON round trip.
//
// A place written as "City, Country" keeps the full string as geocodeQuery
// (Nominatim needs the country — its top hit for a bare city name is often
// the wrong continent) but trims the country back off for name, which is
// what ends up baked into the map label. Otherwise every label on the map
// carries its country, which is redundant on a single-country corridor map
// and is what pushed "Alexandria, Egypt (Mediterranean desal)" past the
// edge of a narrower canvas.
function parseCorridorDescription(text) {
  const segments = String(text || '')
    .split(/→|->/)
    .map(segment => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    throw new Error('Need at least two places separated by "→" or "->", e.g. "Alexandria, Egypt (desal) → Cairo → Aswan".');
  }

  return segments.map(segment => {
    const match = segment.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const core = match ? match[1].trim() : segment;
    const label = match ? match[2].trim() : '';
    const commaIdx = core.indexOf(',');
    const name = commaIdx === -1 ? core : core.slice(0, commaIdx).trim();
    return { name, label, geocodeQuery: core };
  });
}

// Resolves each waypoint's geocodeQuery to real coordinates via Nominatim,
// sequentially and throttled per its usage policy. Waypoints that can't be
// resolved are collected separately rather than thrown on immediately, so
// the caller can report exactly which place name failed.
async function geocodeWaypoints(waypoints, { fetchFn = fetch, throttleMs = NOMINATIM_THROTTLE_MS } = {}) {
  const nodes = [];
  const unresolved = [];

  for (let i = 0; i < waypoints.length; i++) {
    if (i > 0) await sleep(throttleMs);

    const waypoint = waypoints[i];
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(waypoint.geocodeQuery)}`;
    let response;
    try {
      response = await fetchFn(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
    } catch (err) {
      unresolved.push({ ...waypoint, error: err.message });
      continue;
    }

    if (!response.ok) {
      unresolved.push({ ...waypoint, error: `HTTP ${response.status}` });
      continue;
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      unresolved.push({ ...waypoint, error: 'No results' });
      continue;
    }

    nodes.push({
      name: waypoint.name,
      label: waypoint.label,
      lat: Number(results[0].lat),
      lng: Number(results[0].lon)
    });
  }

  return { nodes, unresolved };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Same Leaflet + CARTO Voyager template used for the one-off corridor maps
// generated earlier (egyptSovereigntyCorridor.html etc.), parameterized.
// Stamps window.__mapReady once tiles finish loading so a headless capture
// can wait for it instead of guessing a fixed delay.
//
// padding is the fitBounds margin in px (the auto-fit baseline); zoomDelta
// pushes past that fit, positive tighter. See ZOOM_SNAP below for why the
// two are continuous rather than integer zoom steps.
function buildCorridorMapHtml({ corridorName, nodes, width = 700, height = 440, padding = 50, zoomDelta = 0 }) {
  if (!Array.isArray(nodes) || nodes.length < 2) {
    throw new Error('buildCorridorMapHtml requires at least two geocoded nodes.');
  }

  const fitPadding = clampNumber(padding, 0, 200, 50);
  const zoomAdjust = clampNumber(zoomDelta, -MAX_ZOOM_DELTA, MAX_ZOOM_DELTA, 0);

  const nodesJson = JSON.stringify(nodes.map(n => ({
    name: n.label ? `${n.name} (${n.label})` : n.name,
    lat: n.lat,
    lng: n.lng
  })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GWETC — ${escapeHtml(corridorName)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body { margin: 0; padding: 0; }
  #map { width: ${width}px; height: ${height}px; font-family: Arial, sans-serif; }
  .corridor-label {
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: #2C2C2A;
    text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;
    white-space: nowrap;
  }
  .corridor-legend {
    background: #fff;
    padding: 8px 10px;
    border-radius: 4px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    font-family: Arial, sans-serif;
    font-size: 12px;
    color: #2C2C2A;
    line-height: 1.6;
  }
  .corridor-legend .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: ${LINE_COLOR};
    margin-right: 6px;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  window.__mapReady = false;

  const NODE_COLOR = '${NODE_COLOR}';
  const LINE_COLOR = '${LINE_COLOR}';
  const CORRIDOR_NAME = ${JSON.stringify(corridorName)};
  const nodes = ${nodesJson};

  // fadeAnimation off: Leaflet fades tiles in over ~200ms of CSS opacity, but
  // the tile 'load' event that sets __mapReady fires when the images decode,
  // not when that transition ends — so a headless capture reliably catches the
  // basemap part-way through the fade and writes out a washed-out map. Nothing
  // here is animated for a human, so removing the transition makes the ready
  // flag mean what the screenshot needs it to mean.
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    zoomSnap: ${ZOOM_SNAP},
    fadeAnimation: false
  });

  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    detectRetina: true,
    maxZoom: 19
  }).addTo(map);

  // 'load' fires per completed batch, not once per map. Leaflet requests a
  // viewport's worth of tiles, and panning/zooming (or just a slow outer ring)
  // queues further batches — so treating the first 'load' as done captured a
  // map with unloaded white margins. Instead, 'loading' clears the flag and
  // 'load' only arms it, with a settle delay so a batch that is immediately
  // followed by another never reports ready in the gap between them.
  let readyTimer = null;
  tileLayer.on('loading', () => {
    window.__mapReady = false;
    clearTimeout(readyTimer);
  });
  tileLayer.on('load', () => {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => { window.__mapReady = true; }, ${TILE_SETTLE_MS});
  });

  const latlngs = nodes.map(n => [n.lat, n.lng]);

  L.polyline(latlngs, { color: LINE_COLOR, weight: 3, opacity: 0.9 }).addTo(map);

  nodes.forEach((n, i) => {
    L.circleMarker([n.lat, n.lng], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: NODE_COLOR,
      fillOpacity: 1
    }).addTo(map);

    L.marker([n.lat, n.lng], {
      icon: L.divIcon({
        className: 'corridor-label',
        html: n.name,
        iconAnchor: [-10, i % 2 === 0 ? -8 : -14]
      }),
      interactive: false
    }).addTo(map);
  });

  // fitBounds first so zoomDelta is always relative to the auto-fit, then
  // adjust around the same center. Both run synchronously before any tile
  // request settles, so __mapReady still flips once, on the final view.
  map.fitBounds(latlngs, { padding: [${fitPadding}, ${fitPadding}] });
  if (${zoomAdjust} !== 0) map.setZoom(map.getZoom() + ${zoomAdjust});

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'corridor-legend');
    div.innerHTML = '<span class="dot"></span>' + CORRIDOR_NAME;
    return div;
  };
  legend.addTo(map);
</script>
</body>
</html>
`;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

module.exports = {
  parseCorridorDescription,
  geocodeWaypoints,
  buildCorridorMapHtml
};
