'use strict';

// Page types: Home, Series, Article, Not found; image copying; series file.
// All fixtures are made up. Images are served by a local HTTP server.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeSite } = require('../lib/writeSite');
const { readSeries } = require('../lib/series');
const { GateError } = require('../lib/gate');
const { firstParagraph } = require('../lib/render');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4ab0000000049454e44ae426082', 'hex');
const tmpRoots = [];

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function startImageServer() {
  const hits = [];
  let busy = 0;
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith('/down') || (req.url.startsWith('/busy') && busy++ < 2)) {
      res.writeHead(503);
      res.end('Service Unavailable');
      return;
    }
    if (req.url.startsWith('/missing')) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, hits, close: () => server.close() });
    });
  });
}

function art(series, slug, extra = {}) {
  return {
    series,
    slug,
    title: `Title ${slug}`,
    published: '2025-11-12',
    type: 'substack-article',
    part: null,
    description: null,
    substackUrl: null,
    linkedinUrl: null,
    body: `# Title ${slug}\n\nThis is the opening paragraph of ${slug}, long enough to be a description.`,
    tag: `pub/${series}/${slug}/2025-11-12`,
    commit: 'abc',
    sourcePath: `${slug}.md`,
    ...extra
  };
}

const SERIES = new Map([
  ['vectors', { id: 'vectors', name: 'Vectors', description: 'Single articles.', order: 1000 }],
  ['water', { id: 'water', name: 'Water Resilience', description: 'Water engineering.', order: 1 }],
  ['cng', { id: 'cng', name: 'CNG', description: 'Natural gas vehicles.', order: 2 }],
  ['planned', { id: 'planned', name: 'CANARY_PLANNED_SERIES', description: 'x', order: 3 }]
]);

function read(out, rel) {
  return fs.readFileSync(path.join(out, rel), 'utf8');
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('builds home, series, article and not-found pages with no JavaScript when no counter is set', async () => {
  const img = await startImageServer();
  try {
    const articles = [
      art('water', 'part-02', { part: '02', published: '2025-11-18', substackUrl: 'https://owencorpening.substack.com/p/part-two' }),
      art('water', 'part-01', {
        part: '01',
        substackUrl: 'https://owencorpening.substack.com/p/part-one',
        body: `# Part one\n\nOpening paragraph of part one, which is long enough to describe it.\n\n![chart](${img.base}/chart.png)\n\n<img src="${img.base}/chart.png" width="400" alt="same chart again">\n\nNext: [part two](https://owencorpening.substack.com/p/part-two?r=1gha0n). See the [guide](https://owencorpening.substack.com/p/series-guide?r=1gha0n). Source: [WHO](https://www.who.int/report?r=keep).`
      }),
      art('water', 'manifesto', { part: 'manifesto', published: '2026-05-14' }),
      art('vectors', 'essay', { linkedinUrl: 'https://www.linkedin.com/posts/x', body: '<img src="' + img.base + '/chart.png">\n\n# Title essay\n\nEssay opening paragraph that is long enough to stand as a description.' })
    ];
    const out = path.join(tmpDir('oat-pages-'), 'site');
    await writeSite(articles, out, { series: SERIES, baseUrl: 'https://owencorpening.github.io/oat-web' });

    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f); else files.push(path.relative(out, f));
      }
    })(out);
    const htmlFiles = files.filter((f) => f.endsWith('.html')).sort();
    assert.deepStrictEqual(htmlFiles, [
      '404.html', 'about/index.html', 'index.html', 'products/index.html', 'standalone/essay/index.html', 'standalone/index.html',
      'tools/cheatsheets/index.html', 'tools/index.html', 'tools/oat-stats/index.html', 'tools/oat-stats/privacy/index.html', 'tools/search-grid/index.html', 'tools/search-grid/privacy/index.html',
      'vectors/essay/index.html', 'vectors/index.html', 'water/index.html', 'water/manifesto/index.html', 'water/part-01/index.html', 'water/part-02/index.html',
      'writing/index.html', 'writing/vectors/essay/index.html', 'writing/vectors/index.html',
      'writing/water/index.html', 'writing/water/manifesto/index.html', 'writing/water/part-01/index.html', 'writing/water/part-02/index.html'
    ]);
    assert.strictEqual(files.filter((f) => f.startsWith('assets/')).length, 1, 'one image, copied once');
    assert.strictEqual(img.hits.length, 1, 'image downloaded once');
    assert.deepStrictEqual(files.filter((f) => f.startsWith('brand/')).sort(),
      ['brand/apple-touch-icon.png', 'brand/cheatsheets-icon.png', 'brand/cornerstone.jpg', 'brand/favicon-32.png', 'brand/oat-mark.png', 'brand/search-grid-icon.png'],
      'brand files copied from the repo, not downloaded');

    for (const f of files.filter((x) => x.endsWith('.html'))) {
      const html = read(out, f);
      assert.ok(!/<script|<iframe|\son[a-z]+=/i.test(html), `${f} has no JavaScript (no GoatCounter code in this build)`);
      assert.ok(!html.includes('127.0.0.1'), `${f} loads nothing from outside`);
      assert.ok(!html.includes('CANARY_'), `${f} shows nothing from an empty series`);
    }

    const home = read(out, 'index.html');

    // Search Grid extension pages: the Chrome Web Store links to these fixed URLs.
    const grid = read(out, 'tools/search-grid/index.html');
    assert.ok(grid.includes('<a class="cta" href="https://chromewebstore.google.com/detail/search-grid-recency-filte/ljghjhddjnnnjmaakpimcbidjckddgdf">Add to Chrome</a>'), 'support page has the Add to Chrome store button');
    assert.ok(!grid.includes('coming soon'), 'no stale coming-soon wording');
    assert.ok(grid.includes('href="privacy/"'), 'support page links its privacy policy');
    assert.ok(grid.includes('<link rel="stylesheet" href="../../style.css'), 'support page finds the stylesheet');
    const privacy = read(out, 'tools/search-grid/privacy/index.html');
    assert.ok(privacy.includes('collects no personal information'));
    assert.ok(privacy.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/tools/search-grid/privacy/">'));
    assert.ok(read(out, 'about/index.html').includes('href="../tools/search-grid/"'), 'About links the extension page');

    // OAT stats OAuth app pages: Google's consent-screen Branding links to these fixed URLs.
    const stats = read(out, 'tools/oat-stats/index.html');
    assert.ok(stats.includes('<h1>OAT stats</h1>') && stats.includes('href="privacy/"'), 'app home page links its privacy policy');
    assert.ok(stats.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/tools/oat-stats/">'));
    const statsPrivacy = read(out, 'tools/oat-stats/privacy/index.html');
    assert.ok(statsPrivacy.includes('chromewebstore.readonly') && statsPrivacy.includes('Limited Use requirements'), 'names the scope and the Limited Use statement');
    assert.ok(!read(out, 'tools/index.html').includes('oat-stats'), 'not listed as a free tool');
    const writing = read(out, 'writing/index.html');
    assert.ok(writing.indexOf('Water Resilience') < writing.indexOf('Vectors'), 'series in order, vectors last');
    assert.ok(writing.includes('href="water/"') && writing.includes('href="vectors/"'));
    assert.ok(!writing.includes('href="standalone/"'), 'old series id is not listed');

    const moved = read(out, 'standalone/essay/index.html');
    assert.ok(moved.includes('<meta http-equiv="refresh" content="0; url=../../writing/vectors/essay/">'), 'old article URL redirects');
    assert.ok(moved.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/writing/vectors/essay/">'));
    assert.ok(read(out, 'standalone/index.html').includes('url=../writing/vectors/'), 'old series URL redirects');
    assert.ok(read(out, 'water/part-01/index.html').includes('url=../../writing/water/part-01/'), 'pre-/writing/ article URL redirects');
    assert.ok(read(out, 'water/index.html').includes('url=../writing/water/'), 'pre-/writing/ series URL redirects');
    assert.ok(!writing.includes('CNG') && !home.includes('CNG'), 'a series with no published article is hidden');
    assert.ok(home.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/">'));
    assert.ok(home.includes('<img src="brand/cornerstone.jpg"'), 'cornerstone hero on the home page');
    assert.ok(home.includes('<h1 class="visually-hidden">'), 'home keeps its h1 for screen readers');
    assert.strictEqual(home.split('<body>')[1].split('Where reasoning meets the real world.').length - 1, 1, 'tagline shown once on the home page');

    const series = read(out, 'writing/water/index.html');
    const order = ['part-01/', 'part-02/', 'manifesto/'].map((s) => series.indexOf(`href="${s}"`));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'numbered parts first, then the rest');

    const p1 = read(out, 'writing/water/part-01/index.html');
    assert.ok(p1.includes('Opening paragraph of part one'), 'article text is in the HTML');
    assert.ok(!p1.includes('<h1>Part one</h1>'), 'leading title line is not repeated');
    assert.ok(/<img [^>]*src="\.\.\/\.\.\/\.\.\/assets\/[0-9a-f]{16}\.png"/.test(p1), 'image points at the copy');
    assert.ok(p1.includes('href="../../water/part-02/"'), 'link to a published article goes to its site page');
    assert.ok(p1.includes('href="https://www.who.int/report?r=keep"'), 'non-Substack links untouched');
    assert.ok(p1.includes('<a href="../">Water Resilience</a>') && p1.includes('Part 1'));
    assert.ok(p1.includes('<a class="next" href="../part-02/"><small>Next →</small>'), 'next button');
    assert.ok(!p1.includes('class="prev"'), 'no previous button on the first part');
    assert.ok(/<p class="meta">.*<\/p>\n<nav class="pager-top"[^>]*><a class="next" href="\.\.\/part-02\/"/.test(p1), 'short first part still gets the top Next button');
    const p2page = read(out, 'writing/water/part-02/index.html');
    assert.ok(p2page.includes('<a class="prev" href="../part-01/"><small>← Previous</small>'), 'previous button');
    assert.ok(/<p class="meta">.*<\/p>\n<nav class="pager-top"[^>]*><a class="prev" href="\.\.\/part-01\/" title="[^"]*">← Previous<\/a><a class="next" href="\.\.\/manifesto\/"/.test(p2page), 'compact buttons under the date line');
    assert.ok(p1.includes('<a href="../">guide</a>') && !p1.includes('series-guide'), 'series-guide link goes to the series page');
    assert.ok(p1.includes('Also on <a href="https://owencorpening.substack.com/p/part-one">Substack</a>'));
    assert.ok(p1.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/writing/water/part-01/">'));
    assert.ok(/<link rel="stylesheet" href="\.\.\/\.\.\/\.\.\/style\.css\?v=[0-9a-f]{10}">/.test(p1), 'stylesheet link carries a version');
    assert.ok(p1.includes('<img src="../../../brand/oat-mark.png" alt="OAT"'), 'header logo on article pages');
    assert.ok(p1.includes('<link rel="icon" type="image/png" sizes="32x32" href="../../../brand/favicon-32.png">'));
    assert.ok(p1.includes('Owen Corpening · Austin, Texas') && !p1.includes('Corpening, PE'), 'sign-off in footer');
    assert.strictEqual(p1.split('<body>')[1].split('Where reasoning meets the real world.').length - 1, 1, 'tagline in the article footer');
    assert.ok(!p1.includes('cornerstone.jpg'), 'hero only on the home page');

    const essay = read(out, 'writing/vectors/essay/index.html');
    assert.ok(essay.includes('<a href="../">Vectors</a>') && essay.includes('LinkedIn'));
    assert.strictEqual(essay.split('<h1>Title essay</h1>').length - 1, 1, 'title heading after a hero image is not repeated');

    const nf = read(out, '404.html');
    assert.ok(/href="\/oat-web\/style\.css\?v=[0-9a-f]{10}"/.test(nf) && nf.includes('href="/oat-web/"'));
    assert.ok(nf.includes('src="/oat-web/brand/oat-mark.png"'), '404 logo uses an absolute path');
    assert.ok(!nf.includes('part-01') && !nf.includes('rel="canonical"'), '404 lists nothing');
    assert.ok(!files.includes('CNAME'), 'no CNAME file on a github.io address');
  } finally {
    img.close();
  }
});

test('a custom domain writes CNAME and serves from the root', async () => {
  const out = path.join(tmpDir('oat-pages-'), 'site');
  await writeSite([art('water', 'part-01', { part: '01' })], out, { series: SERIES, baseUrl: 'https://owensappliedthinking.com' });
  assert.strictEqual(read(out, 'CNAME'), 'owensappliedthinking.com\n');
  assert.ok(read(out, 'index.html').includes('<link rel="canonical" href="https://owensappliedthinking.com/">'));
  assert.ok(read(out, 'writing/water/part-01/index.html').includes('<link rel="canonical" href="https://owensappliedthinking.com/writing/water/part-01/">'));
  const nf = read(out, '404.html');
  assert.ok(nf.includes('href="/"') && nf.includes('src="/brand/oat-mark.png"'), '404 uses root paths');
});

test('a GoatCounter code adds count.js, with a no-JavaScript image fallback, to each page', async () => {
  const out = path.join(tmpDir('oat-pages-'), 'site');
  await writeSite([art('water', 'part-01', { part: '01' })], out, { series: SERIES, baseUrl: 'https://owensappliedthinking.com', goatcounter: 'oat' });
  const home = read(out, 'index.html');
  assert.ok(home.includes(`<noscript><img class="count" src="https://oat.goatcounter.com/count?p=/&amp;t=Owen's%20Applied%20Thinking" alt="" width="1" height="1"></noscript>`), home.match(/<noscript>.*<\/noscript>/));
  const script = home.match(/<script [^>]*><\/script>/);
  assert.ok(script, 'home page has the counter script');
  assert.ok(script[0].includes('data-goatcounter="https://oat.goatcounter.com/count"'), script[0]);
  assert.ok(script[0].includes('src="https://gc.zgo.at/count.v4.js"') && /integrity="sha384-[A-Za-z0-9+/=]+"/.test(script[0]) && script[0].includes('crossorigin="anonymous"'), 'pinned script with SRI');
  // Same path and short title as the image, so GoatCounter's page list stays the same.
  const settings = (html) => JSON.parse(html.match(/data-goatcounter-settings="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.deepStrictEqual(settings(home), { path: '/', title: "Owen's Applied Thinking" });
  assert.deepStrictEqual(settings(read(out, 'about/index.html')), { path: '/about/', title: 'About' });
  assert.strictEqual(settings(read(out, 'writing/water/part-01/index.html')).path, '/writing/water/part-01/');
  assert.ok(read(out, 'about/index.html').includes('&amp;t=About"'), 'fallback image title sent without the site name');
  assert.ok(!read(out, '404.html').includes('goatcounter'), 'not-found pages are not counted');
  for (const f of ['index.html', 'writing/water/part-01/index.html']) {
    const html = read(out, f);
    assert.strictEqual((html.match(/<script/gi) || []).length, 1, `${f}: the counter is the only script`);
    assert.ok(!/<img class="count"/.test(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '')), `${f}: image only inside <noscript>, so no double count`);
  }
  const plain = path.join(tmpDir('oat-pages-'), 'site');
  await writeSite([art('water', 'part-01', { part: '01' })], plain, { series: SERIES, baseUrl: 'https://owensappliedthinking.com' });
  assert.ok(!read(plain, 'index.html').includes('goatcounter'), 'no code, no counter');
  assert.ok(!/<script/i.test(read(plain, 'index.html')), 'no code, no JavaScript at all');
  await assert.rejects(() => writeSite([], path.join(tmpDir('oat-pages-'), 'site'), { series: SERIES, goatcounter: 'evil.com/x?' }), /bad GoatCounter code/);
});

test('fails on an article whose series is not in the series file', async () => {
  const out = path.join(tmpDir('oat-pages-'), 'site');
  await assert.rejects(
    () => writeSite([art('unknown', 'a')], out, { series: SERIES }),
    (err) => err instanceof GateError && /series "unknown"/.test(err.message)
  );
  assert.ok(!fs.existsSync(out), 'nothing written');
});

test('fails on an article that carries a script', async () => {
  const out = path.join(tmpDir('oat-pages-'), 'site');
  await assert.rejects(
    () => writeSite([art('vectors', 'a', { body: 'Text <script>alert(1)</script>' })], out, { series: SERIES }),
    /no JavaScript besides its one analytics script/
  );
});

test('an <img> tag written across lines renders as an image and is copied', async () => {
  const img = await startImageServer();
  try {
    const out = path.join(tmpDir('oat-pages-'), 'site');
    const body = `Opening paragraph that is long enough to describe the piece.\n\n---\n\n<img \n  src="${img.base}/logo.png" \n  alt="Natural Gas Symbol" \n  style="width: 200px; float: right;"\n>\n\n## The Premise\n\nText.`;
    await writeSite([art('vectors', 'a', { body })], out, { series: SERIES });
    const page = read(out, 'writing/vectors/a/index.html');
    assert.ok(/<img src="\.\.\/\.\.\/\.\.\/assets\/[0-9a-f]{16}\.png" alt="Natural Gas Symbol" style="width: 200px; float: right;">/.test(page), 'one-line tag pointing at the copy');
    assert.ok(!page.includes('&lt;img') && !/<blockquote>\s*<\/blockquote>/.test(page), 'no tag text, no empty quote');
  } finally {
    img.close();
  }
});

test('fails when raw HTML would show as text', async () => {
  const out = path.join(tmpDir('oat-pages-'), 'site');
  await assert.rejects(
    () => writeSite([art('vectors', 'a', { body: 'Text.\n\n<span \n  class="x"\n>\n\nMore.' })], out, { series: SERIES }),
    /raw HTML would show as text/
  );
});

test('fails when an image cannot be downloaded', async () => {
  const img = await startImageServer();
  try {
    const out = path.join(tmpDir('oat-pages-'), 'site');
    await assert.rejects(
      () => writeSite([art('vectors', 'a', { body: `![x](${img.base}/missing.png)` })], out, { series: SERIES }),
      /HTTP 404/
    );
    assert.strictEqual(img.hits.length, 1, 'a 404 is not retried');
  } finally {
    img.close();
  }
});

test('retries a busy image host, then gives up with the reason', async () => {
  const img = await startImageServer();
  try {
    const out = path.join(tmpDir('oat-pages-'), 'site');
    await writeSite([art('vectors', 'a', { body: `![x](${img.base}/busy.png)` })], out, { series: SERIES, retryDelaysMs: [0, 0] });
    assert.strictEqual(img.hits.length, 3, 'two 503s, then success');
    const out2 = path.join(tmpDir('oat-pages-'), 'site');
    await assert.rejects(
      () => writeSite([art('vectors', 'b', { body: `![x](${img.base}/down.png)` })], out2, { series: SERIES, retryDelaysMs: [0] }),
      /HTTP 503 \(Service Unavailable\) after 2 tries/
    );
  } finally {
    img.close();
  }
});

test('reads the series file from main', () => {
  const dir = tmpDir('oat-series-repo-');
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }
  });
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'site'));
  fs.writeFileSync(path.join(dir, 'site/series.json'), JSON.stringify([{ id: 'water', name: 'Water', description: 'W', order: 1 }]));
  git('add', '-A');
  git('commit', '-q', '-m', 'series');
  const s = readSeries(dir);
  assert.deepStrictEqual([...s.keys()].sort(), ['vectors', 'water']);

  fs.writeFileSync(path.join(dir, 'site/series.json'), JSON.stringify([{ id: 'standalone', name: 'S', description: 'S', order: 9 }]));
  git('commit', '-q', '-am', 'old id');
  assert.throws(() => readSeries(dir), /old series id; use "vectors"/);

  fs.writeFileSync(path.join(dir, 'site/series.json'), '[{"id":"Bad Id"}]');
  git('commit', '-q', '-am', 'bad');
  assert.throws(() => readSeries(dir), /lowercase/);
});

test('captions skip the brand block and keep hyphens', () => {
  const body = [
    '<img src="x.png" alt="It\'s not activism. It\'s not theory. It\'s engineering.">',
    '',
    '*Exploring the hidden logic and overlooked systems of everyday life, from the perspective of an engineer.*',
    '',
    '*It\u2019s not activism. It\u2019s not theory. It\u2019s engineering.*',
    '',
    'Sixty-four codons. Twenty amino acids. One code, from the Jordan-Euphrates-Nile corridor.',
    ''
  ].join('\n');
  assert.strictEqual(firstParagraph(body), 'Sixty-four codons. Twenty amino acids. One code, from the Jordan-Euphrates-Nile corridor.');
  assert.strictEqual(firstParagraph('- a list item that is long enough to be used as a caption here\n'),
    'a list item that is long enough to be used as a caption here');
});

test('covers show on cards and above the article title; no cover gets the OAT tile', async () => {
  const img = await startImageServer();
  try {
    const articles = [
      art('water', 'part-01', { part: '01', cover: `${img.base}/cover-one.png` }),
      art('water', 'part-02', { part: '02' }),
      art('water', 'part-03', { part: '03', cover: `${img.base}/cover-one.png`, body: `# Three\n\nOpening paragraph of part three, long enough to describe it.\n\n![map](${img.base}/cover-one.png)` }),
      art('vectors', 'essay')
    ];
    const out = path.join(tmpDir('oat-cover-'), 'site');
    await writeSite(articles, out, { series: SERIES, baseUrl: 'https://owencorpening.github.io/oat-web' });
    const assets = fs.readdirSync(path.join(out, 'assets'));
    assert.strictEqual(assets.length, 1, 'cover copied into the site');
    const local = `assets/${assets[0]}`;

    const one = read(out, 'writing/water/part-01/index.html');
    assert.ok(one.includes(`<figure class="cover"><img src="../../../${local}" alt=""></figure>\n<h1>`), 'cover above the title');
    assert.ok(one.includes(`<meta property="og:image" content="https://owencorpening.github.io/oat-web/${local}">`), 'social preview image');
    assert.ok(!one.includes('127.0.0.1'), 'cover served from the site, not the original host');
    const two = read(out, 'writing/water/part-02/index.html');
    assert.ok(!two.includes('class="cover"') && !two.includes('og:image'), 'no cover, no figure');

    const series = read(out, 'writing/water/index.html');
    assert.ok(series.includes(`<img class="thumb" src="../../${local}"`), 'thumbnail on the card');
    const three = read(out, 'writing/water/part-03/index.html');
    assert.ok(three.includes(`src="../../../${local}"`) && !three.includes('class="cover"'), 'a cover already in the article is not repeated above the title');
    assert.strictEqual(series.split('<span class="thumb none"').length - 1, 1, 'OAT tile for the piece without a cover');
    const writing = read(out, 'writing/index.html');
    assert.ok(writing.includes(`<img class="thumb" src="../${local}"`), 'series card uses its first cover');
    assert.ok(writing.includes('<span class="thumb none"'), 'series with no cover gets the tile');
    assert.ok(read(out, 'index.html').includes(`<img class="thumb" src="${local}"`), 'Writing door uses the first cover');
  } finally {
    img.close();
  }
});

test('OAT home has three doors; every page has the menu; sections get breadcrumbs', async () => {
  const out = path.join(tmpDir('oat-sections-'), 'site');
  await writeSite([art('water', 'part-01', { part: '01' }), art('water', 'part-02', { part: '02' }), art('vectors', 'essay')], out, { series: SERIES, baseUrl: 'https://owensappliedthinking.com' });
  const home = read(out, 'index.html');
  const doors = home.split('<div class="doors">')[1];
  assert.ok(doors, 'home has the doors list');
  assert.ok(doors.includes('<a href="writing/">Writing</a><p>Water Resilience and Vectors · 3 articles</p>'), doors);
  assert.ok(doors.includes('<a href="tools/">Free tools</a><p>Search Grid, riffkit, Image Attribution Logger and Cheatsheets · 4 tools</p>'));
  assert.ok(doors.includes('<a href="products/">Products</a><p>Coming soon</p>'));
  assert.ok(!home.includes('class="crumbs"'), 'no breadcrumbs on the OAT home');
  assert.ok(home.includes('<a class="home" href="./">'), 'logo links to the OAT home');

  const nav = (html) => html.match(/<nav aria-label="Site">(.*?)<\/nav>/)[1];
  assert.strictEqual(nav(home), '<a href="writing/">Writing</a><a href="tools/">Free tools</a><a href="products/">Products</a><a href="about/">About</a>');
  const art1 = read(out, 'writing/water/part-01/index.html');
  assert.ok(art1.includes('<a class="home" href="../../../">'), 'article logo goes to the OAT home');
  assert.ok(nav(art1).includes('<a href="../../../writing/" aria-current="true">Writing</a>'), 'Writing marked in the menu');
  assert.ok(art1.includes('<nav class="crumbs" aria-label="Breadcrumb"><a href="../../../">OAT</a><span class="sep" aria-hidden="true">›</span><a href="../../">Writing</a><span class="sep" aria-hidden="true">›</span><a href="../">Water Resilience</a></nav>\n<main>'), 'breadcrumb band under the header');
  assert.ok(read(out, 'writing/water/index.html').includes('<a href="../">Writing</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Water Resilience</span></nav>'));
  assert.ok(nav(read(out, 'writing/index.html')).includes('aria-current="page">Writing'));

  const tools = read(out, 'tools/index.html');
  assert.ok(nav(tools).includes('<a href="../tools/" aria-current="page">Free tools</a>'));
  assert.ok(tools.includes('<a href="../tools/search-grid/">Search Grid') && tools.includes('src="../brand/search-grid-icon.png"'));
  assert.ok(tools.includes('href="https://github.com/owencorpening/riffkit"') && tools.includes('href="https://github.com/owencorpening/image-capture"') && tools.includes('<a href="../tools/cheatsheets/">Cheatsheets</a>') && tools.includes('src="../brand/cheatsheets-icon.png"'));
  const sheets = read(out, 'tools/cheatsheets/index.html');
  assert.ok(sheets.includes('<a href="../">Free tools</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Cheatsheets</span>'));
  assert.ok(sheets.includes('<link rel="canonical" href="https://owensappliedthinking.com/tools/cheatsheets/">'), 'extension homepage URL fixed');
  assert.ok(sheets.includes('collects nothing, sends nothing') && sheets.includes('href="https://github.com/owencorpening/cheatsheets-vscode/issues"'));
  const grid = read(out, 'tools/search-grid/index.html');
  assert.ok(grid.includes('<a href="../">Free tools</a><span class="sep" aria-hidden="true">›</span><span aria-current="page">Search Grid</span>'));
  assert.ok(grid.includes('<link rel="canonical" href="https://owensappliedthinking.com/tools/search-grid/">'), 'extension page URL unchanged');
  assert.ok(read(out, 'products/index.html').includes('<h1>Products</h1>\n<p class="meta">Coming soon.</p>'));
  assert.ok(nav(read(out, 'about/index.html')).includes('aria-current="page">About'));
  const nf = read(out, '404.html');
  assert.ok(nav(nf).startsWith('<a href="/writing/">'), '404 menu uses root paths');
});

test('a series id that matches a site section fails the build', async () => {
  const series = new Map([...SERIES, ['tools', { id: 'tools', name: 'Tools', description: 'd', order: 5 }]]);
  await assert.rejects(() => writeSite([art('tools', 'a')], path.join(tmpDir('oat-pages-'), 'site'), { series }),
    (err) => err instanceof GateError && /series id "tools" is taken/.test(err.message));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok  ${t.name}`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${t.name}\n       ${err.message.split('\n').join('\n       ')}`);
    }
  }
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
  if (failed) {
    console.error(`pages: ${failed} of ${tests.length} failed`);
    process.exit(1);
  }
  console.log(`pages tests passed (${tests.length})`);
})();
