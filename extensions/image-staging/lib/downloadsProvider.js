'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const imageIntake = require('./imageIntake');
const {
  buildAssetFromLocalFile,
  defaultIds
} = require('./localFileIntakeCommand');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const MAX_THUMBNAIL_BYTES = 512 * 1024;

async function searchDownloads({ query = '', downloadsDir = defaultDownloadsDir(), limit = 24 } = {}) {
  const entries = await safeReadDir(downloadsDir);
  const terms = tokenize(query);
  const results = [];

  for (const entry of entries) {
    if (results.length >= limit) break;
    if (!entry.isFile()) continue;
    if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (!matchesQuery(entry.name, terms)) continue;

    const filePath = path.join(downloadsDir, entry.name);
    const stat = await safeStat(filePath);
    if (!stat) continue;

    results.push(await normalizeDownloadsFile({ filePath, fileName: entry.name, stat }));
  }

  return { provider: 'downloads', results };
}

async function stageDownloadsResult(result, {
  imageIntakeModule = imageIntake,
  idFactory = defaultIds
} = {}) {
  if (!result || result.provider !== 'downloads') {
    throw new Error('stageDownloadsResult requires a downloads provider result');
  }

  return buildAssetFromLocalFile(imageIntakeModule, result.sourceKind || 'downloads', {
    id: idFactory.assetId({ filePath: result.sourcePath, displayName: result.title }),
    filePath: result.sourcePath,
    displayName: result.title,
    sourceUrl: result.sourceUrl,
    photographer: result.photographer,
    license: result.license,
    sourceName: result.sourceName,
    status: result.status || 'needs-provenance'
  });
}

async function normalizeDownloadsFile({ filePath, fileName, stat }) {
  const hints = inferFilenameHints(fileName);
  const title = hints.title || displayNameFromFileName(fileName);
  const sourceKind = hints.tool === 'ChatGPT' ? 'ai-generated' : 'downloads';
  const license = licenseForTool(hints.tool);
  const status = sourceKind === 'ai-generated' && license ? 'staged' : 'needs-provenance';

  return {
    provider: 'downloads',
    providerId: filePath,
    title,
    sourcePath: filePath,
    sourceName: fileName,
    sourceKind,
    thumbnailUrl: await thumbnailDataUri(filePath),
    photographer: sourceKind === 'ai-generated' ? 'Owen Corpening' : '',
    license,
    status,
    provenanceConfidence: 'filename-hint',
    proposedTool: hints.tool,
    proposedCreatedAt: hints.createdAt,
    proposedSubject: hints.subject,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

function inferFilenameHints(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const chatGpt = baseName.match(/^ChatGPT Image ([A-Z][a-z]+ \d{1,2}, \d{4}), (\d{1,2})_(\d{2})_(\d{2}) ([AP]M)$/);
  if (chatGpt) {
    return {
      tool: 'ChatGPT',
      createdAt: parseChatGptTimestamp(chatGpt),
      title: baseName
    };
  }

  const subject = baseName
    .replace(/[_-]+/g, ' ')
    .replace(/\b(publisher|gold|final|draft|preview)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    subject: subject || undefined,
    title: displayNameFromFileName(fileName)
  };
}

function licenseForTool(tool) {
  switch (tool) {
    case 'ChatGPT':
      return 'ChatGPT (OpenAI ToS: https://openai.com/policies/terms-of-use)';
    default:
      return '';
  }
}

function parseChatGptTimestamp(match) {
  const date = new Date(`${match[1]} ${match[2]}:${match[3]}:${match[4]} ${match[5]}`);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

async function thumbnailDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') return undefined;

  const stat = await safeStat(filePath);
  if (!stat || stat.size > MAX_THUMBNAIL_BYTES) return undefined;

  try {
    const data = await fs.promises.readFile(filePath);
    return `data:${mimeType(ext)};base64,${data.toString('base64')}`;
  } catch {
    return undefined;
  }
}

function displayNameFromFileName(fileName) {
  return fileName.replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase());
}

function matchesQuery(fileName, terms) {
  if (terms.length === 0) return true;
  const haystack = fileName.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function tokenize(query) {
  const str = String(query || '').trim();
  if (str === '*') return [];
  return str
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(Boolean);
}

function defaultDownloadsDir() {
  return path.join(os.homedir(), 'Downloads');
}

async function safeReadDir(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

function mimeType(ext) {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

module.exports = {
  searchDownloads,
  stageDownloadsResult,
  inferFilenameHints,
  displayNameFromFileName,
  defaultDownloadsDir,
  shortHash
};
