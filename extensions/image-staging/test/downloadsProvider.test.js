'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  searchDownloads,
  stageDownloadsResult,
  inferFilenameHints,
  displayNameFromFileName
} = require('../lib/downloadsProvider');

async function testSearchDownloadsFindsImageFilesAndHints() {
  const dir = tempDir();
  const chatGptFile = path.join(dir, 'ChatGPT Image Jun 2, 2026, 08_40_36 PM.png');
  const svgFile = path.join(dir, 'syntheticBiologyTimeline-publisher-gold.svg');
  fs.writeFileSync(chatGptFile, 'chatgpt image bytes');
  fs.writeFileSync(svgFile, '<svg></svg>');
  fs.writeFileSync(path.join(dir, 'oat-content-inventory.csv'), 'not,image');

  const result = await searchDownloads({ query: 'ChatGPT', downloadsDir: dir });

  assert.strictEqual(result.provider, 'downloads');
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].provider, 'downloads');
  assert.strictEqual(result.results[0].sourcePath, chatGptFile);
  assert.strictEqual(result.results[0].sourceKind, 'ai-generated');
  assert.strictEqual(result.results[0].proposedTool, 'ChatGPT');
  assert.strictEqual(result.results[0].photographer, 'Owen Corpening');
  assert.strictEqual(result.results[0].status, 'staged');
  assert.match(result.results[0].thumbnailUrl, /^data:image\/png;base64,/);
}

async function testSearchDownloadsCanFindSubjectStyleFilenames() {
  const dir = tempDir();
  const filePath = path.join(dir, 'syntheticBiologyTimeline-publisher-gold.svg');
  fs.writeFileSync(filePath, '<svg></svg>');

  const result = await searchDownloads({ query: 'biology', downloadsDir: dir });

  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].sourceKind, 'downloads');
  assert.strictEqual(result.results[0].title, 'Synthetic Biology Timeline publisher gold');
  assert.strictEqual(result.results[0].proposedSubject, 'syntheticBiologyTimeline');
  assert.strictEqual(result.results[0].thumbnailUrl, undefined);
}

async function testStageDownloadsResultBuildsLedgerAsset() {
  const dir = tempDir();
  const filePath = path.join(dir, 'river-map.png');
  fs.writeFileSync(filePath, 'image bytes');

  const asset = await stageDownloadsResult({
    provider: 'downloads',
    providerId: filePath,
    title: 'River Map',
    sourcePath: filePath,
    sourceName: 'river-map.png',
    sourceKind: 'downloads',
    status: 'needs-provenance'
  }, {
    idFactory: { assetId: () => 'asset-downloads' }
  });

  assert.strictEqual(asset.id, 'asset-downloads');
  assert.strictEqual(asset.sourcePath, filePath);
  assert.strictEqual(asset.sourceName, 'river-map.png');
  assert.strictEqual(asset.status, 'needs-provenance');
  assert.strictEqual(asset.contentHash, 'sha256:de7030234493a8bea844dbe1d8676e68a2c1a4b014c721f0425a22b6df66faec');
}

function testFilenameHelpers() {
  const hints = inferFilenameHints('ChatGPT Image Jun 2, 2026, 08_40_36 PM.png');
  assert.strictEqual(hints.tool, 'ChatGPT');
  assert.strictEqual(hints.title, 'ChatGPT Image Jun 2, 2026, 08_40_36 PM');
  assert.strictEqual(displayNameFromFileName('syntheticBiologyTimeline-publisher-gold.svg'), 'Synthetic Biology Timeline publisher gold');
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oat-downloads-provider-'));
}

(async () => {
  await testSearchDownloadsFindsImageFilesAndHints();
  await testSearchDownloadsCanFindSubjectStyleFilenames();
  await testStageDownloadsResultBuildsLedgerAsset();
  testFilenameHelpers();
  console.log('downloadsProvider tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
