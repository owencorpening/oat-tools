#!/bin/bash
# Usage: screenshot-html.sh <input.html> <output.png> [width] [selector]
INPUT=$1
OUTPUT=$2
WIDTH=${3:-700}
SELECTOR=${4:-.table-frame}

PUPPETEER_DIR=${PUPPETEER_DIR:-"$HOME/dev/oat-tools/extensions/table-tools"}

node - "$INPUT" "$OUTPUT" "$WIDTH" "$PUPPETEER_DIR" "$SELECTOR" <<'NODE'
const input = process.argv[2];
const output = process.argv[3];
const initialWidth = Number(process.argv[4]) || 700;
const puppeteerDir = process.argv[5];
const selector = process.argv[6] || '.table-frame';
const puppeteer = require(`${puppeteerDir}/node_modules/puppeteer`);
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: Math.max(initialWidth, 320), height: 800, deviceScaleFactor: 1 });
  await page.goto('file://' + path.resolve(input), { waitUntil: 'networkidle2', timeout: 30000 });

  const handle = await page.$(selector);
  if (!handle) throw new Error(`Selector "${selector}" not found in rendered HTML`);

  const box = await handle.boundingBox();
  if (!box) throw new Error(`Unable to measure rendered element for "${selector}"`);

  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);
  await page.setViewport({ width: Math.max(width, 320), height: Math.max(height, 200), deviceScaleFactor: 1 });
  const resizedHandle = await page.$(selector);
  await resizedHandle.screenshot({ path: output });
  await browser.close();

  console.log(JSON.stringify({ width, height }));
})().catch(e => { console.error(e); process.exit(1); });
NODE
