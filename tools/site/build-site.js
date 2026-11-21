#!/usr/bin/env node
'use strict';

// Builds the OAT public site from oat-content.
//
//   node tools/site/build-site.js --content <path to oat-content> --out <empty dir> [--main main]
//
// Runs inside the private oat-content repo's CI. Only the --out directory is
// ever pushed to the public site repo.

const path = require('path');
const { selectPublished, GateError } = require('./lib/gate');
const { writeSite } = require('./lib/writeSite');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined) {
      throw new Error(`bad argument: ${key}`);
    }
    args[key.slice(2)] = value;
  }
  if (!args.content || !args.out) {
    throw new Error('usage: build-site.js --content <oat-content> --out <dir> [--main main]');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const articles = selectPublished(path.resolve(args.content), { mainRef: args.main || 'main' });
    writeSite(articles, path.resolve(args.out));
    console.log(`Built ${articles.length} published article(s) into ${args.out}`);
    for (const a of articles) console.log(`  ${a.series}/${a.slug}  (${a.tag})`);
  } catch (err) {
    console.error(err instanceof GateError ? err.message : `Build failed: ${err.message}`);
    process.exit(1);
  }
}

main();
