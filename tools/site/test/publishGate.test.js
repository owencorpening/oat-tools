'use strict';

// Proves the publish gate: unpublished text never reaches the build output.
//
// Every fixture is made up here, in a throwaway git repo. No real article or
// draft is used, because this repo is public. Each "CANARY_" string marks
// text that must never appear in the output.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { selectPublished, GateError } = require('../lib/gate');
const { writeSite } = require('../lib/writeSite');

const BUILD = path.join(__dirname, '..', 'build-site.js');
const tmpRoots = [];

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makeRepo() {
  const dir = tmpDir('oat-gate-repo-');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid'
    }
  });
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  return {
    dir,
    git,
    write(rel, content) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    },
    commit(msg) {
      git('add', '-A');
      git('commit', '-q', '-m', msg);
    },
    tag(name) {
      git('tag', name);
    }
  };
}

function article(fields, body) {
  const header = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n');
  return `---\n${header}\n---\n\n${body}\n`;
}

function good(slug, extra = {}) {
  return {
    title: `Title ${slug}`,
    text_status: 'published',
    published: '2025-11-12',
    slug,
    type: 'substack-article',
    ...extra
  };
}

function allFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

function assertNoCanary(outDir) {
  for (const file of allFiles(outDir)) {
    const text = fs.readFileSync(file, 'utf8');
    const m = /CANARY_[A-Z_]+/.exec(text);
    assert.strictEqual(m, null, `${path.relative(outDir, file)} contains ${m && m[0]}`);
  }
}

function assertGateFails(repo, expected) {
  assert.throws(
    () => selectPublished(repo.dir),
    (err) => err instanceof GateError && err.problems.some((p) => expected.test(p)),
    `expected the gate to fail with ${expected}`
  );
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------------------------------------------------------------------------

test('only tagged, published articles reach the output; drafts never do', () => {
  const repo = makeRepo();

  // A: published twice. The older version and later main edits must not leak.
  repo.write('substack-published/water/a.md',
    article(good('part-01', { series: 'water', substack_url: 'https://owencorpening.substack.com/p/part-one' }),
      'Old text CANARY_SUPERSEDED_VERSION'));
  repo.commit('a v0');
  repo.tag('pub/water/part-01/2025-01-01');
  repo.write('substack-published/water/a.md',
    article(good('part-01', { series: 'water', substack_url: 'https://owencorpening.substack.com/p/part-one' }),
      'Published text of part one.'));
  repo.commit('a v1');
  repo.tag('pub/water/part-01/2025-02-01');

  // B: standalone (no series field).
  repo.write('substack-published/standalone/b.md', article(good('b-essay'), 'Standalone essay text.'));
  repo.commit('b');
  repo.tag('pub/standalone/b-essay/2025-03-01');

  // F: tagged, then unpublished on main.
  repo.write('substack-published/water/f.md',
    article(good('part-02', { series: 'water' }), 'CANARY_UNPUBLISHED_LATER'));
  repo.commit('f');
  repo.tag('pub/water/part-02/2025-03-02');
  repo.write('substack-published/water/f.md',
    article(good('part-02', { series: 'water', text_status: 'drafting' }), 'CANARY_UNPUBLISHED_LATER'));
  repo.commit('unpublish f');

  // Drafts and notes in every risky place, none tagged.
  repo.write('substack-unpublished/water/c.md',
    article(good('part-03', { series: 'water', text_status: 'drafting' }), 'CANARY_DRAFT'));
  repo.write('substack-published/water/d.md',
    article(good('part-04', { series: 'water' }), 'CANARY_MARKED_BUT_UNTAGGED'));
  repo.write('corrections/part-10-draft.md', '# Notes\n\nCANARY_CORRECTIONS_NOTES\n');
  repo.write('content-inventory.md', '| Part X | CANARY_INVENTORY_TITLE | draft |\n');

  // Later edit to A on main, after its newest tag.
  repo.write('substack-published/water/a.md',
    article(good('part-01', { series: 'water', substack_url: 'https://owencorpening.substack.com/p/part-one' }),
      'Published text of part one. CANARY_EDIT_AFTER_TAG'));
  repo.commit('drafts, notes and an untagged edit');
  repo.tag('baseline-2026-10'); // not a pub/ tag: ignored

  const articles = selectPublished(repo.dir);
  assert.deepStrictEqual(articles.map((a) => `${a.series}/${a.slug}`), ['standalone/b-essay', 'water/part-01']);

  const out = path.join(tmpDir('oat-gate-out-'), 'site');
  writeSite(articles, out);
  const files = allFiles(out).map((f) => path.relative(out, f)).sort();
  assert.deepStrictEqual(files, ['404.html', 'index.html', 'standalone/b-essay/index.html', 'water/part-01/index.html']);
  assertNoCanary(out);
  const page = fs.readFileSync(path.join(out, 'water/part-01/index.html'), 'utf8');
  assert.ok(page.includes('Published text of part one.'), 'article text is in the page HTML');
});

test('fails when the tagged version is not marked published', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a', { text_status: 'ready' }), 'CANARY_NOT_PUBLISHED'));
  repo.commit('a');
  repo.tag('pub/standalone/a/2025-01-01');
  assertGateFails(repo, /text_status is "ready"/);
});

test('fails when the tagged commit is not on main', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a'), 'ok'));
  repo.commit('a');
  repo.git('checkout', '-q', '-b', 'side');
  repo.write('b.md', article(good('b'), 'CANARY_SIDE_BRANCH'));
  repo.commit('b');
  repo.tag('pub/standalone/b/2025-01-01');
  repo.git('checkout', '-q', 'main');
  assertGateFails(repo, /not on main/);
});

test('fails when a carousel is tagged', () => {
  const repo = makeRepo();
  repo.write('a-carousel.md', article(good('a', { marp: 'true' }), 'CANARY_CAROUSEL'));
  repo.commit('a');
  repo.tag('pub/standalone/a/2025-01-01');
  assertGateFails(repo, /carousel/);
});

test('fails when a required field is missing', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a', { title: undefined }), 'text'));
  repo.commit('a');
  repo.tag('pub/standalone/a/2025-01-01');
  assertGateFails(repo, /missing title/);
});

test('fails when a published article links to an unpublished one', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a', { substack_url: 'https://owencorpening.substack.com/p/a-live' }),
    'See [the next part](https://owencorpening.substack.com/p/secret-draft?r=1gha0n).'));
  repo.commit('a');
  repo.tag('pub/standalone/a/2025-01-01');
  assertGateFails(repo, /secret-draft/);
});

test('allows links between published articles', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a', { substack_url: 'https://owencorpening.substack.com/p/a-live' }),
    'See [b](https://owencorpening.substack.com/p/b-live?r=1gha0n).'));
  repo.write('b.md', article(good('b', { substack_url: 'https://owencorpening.substack.com/p/b-live' }), 'B.'));
  repo.commit('a and b');
  repo.tag('pub/standalone/a/2025-01-01');
  repo.tag('pub/standalone/b/2025-01-01');
  assert.strictEqual(selectPublished(repo.dir).length, 2);
});

test('fails on a malformed pub/ tag', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a'), 'text'));
  repo.commit('a');
  repo.tag('pub/Standalone/a');
  assertGateFails(repo, /tag pub\/Standalone\/a: name must be/);
});

test('fails when no file matches the tag', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a'), 'text'));
  repo.commit('a');
  repo.tag('pub/water/a/2025-01-01'); // a.md has no series, so it is standalone
  assertGateFails(repo, /found 0/);
});

test('the build command writes nothing when the gate fails', () => {
  const repo = makeRepo();
  repo.write('a.md', article(good('a', { text_status: 'drafting' }), 'CANARY_CLI'));
  repo.commit('a');
  repo.tag('pub/standalone/a/2025-01-01');
  const out = path.join(tmpDir('oat-gate-out-'), 'site');
  const run = spawnSync(process.execPath, [BUILD, '--content', repo.dir, '--out', out], { encoding: 'utf8' });
  assert.strictEqual(run.status, 1, 'build exits with an error');
  assert.ok(!fs.existsSync(out), 'no output directory is created');
  assert.ok(!/CANARY_/.test(run.stdout), 'build log does not print draft text');
});

test('the build refuses a non-empty output directory', () => {
  const out = tmpDir('oat-gate-out-');
  fs.writeFileSync(path.join(out, 'stale.html'), 'CANARY_STALE_PAGE');
  assert.throws(() => writeSite([], out), /not empty/);
});

// ---------------------------------------------------------------------------

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ok  ${t.name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${t.name}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}
for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.error(`publishGate: ${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`publishGate tests passed (${tests.length})`);
