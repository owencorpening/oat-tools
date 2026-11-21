'use strict';

// Minimal front matter reader for OAT articles.
// Handles the flat `key: value` headers used in oat-content (optionally
// quoted values). Nested YAML is not needed by the site and is ignored.

function parseFrontMatter(text) {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0].trim() !== '---') {
    return { data: null, body: normalized };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { data: null, body: normalized };
  }
  const data = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    data[match[1]] = unquote(match[2].trim());
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

module.exports = { parseFrontMatter };
