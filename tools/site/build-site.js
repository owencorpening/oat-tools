#!/usr/bin/env node
'use strict';

// Builds the OAT public site from oat-content.
//
//   node tools/site/build-site.js --content <path to oat-content> --out <empty dir>
//       [--base-url https://owencorpening.github.io/oat-web/] [--main main]
//
// Runs inside the private oat-content repo's CI. Only the --out directory is
// ever pushed to the public site repo. On any failure the output directory
// is removed, so a failed build can't be pushed by mistake.

const fs = require('fs');
const path = require('path');
const { selectPublished, GateError } = require('./lib/gate');
const { readSeries } = require('./lib/series');
const { writeSite } = require('./lib/writeSite');

const DEFAULT_BASE_URL = 'https://owencorpening.github.io/oat-web/';

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
    throw new Error('usage: build-site.js --content <oat-content> --out <dir> [--base-url <url>] [--main main]');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const content = path.resolve(args.content);
  const out = path.resolve(args.out);
  const mainRef = args.main || 'main';
  const existedBefore = fs.existsSync(out);
  try {
    const articles = selectPublished(content, { mainRef });
    const series = readSeries(content, mainRef);
    await writeSite(articles, out, { series, baseUrl: args['base-url'] || DEFAULT_BASE_URL });
    console.log(`Built ${articles.length} published article(s) into ${args.out}`);
    for (const a of articles) console.log(`  ${a.series}/${a.slug}  (${a.tag})`);
  } catch (err) {
    if (!existedBefore) fs.rmSync(out, { recursive: true, force: true });
    console.error(err instanceof GateError ? err.message : `Build failed: ${err.message}`);
    process.exit(1);
  }
}

main();
