'use strict';

const downloadsProvider = require('./downloadsProvider');

// Canonical source for BRAND_STYLE_GUIDE and the prompt template below:
// oat-standards/sops/actions/sop-draftsman.md ("Engine 2 — generation
// prompt"). Change the wording there first, then sync it here.
//
// Original note: no dedicated image-generation style guide exists in oat-standards —
// checked: visual-identity.md only covers logo/badge usage (Granite Gray +
// Brass Gold #B8860B), "cyanotype" appears nowhere in oat-standards except
// the Draftsman SOP itself. Hardcoded here from the SOP's own wording,
// supplemented with the one verified real value found.
const BRAND_STYLE_GUIDE =
  'granite, brass, and cyanotype color palette — muted stone-gray foundation tones, ' +
  'brass-gold accents (#B8860B), deep cyanotype-blue washes; industrial engineering-drafting ' +
  'aesthetic (blueprint/technical-drawing register), not painterly or whimsical; ' +
  'no embedded text or logos in the generated image itself.';

function buildGeneratePrompt({ context, brandStyleGuide = BRAND_STYLE_GUIDE } = {}) {
  const subject = String(context || '').trim() || 'the surrounding article context';
  return [
    `Editorial illustration for an engineering/policy article. Subject: ${subject}.`,
    `Style: ${brandStyleGuide}`,
    'Composition: single clear focal subject, landscape orientation suitable for a web article header image.'
  ].join('\n');
}

// No auto-launch of any external tool — confirmed out of scope by the SOP.
// Draftsman's job ends at producing the prompt; the author does the actual
// generation/refinement externally.
async function presentPromptForRefinement({ vscode, prompt } = {}) {
  await vscode.env.clipboard.writeText(prompt);
  await vscode.window.showInformationMessage(
    'Draftsman: prompt copied to clipboard. Refine it externally, then run "Draftsman: Sweep Article" or "Draftsman: Review Image" again once the result is saved to Downloads.',
    'OK'
  );
}

// Reuses lib/downloadsProvider.js's existing Downloads-based intake
// (already wired end-to-end through imagePipeline.js's sourceKind
// handling) — headless/QuickPick instead of the webview's own Downloads
// tab. No new staging directory: confirmed ~/Downloads is already the
// real, working local holding pen for generated candidates, cleaned up
// automatically by imagePipeline.js after a successful placement.
//
// Candidates come from listRecentDownloads (images saved in the last 24h,
// newest first), NOT from a keyword search on the placeholder context: the
// context is a whole paragraph and generator exports are named by
// timestamp, so keyword matching never found them. The author picks; no
// file is ever auto-selected.
// `context` is display-only (shown in the picker so the author knows which
// placeholder it's for) — it is never used to filter files.
async function awaitGeneratedIntake({
  vscode,
  downloadsProviderModule = downloadsProvider,
  downloadsDir,
  context = '',
  now = Date.now()
} = {}) {
  const { results: candidates } = await downloadsProviderModule.listRecentDownloads({
    ...(downloadsDir ? { downloadsDir } : {}),
    now
  });

  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(
      'Draftsman: no images saved to Downloads in the last 24 hours — generate one, save it, then try again.'
    );
    return null;
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map(result => ({
      label: result.title,
      description: [result.sourceKind === 'ai-generated' ? 'AI-generated' : null, formatAge(result.modifiedAt, now)]
        .filter(Boolean)
        .join(' · '),
      detail: result.sourceName,
      result
    })),
    { placeHolder: pickerPrompt(context) }
  );
  if (!picked) return null;

  return downloadsProviderModule.stageDownloadsResult(picked.result);
}

function pickerPrompt(context) {
  const clean = String(context || '').trim();
  const shown = clean.length > 80 ? `${clean.slice(0, 79).trim()}…` : clean;
  return shown
    ? `Select the generated image for "${shown}" (most recent first)`
    : 'Select the generated image to intake (most recent first)';
}

function formatAge(modifiedAt, now) {
  const ms = now - new Date(modifiedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

module.exports = { BRAND_STYLE_GUIDE, formatAge, buildGeneratePrompt, presentPromptForRefinement, awaitGeneratedIntake };
