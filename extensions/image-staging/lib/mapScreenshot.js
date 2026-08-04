'use strict';

const DEFAULT_CHROME_PATH = '/usr/bin/google-chrome';
const MAP_READY_TIMEOUT_MS = 15000;

// Screenshots a generated corridor map HTML file to a PNG, headlessly, via
// puppeteer-core against an already-installed Chrome — no bundled browser,
// see oatImages.chromePath. launchFn is injectable so tests don't need a
// real Chrome install (mirrors the spawnFn/callClaudeCliFn pattern used by
// claudeCliClient.js and pullquoteCommands.js).
//
// brightness/saturation/contrast are an optional post-capture color grade
// (see gradeScreenshot below) — omitted entirely unless the caller passes
// at least one, so a plain screenshot never pays for a sharp round-trip.
async function screenshotCorridorMap({
  htmlPath,
  outputPath,
  chromePath = DEFAULT_CHROME_PATH,
  width = 700,
  height = 440,
  brightness,
  saturation,
  contrast,
  launchFn,
  gradeFn = gradeScreenshot
} = {}) {
  if (!htmlPath) throw new Error('screenshotCorridorMap requires htmlPath.');
  if (!outputPath) throw new Error('screenshotCorridorMap requires outputPath.');

  const launch = launchFn || require('puppeteer-core').launch;

  let browser;
  try {
    browser = await launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox']
    });
  } catch (err) {
    throw new Error(`Could not launch Chrome at '${chromePath}' — set oatImages.chromePath to a valid Chrome/Chromium executable. (${err.message})`);
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__mapReady === true', { timeout: MAP_READY_TIMEOUT_MS });

    const mapElement = await page.$('#map');
    if (!mapElement) throw new Error('Rendered map HTML has no #map element to screenshot.');
    await mapElement.screenshot({ path: outputPath });
  } finally {
    await browser.close();
  }

  if (brightness !== undefined || saturation !== undefined || contrast !== undefined) {
    await gradeFn({ path: outputPath, brightness, saturation, contrast });
  }

  return { outputPath };
}

// Rewrites outputPath in place with a brightness/saturation/contrast grade.
// brightness and saturation are sharp's modulate() multipliers (1 = no
// change). contrast is a linear() slope around the 128 midpoint (1 = no
// change, >1 punchier, <1 flatter) — same knob sharp itself calls "contrast"
// in its docs even though it isn't exposed as a named option.
async function gradeScreenshot({ path: filePath, brightness, saturation, contrast }) {
  const sharp = require('sharp');
  let pipeline = sharp(filePath);

  if (brightness !== undefined || saturation !== undefined) {
    pipeline = pipeline.modulate({
      brightness: brightness !== undefined ? brightness : 1,
      saturation: saturation !== undefined ? saturation : 1
    });
  }
  if (contrast !== undefined) {
    pipeline = pipeline.linear(contrast, 128 * (1 - contrast));
  }

  const buffer = await pipeline.toBuffer();
  const fs = require('fs');
  await fs.promises.writeFile(filePath, buffer);
}

module.exports = {
  screenshotCorridorMap,
  gradeScreenshot,
  DEFAULT_CHROME_PATH
};
