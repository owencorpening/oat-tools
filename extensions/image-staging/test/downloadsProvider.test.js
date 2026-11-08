'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  searchDownloads,
  listRecentDownloads,
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

// Bug #1: Draftsman's pickup uses recency, against real files with real
// mtimes — no stubbed search.
async function testListRecentDownloadsNewestFirstWithinWindow() {
  const dir = tempDir();
  const now = Date.parse('2026-11-07T20:00:00Z');
  const minutesAgo = minutes => new Date(now - minutes * 60 * 1000);
  try {
    writeWithMtime(dir, 'ChatGPT Image Nov 7, 2026, 01_55_00 PM.png', minutesAgo(5));
    writeWithMtime(dir, 'gemini-generated-wetland.webp', minutesAgo(90));
    writeWithMtime(dir, 'old-screenshot.png', minutesAgo(3 * 24 * 60)); // outside 24h window
    writeWithMtime(dir, 'notes.txt', minutesAgo(1)); // not an image
    fs.mkdirSync(path.join(dir, 'folder.png')); // a directory, not a file

    const { provider, results } = await listRecentDownloads({ downloadsDir: dir, now });

    assert.strictEqual(provider, 'downloads');
    assert.deepStrictEqual(
      results.map(result => result.sourceName),
      ['ChatGPT Image Nov 7, 2026, 01_55_00 PM.png', 'gemini-generated-wetland.webp'],
      'recent images only, newest first; old files, non-images and directories excluded'
    );
    assert.strictEqual(results[0].sourceKind, 'ai-generated');
    assert.strictEqual(results[1].sourceKind, 'downloads', 'non-ChatGPT generator files are still offered');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testListRecentDownloadsAppliesLimitAfterSorting() {
  const dir = tempDir();
  const now = Date.parse('2026-11-07T20:00:00Z');
  try {
    // Written oldest-name-first so readdir order differs from mtime order.
    writeWithMtime(dir, 'a-oldest.png', new Date(now - 30 * 60 * 1000));
    writeWithMtime(dir, 'b-middle.png', new Date(now - 20 * 60 * 1000));
    writeWithMtime(dir, 'c-newest.png', new Date(now - 10 * 60 * 1000));

    const { results } = await listRecentDownloads({ downloadsDir: dir, now, limit: 2 });
    assert.deepStrictEqual(results.map(result => result.sourceName), ['c-newest.png', 'b-middle.png']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Documents why recency replaced keyword search for Draftsman: the real
// searchDownloads cannot match a paragraph query against a ChatGPT export.
async function testSearchDownloadsCannotMatchParagraphQuery() {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'ChatGPT Image Nov 7, 2026, 01_55_00 PM.png'), 'image bytes');
    const { results } = await searchDownloads({
      query: 'The Edwards Aquifer recharges slowly under karst limestone near San Antonio',
      downloadsDir: dir
    });
    assert.strictEqual(results.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeWithMtime(dir, fileName, mtime) {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'image bytes');
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
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
  await testListRecentDownloadsNewestFirstWithinWindow();
  await testListRecentDownloadsAppliesLimitAfterSorting();
  await testSearchDownloadsCannotMatchParagraphQuery();
  testFilenameHelpers();
  console.log('downloadsProvider tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
