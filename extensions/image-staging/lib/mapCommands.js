'use strict';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'oat-image-staging (github.com/owencorpening/oat-tools)';
// Nominatim's usage policy caps free/unauthenticated use at ~1 request/sec —
// a corridor has a handful of waypoints, so a fixed delay between sequential
// requests is simpler than a token-bucket for what's a rare, small burst.
const NOMINATIM_THROTTLE_MS = 1100;

const NODE_COLOR = '#005f73'; // Deep Water Blue, table-style-standard.md
const LINE_COLOR = '#0a9396'; // Teal, table-style-standard.md

// Splits a corridor description like "Alexandria (Mediterranean desal) →
// Cairo → Aswan" into ordered waypoints. This is the same arrow-delimited
// shorthand already used for corridor descriptions in article prose, so a
// plain parser is more reliable here than another AI-JSON round trip.
function parseCorridorDescription(text) {
  const segments = String(text || '')
    .split(/→|->/)
    .map(segment => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    throw new Error('Need at least two places separated by "→" or "->", e.g. "Alexandria (desal) → Cairo → Aswan".');
  }

  return segments.map(segment => {
    const match = segment.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (match) {
      return { name: match[1].trim(), label: match[2].trim(), geocodeQuery: match[1].trim() };
    }
    return { name: segment, label: '', geocodeQuery: segment };
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

// Same Leaflet + CARTO Positron template used for the one-off corridor maps
// generated earlier (egyptSovereigntyCorridor.html etc.), parameterized.
// Stamps window.__mapReady once tiles finish loading so a headless capture
// can wait for it instead of guessing a fixed delay.
function buildCorridorMapHtml({ corridorName, nodes, width = 700, height = 440 }) {
  if (!Array.isArray(nodes) || nodes.length < 2) {
    throw new Error('buildCorridorMapHtml requires at least two geocoded nodes.');
  }

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

  const map = L.map('map', { zoomControl: false, attributionControl: true });

  const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  tileLayer.on('load', () => { window.__mapReady = true; });

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

  map.fitBounds(latlngs, { padding: [50, 50] });

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
