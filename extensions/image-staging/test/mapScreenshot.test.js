'use strict';

const assert = require('assert');
const { screenshotCorridorMap } = require('../lib/mapScreenshot');

function fakeBrowser({ onScreenshot } = {}) {
  const calls = { setViewport: null, goto: null, waitForFunction: null, closed: false };
  const page = {
    setViewport: async opts => { calls.setViewport = opts; },
    goto: async (url, opts) => { calls.goto = { url, opts }; },
    waitForFunction: async (fn, opts) => { calls.waitForFunction = { fn, opts }; },
    $: async selector => selector === '#map' ? {
      screenshot: async opts => { if (onScreenshot) onScreenshot(opts); }
    } : null
  };
  return {
    calls,
    browser: {
      newPage: async () => page,
      close: async () => { calls.closed = true; }
    }
  };
}

async function testScreenshotCorridorMapDrivesPageThroughExpectedSteps() {
  const { calls, browser } = fakeBrowser();
  let screenshotOpts = null;
  calls.onScreenshot = null;
  const launchFn = async opts => {
    calls.launchOpts = opts;
    return browser;
  };

  const result = await screenshotCorridorMap({
    htmlPath: '/tmp/fake-map.html',
    outputPath: '/tmp/fake-map.png',
    chromePath: '/opt/fake-chrome',
    launchFn
  });

  assert.strictEqual(calls.launchOpts.executablePath, '/opt/fake-chrome');
  assert.strictEqual(calls.launchOpts.headless, true);
  assert.strictEqual(calls.goto.url, 'file:///tmp/fake-map.html');
  assert.ok(calls.waitForFunction.fn.includes('__mapReady'));
  assert.strictEqual(calls.closed, true);
  assert.deepStrictEqual(result, { outputPath: '/tmp/fake-map.png' });
}

async function testScreenshotCorridorMapClosesBrowserOnFailure() {
  const { calls, browser } = fakeBrowser();
  browser.newPage = async () => { throw new Error('page crashed'); };
  const launchFn = async () => browser;

  await assert.rejects(
    () => screenshotCorridorMap({ htmlPath: '/tmp/x.html', outputPath: '/tmp/x.png', launchFn }),
    /page crashed/
  );
  assert.strictEqual(calls.closed, true, 'browser must be closed even when a step throws');
}

async function testScreenshotCorridorMapWrapsLaunchFailure() {
  const launchFn = async () => { throw new Error('spawn ENOENT'); };

  await assert.rejects(
    () => screenshotCorridorMap({ htmlPath: '/tmp/x.html', outputPath: '/tmp/x.png', chromePath: '/no/such/chrome', launchFn }),
    /Could not launch Chrome at '\/no\/such\/chrome'/
  );
}

async function testScreenshotCorridorMapRequiresPaths() {
  await assert.rejects(() => screenshotCorridorMap({ outputPath: '/tmp/x.png' }), /htmlPath/);
  await assert.rejects(() => screenshotCorridorMap({ htmlPath: '/tmp/x.html' }), /outputPath/);
}

(async () => {
  await testScreenshotCorridorMapDrivesPageThroughExpectedSteps();
  await testScreenshotCorridorMapClosesBrowserOnFailure();
  await testScreenshotCorridorMapWrapsLaunchFailure();
  await testScreenshotCorridorMapRequiresPaths();
  console.log('mapScreenshot tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
