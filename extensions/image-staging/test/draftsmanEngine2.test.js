'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  formatAge,
  buildGeneratePrompt,
  presentPromptForRefinement,
  awaitGeneratedIntake
} = require('../lib/draftsmanEngine2');

function testBuildGeneratePromptIncludesContextAndStyle() {
  const prompt = buildGeneratePrompt({ context: 'wetland restoration along the coast' });
  assert.strictEqual(prompt.includes('wetland restoration along the coast'), true);
  assert.strictEqual(prompt.includes('granite'), true);
  assert.strictEqual(prompt.includes('brass'), true);
  assert.strictEqual(prompt.includes('cyanotype'), true);
  assert.strictEqual(prompt.includes('#B8860B'), true);
}

function testBuildGeneratePromptFallsBackWithoutContext() {
  const prompt = buildGeneratePrompt({ context: '' });
  assert.strictEqual(prompt.includes('the surrounding article context'), true);
}

async function testPresentPromptForRefinementCopiesToClipboardNoAutoLaunch() {
  const calls = { clipboard: null, infoMessage: null };
  const vscode = {
    env: { clipboard: { writeText: async text => { calls.clipboard = text; } } },
    window: { showInformationMessage: async message => { calls.infoMessage = message; } }
  };

  await presentPromptForRefinement({ vscode, prompt: 'a test prompt' });

  assert.strictEqual(calls.clipboard, 'a test prompt');
  assert.strictEqual(typeof calls.infoMessage, 'string');
  // Confirm it never tries to shell out / open an external tool — the fake
  // vscode object above has no such method, so this only passes if
  // presentPromptForRefinement never calls anything beyond clipboard + info message.
}

// Bug #1: these run the REAL downloadsProvider (listRecentDownloads +
// stageDownloadsResult) against a temp directory of real files. The old
// tests stubbed the search, which is how a never-matching keyword filter
// went unnoticed.
const PARAGRAPH_CONTEXT =
  'The Edwards Aquifer recharges slowly under karst limestone near San Antonio, and pumping during drought draws down the springs';
const NOW = Date.parse('2026-11-07T20:00:00Z');

async function testAwaitGeneratedIntakeOffersRecentRealDownloads() {
  const dir = tempDir();
  try {
    const chatGpt = writeWithMtime(dir, 'ChatGPT Image Nov 7, 2026, 01_55_00 PM.png', minutesAgo(5));
    writeWithMtime(dir, 'other-photo.jpg', minutesAgo(120));
    writeWithMtime(dir, 'last-week.png', minutesAgo(7 * 24 * 60));

    let capturedItems = null;
    let capturedOptions = null;
    const vscode = {
      window: {
        showQuickPick: async (items, options) => { capturedItems = items; capturedOptions = options; return items[0]; },
        showInformationMessage: async () => {}
      }
    };

    const staged = await awaitGeneratedIntake({ vscode, downloadsDir: dir, context: PARAGRAPH_CONTEXT, now: NOW });

    assert.deepStrictEqual(
      capturedItems.map(item => item.detail),
      ['ChatGPT Image Nov 7, 2026, 01_55_00 PM.png', 'other-photo.jpg'],
      'a paragraph-length context must not filter anything out; recent files offered newest first, stale ones excluded'
    );
    assert.strictEqual(capturedItems[0].description, 'AI-generated · 5 min ago');
    assert(capturedOptions.placeHolder.includes('The Edwards Aquifer'), 'picker should say which placeholder it is for');

    assert.strictEqual(staged.sourcePath, chatGpt, 'the picked real file is staged');
    assert.strictEqual(staged.sourceKind, 'ai-generated');
    assert(fs.existsSync(chatGpt), 'staging must not move or delete the Downloads file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testAwaitGeneratedIntakeReturnsNullWhenNothingRecent() {
  const dir = tempDir();
  try {
    writeWithMtime(dir, 'last-week.png', minutesAgo(7 * 24 * 60));
    let message = null;
    let pickerOpened = false;
    const vscode = {
      window: {
        showQuickPick: async () => { pickerOpened = true; },
        showInformationMessage: async text => { message = text; }
      }
    };

    const result = await awaitGeneratedIntake({ vscode, downloadsDir: dir, context: PARAGRAPH_CONTEXT, now: NOW });
    assert.strictEqual(result, null);
    assert.strictEqual(pickerOpened, false);
    assert(message.includes('last 24 hours'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testAwaitGeneratedIntakeReturnsNullWhenPickCancelled() {
  const dir = tempDir();
  try {
    const chatGpt = writeWithMtime(dir, 'ChatGPT Image Nov 7, 2026, 01_55_00 PM.png', minutesAgo(5));
    const vscode = { window: { showQuickPick: async () => undefined, showInformationMessage: async () => {} } };

    const result = await awaitGeneratedIntake({ vscode, downloadsDir: dir, now: NOW });
    assert.strictEqual(result, null);
    assert(fs.existsSync(chatGpt));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testFormatAge() {
  assert.strictEqual(formatAge(new Date(NOW - 10 * 1000).toISOString(), NOW), 'just now');
  assert.strictEqual(formatAge(new Date(NOW - 42 * 60 * 1000).toISOString(), NOW), '42 min ago');
  assert.strictEqual(formatAge(new Date(NOW - 3 * 60 * 60 * 1000).toISOString(), NOW), '3 h ago');
}

function minutesAgo(minutes) {
  return new Date(NOW - minutes * 60 * 1000);
}

function writeWithMtime(dir, fileName, mtime) {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'image bytes');
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oat-engine2-'));
}

(async () => {
  testBuildGeneratePromptIncludesContextAndStyle();
  testBuildGeneratePromptFallsBackWithoutContext();
  await testPresentPromptForRefinementCopiesToClipboardNoAutoLaunch();
  await testAwaitGeneratedIntakeOffersRecentRealDownloads();
  await testAwaitGeneratedIntakeReturnsNullWhenNothingRecent();
  await testAwaitGeneratedIntakeReturnsNullWhenPickCancelled();
  testFormatAge();
  console.log('draftsmanEngine2 tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
