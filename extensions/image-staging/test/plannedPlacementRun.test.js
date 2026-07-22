'use strict';

const assert = require('assert');
const {
  buildPlacementRunInput,
  assetFromPlannedRow,
  placementFromPlannedRow,
  parseDraftLocation
} = require('../lib/plannedPlacementRun');

function testBuildPlacementRunInput() {
  const input = buildPlacementRunInput({
    placement_id: 'placement-1',
    placement_asset_id: 'asset-1',
    content_draft_id: 'draft-1',
    target: 'substack',
    figure_number: '3',
    draft_location_json: '{"path":"part-09.md","lineStart":42}',
    snippet_format: 'html-figure',
    placement_status: 'planned',
    asset_id: 'asset-1',
    asset_type: 'image',
    slug: 'river-map',
    display_name: 'River Map',
    source_path: '/home/owen/Downloads/river.jpg',
    source_kind: 'downloads',
    source_url: 'https://example.com/river.jpg',
    image_src: 'https://example.com/river.jpg',
    photographer: 'Owen',
    license: 'OAT',
    intake_section: 'water-series/part-09',
    asset_status: 'staged',
    saga_id: 'saga-1'
  }, {
    repoPath: '/tmp/images',
    download: false,
    commit: false
  });

  assert.strictEqual(input.sagaId, 'saga-1');
  assert.strictEqual(input.repoPath, '/tmp/images');
  assert.strictEqual(input.download, false);
  assert.strictEqual(input.asset.id, 'asset-1');
  assert.strictEqual(input.asset.displayName, 'River Map');
  assert.strictEqual(input.asset.intakeSection, 'water-series/part-09');
  // A planned placement for a Downloads-sourced asset must carry sourceKind
  // through, or placeAsset can't tell it apart from a URL-based asset and
  // will try to re-download it instead of copying + cleaning up the local file.
  assert.strictEqual(input.asset.sourcePath, '/home/owen/Downloads/river.jpg');
  assert.strictEqual(input.asset.sourceKind, 'downloads');
  assert.strictEqual(input.placement.id, 'placement-1');
  assert.strictEqual(input.placement.figureNumber, '3');
  assert.deepStrictEqual(input.placement.draftLocation, { path: 'part-09.md', lineStart: 42 });
}

function testRowHelpersAcceptCamelCase() {
  const asset = assetFromPlannedRow({
    assetId: 'asset-2',
    assetType: 'image',
    slug: 'diagram',
    displayName: 'Diagram',
    sourceUrl: 'https://example.com/diagram.png',
    intakeSection: 'standalone/article',
    assetStatus: 'staged'
  });
  const placement = placementFromPlannedRow({
    placementId: 'placement-2',
    assetId: 'asset-2',
    contentDraftId: 'draft-2',
    target: 'carousel',
    figureNumber: 'A',
    draftLocation: { path: 'deck.md' },
    snippetFormat: 'marp-image'
  });

  assert.strictEqual(asset.id, 'asset-2');
  assert.strictEqual(asset.displayName, 'Diagram');
  assert.strictEqual(placement.id, 'placement-2');
  assert.deepStrictEqual(placement.draftLocation, { path: 'deck.md' });
}

function testValidation() {
  assert.throws(() => buildPlacementRunInput({}), /asset\.id/);
  assert.strictEqual(parseDraftLocation('{not json'), '{not json');
}

testBuildPlacementRunInput();
testRowHelpersAcceptCamelCase();
testValidation();
console.log('plannedPlacementRun tests passed');
