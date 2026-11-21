'use strict';

// Writes the site from the articles the gate returned, and nothing else.
//
// PLACEHOLDER PAGES: this first version writes deliberately bare HTML so the
// publish gate can be tested end to end. The real Home / Series / Article /
// Not found page types (design step 3) replace these in the next change.
// What must not change: this module only ever sees gate output.

const fs = require('fs');
const path = require('path');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title, bodyHtml) {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`;
}

function writeFile(outDir, relPath, content) {
  const full = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// Refuses to write into a directory that already has files, so stale pages
// from an earlier build can never survive an unpublish.
function writeSite(articles, outDir) {
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`output directory ${outDir} is not empty`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const list = articles
    .map((a) => `<li><a href="${a.series}/${a.slug}/">${escapeHtml(a.title)}</a></li>`)
    .join('\n');
  writeFile(outDir, 'index.html', page("Owen's Applied Thinking", `<ul>\n${list}\n</ul>`));

  for (const a of articles) {
    const body = `<h1>${escapeHtml(a.title)}</h1>\n<pre>${escapeHtml(a.body)}</pre>`;
    writeFile(outDir, `${a.series}/${a.slug}/index.html`, page(a.title, body));
  }
  writeFile(outDir, '404.html', page('Not found', '<p>Page not found. <a href="/">Home</a></p>'));
}

module.exports = { writeSite, escapeHtml };
