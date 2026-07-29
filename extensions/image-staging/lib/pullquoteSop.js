'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function pullquoteSopPath(vscode) {
  const configured = vscode.workspace.getConfiguration('oatImages').get('pullquoteSopPath', '');
  if (configured) return configured;
  return path.join(os.homedir(), 'dev', 'oat-standards', 'sops', 'sop-pullquote-selection.md');
}

function loadPullquoteSop(vscode, { readFile = fs.readFileSync } = {}) {
  const sopPath = pullquoteSopPath(vscode);
  try {
    return readFile(sopPath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read pullquote SOP at ${sopPath}: ${err.message}`);
  }
}

module.exports = { pullquoteSopPath, loadPullquoteSop };
