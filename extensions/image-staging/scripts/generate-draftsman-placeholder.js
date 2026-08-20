'use strict';

// One-off script — not wired into extension activation or the test chain.
// Regenerates .draftsman/placeholder-image-needed.png at the oat-content
// repo root from a deterministic SVG spec. Run manually:
//   node scripts/generate-draftsman-placeholder.js [path-to-oat-content-repo]
//
// Deliberately loud/unmissable (hazard-stripe border, warning color, bold
// text) so a placeholder that slips through to a published draft fails
// obviously rather than silently. This is a functionally correct warning
// graphic generated from plain SVG markup, not a polished design pass —
// the SVG constants below are easy to hand-tune if the look needs to
// change; there's no black-box render step to fight.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTH = 1200;
const HEIGHT = 675;
const BORDER = 24;
const STRIPE_WIDTH = 40;
const AMBER = '#F5A623';
const BLACK = '#111111';

function buildSvg() {
  return `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="hazard" width="${STRIPE_WIDTH * 2}" height="${STRIPE_WIDTH * 2}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="${STRIPE_WIDTH * 2}" height="${STRIPE_WIDTH * 2}" fill="${AMBER}"/>
      <rect width="${STRIPE_WIDTH}" height="${STRIPE_WIDTH * 2}" fill="${BLACK}"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#hazard)"/>
  <rect x="${BORDER}" y="${BORDER}" width="${WIDTH - BORDER * 2}" height="${HEIGHT - BORDER * 2}" fill="none" stroke="${BLACK}" stroke-width="${BORDER}"/>
  <rect x="${BORDER * 3}" y="${HEIGHT / 2 - 140}" width="${WIDTH - BORDER * 6}" height="280" fill="white"/>
  <text x="50%" y="${HEIGHT / 2 - 30}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="90" font-weight="bold" fill="${BLACK}">⚠ IMAGE NEEDED</text>
  <text x="50%" y="${HEIGHT / 2 + 60}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" fill="${BLACK}">run Draftsman: Flag Image — do not publish</text>
</svg>`.trim();
}

async function main() {
  const oatContentRoot = process.argv[2] || path.resolve(__dirname, '../../../../oat-content');
  const outDir = path.join(oatContentRoot, '.draftsman');
  const outPath = path.join(outDir, 'placeholder-image-needed.png');

  if (!fs.existsSync(oatContentRoot)) {
    throw new Error(`oat-content repo not found at ${oatContentRoot} — pass its path as an argument`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  await sharp(Buffer.from(buildSvg())).png().toFile(outPath);
  console.log(`Wrote ${outPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildSvg };
