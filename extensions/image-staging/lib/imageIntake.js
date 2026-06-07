'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { slugFromName } = require('./imageRecord');

function fromUrl(input = {}) {
  requireFields(input, ['id', 'url']);

  const displayName = input.displayName || titleFromUrl(input.url);
  return withStatus({
    id: input.id,
    assetType: input.assetType || 'image',
    slug: input.slug || slugFromName(displayName),
    displayName,
    sourceName: input.sourceName || displayName,
    sourceUrl: input.url,
    imageSrc: input.imageSrc,
    photographer: input.photographer,
    license: input.license,
    attribution: input.attribution,
    intakeSection: input.intakeSection,
    status: input.status
  });
}

async function fromDownloadsFile(input = {}) {
  requireFields(input, ['id', 'filePath']);
  return fromLocalFile({
    ...input,
    sourceKind: 'downloads'
  });
}

async function fromAiGeneratedFile(input = {}) {
  requireFields(input, ['id', 'filePath']);
  return fromLocalFile({
    photographer: 'Owen Corpening',
    ...input,
    sourceKind: 'ai-generated'
  });
}

async function fromUserFile(input = {}) {
  requireFields(input, ['id', 'filePath']);
  return fromLocalFile({
    ...input,
    sourceKind: 'user-provided'
  });
}

function fromReviewNeed(input = {}) {
  requireFields(input, ['id', 'contentDraftId', 'reason']);

  return {
    id: input.id,
    contentDraftId: input.contentDraftId,
    draftLocation: input.draftLocation,
    reason: input.reason,
    neededAssetKind: input.neededAssetKind,
    status: input.status || 'open'
  };
}

async function fromLocalFile(input = {}) {
  const fileName = path.basename(input.filePath);
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const displayName = input.displayName || humanizeFileName(baseName);
  const contentHash = input.contentHash || await hashFile(input.filePath);

  return withStatus({
    id: input.id,
    assetType: input.assetType || 'image',
    slug: input.slug || slugFromName(displayName),
    displayName,
    sourceName: input.sourceName || fileName,
    sourcePath: input.filePath,
    sourceUrl: input.sourceUrl,
    imageSrc: input.imageSrc,
    contentHash,
    photographer: input.photographer,
    license: input.license,
    attribution: input.attribution,
    intakeSection: input.intakeSection,
    sourceKind: input.sourceKind,
    status: input.status
  });
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const file = await fs.promises.readFile(filePath);
  hash.update(file);
  return `sha256:${hash.digest('hex')}`;
}

function withStatus(asset) {
  return {
    ...asset,
    status: asset.status || (hasProvenance(asset) ? 'candidate' : 'needs-provenance')
  };
}

function hasProvenance(asset) {
  return Boolean(asset.photographer && asset.license && (asset.sourceUrl || asset.sourcePath));
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return humanizeFileName(last.replace(/\.[^.]+$/, ''));
  } catch {
    return 'Untitled image';
  }
}

function humanizeFileName(name) {
  return String(name || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase());
}

function requireFields(record, fields) {
  for (const field of fields) {
    if (!record || record[field] === undefined || record[field] === null || record[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

module.exports = {
  fromUrl,
  fromDownloadsFile,
  fromAiGeneratedFile,
  fromUserFile,
  fromReviewNeed,
  hashFile,
  humanizeFileName
};
