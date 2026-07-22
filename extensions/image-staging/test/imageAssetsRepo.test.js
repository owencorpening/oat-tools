'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createRepoAsset,
  createPlacedAsset,
  writeProviderComplianceFiles,
  removePlacedAssetBySourceUrl,
  buildRawGitHubBase,
  guessExt
} = require('../lib/imageAssetsRepo');

function testCreateRepoAsset() {
  const repoPath = tempRepo();
  const asset = createRepoAsset({
    repoPath,
    series: 'water-series',
    partDir: 'part-09',
    slug: 'river-map',
    fileName: 'part09-table-river-map-preview.png',
    rawOwner: 'example',
    rawRepo: 'assets',
    rawBranch: 'preview',
    asset: {
      sourceUrl: 'https://example.com/source/river-map',
      photographer: 'Owen Corpening',
      license: 'OAT rights'
    }
  });

  assert.strictEqual(asset.relPath, 'water-series/part-09/river-map');
  assert.strictEqual(asset.fileName, 'part09-table-river-map-preview.png');
  assert.strictEqual(
    asset.rawAssetUrl,
    'https://raw.githubusercontent.com/example/assets/preview/water-series/part-09/river-map/part09-table-river-map-preview.png'
  );
  assert.strictEqual(fs.readFileSync(path.join(asset.assetDir, 'url.txt'), 'utf8'), 'https://example.com/source/river-map');
  assert.strictEqual(fs.readFileSync(path.join(asset.assetDir, 'photographer.txt'), 'utf8'), 'Owen Corpening');
  assert.strictEqual(fs.readFileSync(path.join(asset.assetDir, 'license.txt'), 'utf8'), 'OAT rights');
}

function testCreatePlacedAssetCompatibility() {
  const repoPath = tempRepo();
  const asset = createPlacedAsset({
    repoPath,
    series: 'water-series',
    partDir: 'part-09',
    slug: 'source-photo',
    image: {
      sourceUrl: 'https://example.com/source-photo.webp',
      photographer: 'A',
      license: 'CC'
    }
  });

  assert.strictEqual(asset.relPath, 'water-series/part-09/source-photo');
  assert.strictEqual(asset.fileName, 'source-photo.webp');
  assert.strictEqual(asset.imagePath, path.join(repoPath, 'water-series', 'part-09', 'source-photo', 'source-photo.webp'));
  assert.strictEqual(asset.imageUrl, 'https://raw.githubusercontent.com/owencorpening/oat-assets/main/water-series/part-09/source-photo/source-photo.webp');
}

function testRemovePlacedAssetBySourceUrl() {
  const repoPath = tempRepo();
  createPlacedAsset({
    repoPath,
    series: 'water-series',
    partDir: 'part-09',
    slug: 'discard-me',
    image: {
      sourceUrl: 'https://example.com/discard-me.jpg',
      photographer: 'A',
      license: 'CC'
    }
  });

  const result = removePlacedAssetBySourceUrl({
    repoPath,
    series: 'water-series',
    placedIn: 'part-09',
    sourceUrl: 'https://example.com/discard-me.jpg'
  });

  assert.strictEqual(result.status, 'removed');
  assert.strictEqual(result.slug, 'discard-me');
  assert(!fs.existsSync(path.join(repoPath, 'water-series', 'part-09', 'discard-me')));
}

function testWriteProviderComplianceFiles() {
  const assetDir = tempRepo();

  writeProviderComplianceFiles(assetDir, {
    providerId: 'eOvv6TjnSjc',
    photographer: 'İrem Çevik',
    photographerUrl: 'https://unsplash.com/@irem-cevik',
    retrievedAt: '2026-07-21T00:00:00.000Z',
    rawProviderRecord: { id: 'eOvv6TjnSjc', width: 3456 },
    pingedAt: '2026-07-21T00:05:00.000Z'
  });

  assert.strictEqual(fs.readFileSync(path.join(assetDir, 'unsplash_photo_id.txt'), 'utf8'), 'eOvv6TjnSjc');
  assert.strictEqual(fs.readFileSync(path.join(assetDir, 'photographer_url.txt'), 'utf8'), 'https://unsplash.com/@irem-cevik');
  assert.strictEqual(fs.readFileSync(path.join(assetDir, 'retrieved_at.txt'), 'utf8'), '2026-07-21T00:00:00.000Z');
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(assetDir, 'api_response.json'), 'utf8')),
    { id: 'eOvv6TjnSjc', width: 3456 }
  );
  assert.strictEqual(
    fs.readFileSync(path.join(assetDir, 'attribution_text.txt'), 'utf8'),
    'Photo by İrem Çevik on Unsplash (https://unsplash.com/@irem-cevik)'
  );
  assert.strictEqual(
    fs.readFileSync(path.join(assetDir, 'download_location_pinged.txt'), 'utf8'),
    'true\n2026-07-21T00:05:00.000Z\n'
  );
}

function testSmallHelpers() {
  assert.strictEqual(guessExt('https://example.com/a.jpeg?download=1'), '.jpg');
  assert.strictEqual(guessExt('https://example.com/a'), '.jpg');
  assert.strictEqual(
    buildRawGitHubBase({ owner: 'o', repo: 'r', branch: 'b', relDir: 'x/y' }),
    'https://raw.githubusercontent.com/o/r/b/x/y'
  );
}

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oat-assets-repo-'));
}

testCreateRepoAsset();
testCreatePlacedAssetCompatibility();
testRemovePlacedAssetBySourceUrl();
testWriteProviderComplianceFiles();
testSmallHelpers();
console.log('imageAssetsRepo tests passed');
