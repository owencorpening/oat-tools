'use strict';

const DEFAULT_CHROME_PATH = '/usr/bin/google-chrome';
const MAP_READY_TIMEOUT_MS = 15000;

// Screenshots a generated corridor map HTML file to a PNG, headlessly, via
// puppeteer-core against an already-installed Chrome — no bundled browser,
// see oatImages.chromePath. launchFn is injectable so tests don't need a
// real Chrome install (mirrors the spawnFn/callClaudeCliFn pattern used by
// claudeCliClient.js and pullquoteCommands.js).
async function screenshotCorridorMap({
  htmlPath,
  outputPath,
  chromePath = DEFAULT_CHROME_PATH,
  width = 700,
  height = 440,
  launchFn
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

  return { outputPath };
}

module.exports = {
  screenshotCorridorMap,
  DEFAULT_CHROME_PATH
};
