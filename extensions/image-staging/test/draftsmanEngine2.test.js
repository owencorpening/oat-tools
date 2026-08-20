'use strict';

const assert = require('assert');
const {
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

async function testAwaitGeneratedIntakePrefersAiGeneratedResults() {
  const aiResult = { sourceKind: 'ai-generated', title: 'AI Image', sourceName: 'ChatGPT Image.png' };
  const plainResult = { sourceKind: 'downloads', title: 'Plain Image', sourceName: 'photo.jpg' };
  const downloadsProviderModule = {
    searchDownloads: async () => ({ results: [plainResult, aiResult] }),
    stageDownloadsResult: async result => ({ staged: result })
  };
  let capturedPickItems = null;
  const vscode = {
    window: {
      showQuickPick: async items => { capturedPickItems = items; return items[0]; },
      showInformationMessage: async () => {}
    }
  };

  const staged = await awaitGeneratedIntake({ vscode, downloadsProviderModule });

  assert.strictEqual(capturedPickItems.length, 1, 'should only offer ai-generated results when any exist');
  assert.strictEqual(capturedPickItems[0].result, aiResult);
  assert.deepStrictEqual(staged, { staged: aiResult });
}

async function testAwaitGeneratedIntakeFallsBackToAllResultsWhenNoneAiGenerated() {
  const plainResult = { sourceKind: 'downloads', title: 'Plain Image', sourceName: 'photo.jpg' };
  const downloadsProviderModule = {
    searchDownloads: async () => ({ results: [plainResult] }),
    stageDownloadsResult: async result => ({ staged: result })
  };
  let capturedPickItems = null;
  const vscode = {
    window: {
      showQuickPick: async items => { capturedPickItems = items; return items[0]; },
      showInformationMessage: async () => {}
    }
  };

  await awaitGeneratedIntake({ vscode, downloadsProviderModule });
  assert.strictEqual(capturedPickItems.length, 1);
  assert.strictEqual(capturedPickItems[0].result, plainResult);
}

async function testAwaitGeneratedIntakeReturnsNullWhenNothingFound() {
  const downloadsProviderModule = {
    searchDownloads: async () => ({ results: [] }),
    stageDownloadsResult: async () => { throw new Error('should not be called'); }
  };
  const vscode = { window: { showInformationMessage: async () => {} } };

  const result = await awaitGeneratedIntake({ vscode, downloadsProviderModule });
  assert.strictEqual(result, null);
}

async function testAwaitGeneratedIntakeReturnsNullWhenPickCancelled() {
  const downloadsProviderModule = {
    searchDownloads: async () => ({ results: [{ sourceKind: 'ai-generated', title: 'X', sourceName: 'x.png' }] }),
    stageDownloadsResult: async () => { throw new Error('should not be called'); }
  };
  const vscode = { window: { showQuickPick: async () => undefined, showInformationMessage: async () => {} } };

  const result = await awaitGeneratedIntake({ vscode, downloadsProviderModule });
  assert.strictEqual(result, null);
}

(async () => {
  testBuildGeneratePromptIncludesContextAndStyle();
  testBuildGeneratePromptFallsBackWithoutContext();
  await testPresentPromptForRefinementCopiesToClipboardNoAutoLaunch();
  await testAwaitGeneratedIntakePrefersAiGeneratedResults();
  await testAwaitGeneratedIntakeFallsBackToAllResultsWhenNoneAiGenerated();
  await testAwaitGeneratedIntakeReturnsNullWhenNothingFound();
  await testAwaitGeneratedIntakeReturnsNullWhenPickCancelled();
  console.log('draftsmanEngine2 tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
