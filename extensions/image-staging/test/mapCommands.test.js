'use strict';

const assert = require('assert');
const {
  parseCorridorDescription,
  geocodeWaypoints,
  buildCorridorMapHtml
} = require('../lib/mapCommands');

function testParseCorridorDescriptionSplitsOnArrowAndExtractsLabel() {
  const waypoints = parseCorridorDescription('Alexandria (Mediterranean desal) → Cairo → Aswan');
  assert.deepStrictEqual(waypoints, [
    { name: 'Alexandria', label: 'Mediterranean desal', geocodeQuery: 'Alexandria' },
    { name: 'Cairo', label: '', geocodeQuery: 'Cairo' },
    { name: 'Aswan', label: '', geocodeQuery: 'Aswan' }
  ]);
}

function testParseCorridorDescriptionAcceptsAsciiArrow() {
  const waypoints = parseCorridorDescription('Tunis (desal) -> Annaba -> Constantine');
  assert.strictEqual(waypoints.length, 3);
  assert.strictEqual(waypoints[0].name, 'Tunis');
  assert.strictEqual(waypoints[0].label, 'desal');
}

function testParseCorridorDescriptionKeepsCountryInGeocodeQueryOnly() {
  const waypoints = parseCorridorDescription('Alexandria, Egypt (Mediterranean desal) → Cairo → Aswan');
  assert.deepStrictEqual(waypoints[0], {
    name: 'Alexandria',
    label: 'Mediterranean desal',
    geocodeQuery: 'Alexandria, Egypt'
  });
}

function testParseCorridorDescriptionRejectsSingleNode() {
  assert.throws(() => parseCorridorDescription('Just one place'), /at least two places/);
}

function testParseCorridorDescriptionRejectsEmpty() {
  assert.throws(() => parseCorridorDescription(''), /at least two places/);
}

async function testGeocodeWaypointsResolvesInOrder() {
  const waypoints = [
    { name: 'Alexandria', label: 'desal', geocodeQuery: 'Alexandria' },
    { name: 'Cairo', label: '', geocodeQuery: 'Cairo' }
  ];
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    const isAlexandria = url.includes('Alexandria');
    return {
      ok: true,
      json: async () => [{ lat: isAlexandria ? '31.2' : '30.0', lon: isAlexandria ? '29.9' : '31.2' }]
    };
  };

  const { nodes, unresolved } = await geocodeWaypoints(waypoints, { fetchFn, throttleMs: 0 });

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(unresolved.length, 0);
  assert.deepStrictEqual(nodes, [
    { name: 'Alexandria', label: 'desal', lat: 31.2, lng: 29.9 },
    { name: 'Cairo', label: '', lat: 30.0, lng: 31.2 }
  ]);
}

async function testGeocodeWaypointsCollectsUnresolved() {
  const waypoints = [{ name: 'Nowhereville', label: '', geocodeQuery: 'Nowhereville' }];
  const fetchFn = async () => ({ ok: true, json: async () => [] });

  const { nodes, unresolved } = await geocodeWaypoints(waypoints, { fetchFn, throttleMs: 0 });

  assert.strictEqual(nodes.length, 0);
  assert.strictEqual(unresolved.length, 1);
  assert.strictEqual(unresolved[0].name, 'Nowhereville');
  assert.strictEqual(unresolved[0].error, 'No results');
}

async function testGeocodeWaypointsHandlesHttpError() {
  const waypoints = [{ name: 'X', label: '', geocodeQuery: 'X' }];
  const fetchFn = async () => ({ ok: false, status: 503 });

  const { unresolved } = await geocodeWaypoints(waypoints, { fetchFn, throttleMs: 0 });

  assert.strictEqual(unresolved[0].error, 'HTTP 503');
}

function testBuildCorridorMapHtmlIncludesNodesAndStyling() {
  const html = buildCorridorMapHtml({
    corridorName: 'Egypt Sovereignty Corridor',
    nodes: [
      { name: 'Alexandria', label: 'desal', lat: 31.2, lng: 29.9 },
      { name: 'Cairo', label: '', lat: 30.0, lng: 31.2 },
      { name: 'Aswan', label: '', lat: 24.1, lng: 32.9 }
    ]
  });

  assert.ok(html.includes('#0a9396'), 'includes brand teal line color');
  assert.ok(html.includes('#005f73'), 'includes brand deep-water-blue node color');
  assert.ok(html.includes('Alexandria (desal)'));
  assert.ok(html.includes('window.__mapReady = false'));
  assert.ok(html.includes("tileLayer.on('load'"), 'wires map-ready flag to tile load event');
  assert.ok(html.includes('Egypt Sovereignty Corridor'));
}

function testBuildCorridorMapHtmlRequiresAtLeastTwoNodes() {
  assert.throws(
    () => buildCorridorMapHtml({ corridorName: 'X', nodes: [{ name: 'A', lat: 1, lng: 1 }] }),
    /at least two geocoded nodes/
  );
}

function twoNodes() {
  return [
    { name: 'A', label: '', lat: 1, lng: 1 },
    { name: 'B', label: '', lat: 2, lng: 2 }
  ];
}

// zoomSnap must stay 0. At Leaflet's default of 1 every zoom rounds to an
// integer, which silently swallows fractional zoomDelta values and most
// padding changes — the map comes back identical and the knob looks broken.
function testBuildCorridorMapHtmlUsesContinuousZoom() {
  const html = buildCorridorMapHtml({ corridorName: 'X', nodes: twoNodes() });
  assert.ok(html.includes('zoomSnap: 0'), 'continuous zoom so fractional deltas survive');
  assert.ok(html.includes('detectRetina: true'), 'pulls @2x tiles to offset fractional-scale softness');
}

// Two capture races, both of which produced a bad PNG with no error:
// treating the first tile batch as done left unloaded white margins, and the
// tile fade transition left the whole basemap washed out.
function testBuildCorridorMapHtmlWaitsForTilesToSettle() {
  const html = buildCorridorMapHtml({ corridorName: 'X', nodes: twoNodes() });
  assert.ok(html.includes("tileLayer.on('loading'"), 'a new tile batch clears the ready flag');
  assert.ok(html.includes('setTimeout(() => { window.__mapReady = true; }, 400)'), 'ready only after tiles settle');
  assert.ok(html.includes('fadeAnimation: false'), 'no fade transition to capture mid-way through');
}

function testBuildCorridorMapHtmlDefaultsToPlainAutoFit() {
  const html = buildCorridorMapHtml({ corridorName: 'X', nodes: twoNodes() });
  assert.ok(html.includes('padding: [50, 50]'), 'keeps the original 50px fit padding');
  assert.ok(html.includes('if (0 !== 0)'), 'no zoom adjustment applied by default');
}

function testBuildCorridorMapHtmlAppliesZoomDeltaAndPadding() {
  const html = buildCorridorMapHtml({
    corridorName: 'X',
    nodes: twoNodes(),
    padding: 80,
    zoomDelta: 1.25
  });
  assert.ok(html.includes('padding: [80, 80]'));
  assert.ok(html.includes('map.setZoom(map.getZoom() + 1.25)'), 'adjusts relative to the auto-fit');
}

function testBuildCorridorMapHtmlClampsZoomDelta() {
  const html = buildCorridorMapHtml({ corridorName: 'X', nodes: twoNodes(), zoomDelta: 99 });
  assert.ok(html.includes('+ 4)'), 'clamps runaway zoom to the supported range');
}

// A cleared number input arrives as '' and Number('') is 0, but NaN is one
// keystroke away ('-', '1e'). A NaN zoom renders as a blank tile field with
// no error, so it must never reach the template.
function testBuildCorridorMapHtmlIgnoresNonNumericFraming() {
  const html = buildCorridorMapHtml({
    corridorName: 'X',
    nodes: twoNodes(),
    padding: 'abc',
    zoomDelta: NaN
  });
  assert.ok(!html.includes('NaN'), 'never emits NaN into the map script');
  assert.ok(html.includes('padding: [50, 50]'), 'falls back to the default padding');
  assert.ok(html.includes('if (0 !== 0)'), 'falls back to no zoom adjustment');
}

function testBuildCorridorMapHtmlEscapesCorridorNameInTitle() {
  const html = buildCorridorMapHtml({
    corridorName: 'A & B <corridor>',
    nodes: [
      { name: 'A', label: '', lat: 1, lng: 1 },
      { name: 'B', label: '', lat: 2, lng: 2 }
    ]
  });
  assert.ok(html.includes('<title>GWETC — A &amp; B &lt;corridor&gt;</title>'));
}

(async () => {
  testParseCorridorDescriptionSplitsOnArrowAndExtractsLabel();
  testParseCorridorDescriptionAcceptsAsciiArrow();
  testParseCorridorDescriptionKeepsCountryInGeocodeQueryOnly();
  testParseCorridorDescriptionRejectsSingleNode();
  testParseCorridorDescriptionRejectsEmpty();
  await testGeocodeWaypointsResolvesInOrder();
  await testGeocodeWaypointsCollectsUnresolved();
  await testGeocodeWaypointsHandlesHttpError();
  testBuildCorridorMapHtmlIncludesNodesAndStyling();
  testBuildCorridorMapHtmlRequiresAtLeastTwoNodes();
  testBuildCorridorMapHtmlUsesContinuousZoom();
  testBuildCorridorMapHtmlWaitsForTilesToSettle();
  testBuildCorridorMapHtmlDefaultsToPlainAutoFit();
  testBuildCorridorMapHtmlAppliesZoomDeltaAndPadding();
  testBuildCorridorMapHtmlClampsZoomDelta();
  testBuildCorridorMapHtmlIgnoresNonNumericFraming();
  testBuildCorridorMapHtmlEscapesCorridorNameInTitle();
  console.log('mapCommands tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
