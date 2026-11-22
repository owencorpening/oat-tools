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

test('builds home, series, article and not-found pages with no JavaScript', async () => {
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
      '404.html', 'index.html', 'standalone/essay/index.html', 'standalone/index.html',
      'vectors/essay/index.html', 'vectors/index.html', 'water/index.html', 'water/manifesto/index.html', 'water/part-01/index.html', 'water/part-02/index.html'
    ]);
    assert.strictEqual(files.filter((f) => f.startsWith('assets/')).length, 1, 'one image, copied once');
    assert.strictEqual(img.hits.length, 1, 'image downloaded once');

    for (const f of files.filter((x) => x.endsWith('.html'))) {
      const html = read(out, f);
      assert.ok(!/<script|<iframe|\son[a-z]+=/i.test(html), `${f} has no JavaScript`);
      assert.ok(!html.includes('127.0.0.1'), `${f} loads nothing from outside`);
      assert.ok(!html.includes('CANARY_'), `${f} shows nothing from an empty series`);
    }

    const home = read(out, 'index.html');
    assert.ok(home.indexOf('Water Resilience') < home.indexOf('Vectors'), 'series in order, vectors last');
    assert.ok(home.includes('href="water/"') && home.includes('href="vectors/"'));
    assert.ok(!home.includes('href="standalone/"'), 'old series id is not listed');

    const moved = read(out, 'standalone/essay/index.html');
    assert.ok(moved.includes('<meta http-equiv="refresh" content="0; url=../../vectors/essay/">'), 'old article URL redirects');
    assert.ok(moved.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/vectors/essay/">'));
    assert.ok(read(out, 'standalone/index.html').includes('url=../vectors/'), 'old series URL redirects');
    assert.ok(!home.includes('CNG'), 'a series with no published article is hidden');
    assert.ok(home.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/">'));

    const series = read(out, 'water/index.html');
    const order = ['part-01/', 'part-02/', 'manifesto/'].map((s) => series.indexOf(`href="${s}"`));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'numbered parts first, then the rest');

    const p1 = read(out, 'water/part-01/index.html');
    assert.ok(p1.includes('Opening paragraph of part one'), 'article text is in the HTML');
    assert.ok(!p1.includes('<h1>Part one</h1>'), 'leading title line is not repeated');
    assert.ok(/<img [^>]*src="\.\.\/\.\.\/assets\/[0-9a-f]{16}\.png"/.test(p1), 'image points at the copy');
    assert.ok(p1.includes('href="../../water/part-02/"'), 'link to a published article goes to its site page');
    assert.ok(p1.includes('href="https://www.who.int/report?r=keep"'), 'non-Substack links untouched');
    assert.ok(p1.includes('<a href="../">Water Resilience</a>') && p1.includes('Part 1'));
    assert.ok(p1.includes('href="../part-02/"'), 'next link');
    assert.ok(p1.includes('<a href="../">guide</a>') && !p1.includes('series-guide'), 'series-guide link goes to the series page');
    assert.ok(p1.includes('Also on <a href="https://owencorpening.substack.com/p/part-one">Substack</a>'));
    assert.ok(p1.includes('<link rel="canonical" href="https://owencorpening.github.io/oat-web/water/part-01/">'));
    assert.ok(p1.includes('<link rel="stylesheet" href="../../style.css">'));

    const essay = read(out, 'vectors/essay/index.html');
    assert.ok(essay.includes('<a href="../">Vectors</a>') && essay.includes('LinkedIn'));
    assert.strictEqual(essay.split('<h1>Title essay</h1>').length - 1, 1, 'title heading after a hero image is not repeated');

    const nf = read(out, '404.html');
    assert.ok(nf.includes('href="/oat-web/style.css"') && nf.includes('href="/oat-web/"'));
    assert.ok(!nf.includes('part-01') && !nf.includes('rel="canonical"'), '404 lists nothing');
  } finally {
    img.close();
  }
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
    /no JavaScript/
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
