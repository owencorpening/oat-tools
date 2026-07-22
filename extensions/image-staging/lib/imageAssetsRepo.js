'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const cp = require('child_process');

function createRepoAsset({
  repoPath,
  asset,
  series = 'water-series',
  partDir,
  slug = asset && asset.slug,
  fileName,
  rawOwner = 'owencorpening',
  rawRepo = 'oat-assets',
  rawBranch = 'main'
}) {
  requireValue(repoPath, 'repoPath');
  requireValue(series, 'series');
  requireValue(partDir, 'partDir');
  requireValue(slug, 'slug');

  const assetDir = path.join(repoPath, series, partDir, slug);
  fs.mkdirSync(assetDir, { recursive: true });

  writeProvenanceFiles(assetDir, asset || {});

  const downloadSrc = asset && (asset.imageSrc || asset.thumbUrl || asset.sourceUrl || asset.url);
  const resolvedFileName = fileName || `${slug}${guessExt(downloadSrc)}`;
  const localPath = path.join(assetDir, resolvedFileName);
  const relDir = path.posix.join(series, partDir, slug);
  const rawBase = buildRawGitHubBase({ owner: rawOwner, repo: rawRepo, branch: rawBranch, relDir });
  const rawAssetUrl = `${rawBase}/${resolvedFileName}`;

  return {
    assetDir,
    imageDir: assetDir,
    localPath,
    imagePath: localPath,
    downloadSrc,
    fileName: resolvedFileName,
    relPath: relDir,
    rawAssetUrl,
    imageUrl: rawAssetUrl
  };
}

function createPlacedAsset({ repoPath, image, series = 'water-series', partDir, slug }) {
  return createRepoAsset({ repoPath, asset: image, series, partDir, slug });
}

function writeProvenanceFiles(assetDir, asset) {
  fs.writeFileSync(path.join(assetDir, 'url.txt'), asset.sourceUrl || asset.url || '');
  fs.writeFileSync(path.join(assetDir, 'photographer.txt'), asset.photographer || '');
  fs.writeFileSync(path.join(assetDir, 'license.txt'), asset.license || '');
}

// Writes provider-specific compliance files on top of the generic
// provenance files above. Callers must only invoke this after any required
// use-time API action (e.g. Unsplash's download_location ping) has already
// succeeded — download_location_pinged.txt is a receipt, not a request.
function writeProviderComplianceFiles(assetDir, {
  providerId,
  photographerUrl,
  retrievedAt,
  rawProviderRecord,
  attributionText,
  pingedAt
} = {}) {
  fs.writeFileSync(path.join(assetDir, 'provider_id.txt'), providerId || '');
  fs.writeFileSync(path.join(assetDir, 'photographer_url.txt'), photographerUrl || '');
  fs.writeFileSync(path.join(assetDir, 'retrieved_at.txt'), retrievedAt || '');
  fs.writeFileSync(path.join(assetDir, 'api_response.json'), JSON.stringify(rawProviderRecord ?? null, null, 2));
  fs.writeFileSync(path.join(assetDir, 'attribution_text.txt'), attributionText || '');
  // Only Unsplash-style providers have a use-time receipt to record; a
  // provider with nothing to ping simply never produces this file.
  if (pingedAt) {
    fs.writeFileSync(path.join(assetDir, 'download_location_pinged.txt'), `true\n${pingedAt}\n`);
  }
}

function buildRawGitHubBase({ owner, repo, branch, relDir }) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${relDir}`;
}

async function downloadAsset({ url, dest }) {
  await download(url, dest);
}

async function copyAsset({ src, dest }) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    fs.mkdir(dir, { recursive: true }, err => {
      if (err) return reject(err);
      fs.copyFile(src, dest, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function gitPushAsset(repoPath, relPath, slug) {
  return new Promise((resolve, reject) => {
    const cmd = `git add "${relPath}" && git commit -m "add ${slug}" && git push`;
    cp.exec(cmd, { cwd: repoPath }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

function removePlacedAssetBySourceUrl({ repoPath, series = 'water-series', placedIn, sourceUrl }) {
  const partDir = path.join(repoPath, series, placedIn);

  if (!fs.existsSync(partDir)) {
    return { status: 'missing-part-dir', partDir };
  }

  const matches = fs.readdirSync(partDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .filter(d => {
      const urlFile = path.join(partDir, d.name, 'url.txt');
      return fs.existsSync(urlFile) &&
        fs.readFileSync(urlFile, 'utf8').trim() === String(sourceUrl || '').trim();
    })
    .map(d => d.name);

  if (matches.length === 0) return { status: 'no-match', partDir };
  if (matches.length > 1) return { status: 'multiple-matches', partDir, matches };

  fs.rmSync(path.join(partDir, matches[0]), { recursive: true, force: true });
  return { status: 'removed', partDir, slug: matches[0] };
}

function guessExt(url) {
  const m = String(url || '').match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`imageAssetsRepo requires ${name}`);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = u => https.get(u, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return get(res.headers.location);
      if (res.statusCode !== 200) {
        file.destroy();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    }).on('error', err => { file.destroy(); reject(err); });
    get(url);
  });
}

module.exports = {
  createRepoAsset,
  createPlacedAsset,
  writeProvenanceFiles,
  writeProviderComplianceFiles,
  buildRawGitHubBase,
  downloadAsset,
  copyAsset,
  gitPushAsset,
  removePlacedAssetBySourceUrl,
  guessExt
};
