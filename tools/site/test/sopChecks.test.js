'use strict';

// Pre-publish SOP checks: placeholder links and the Sources section.
// All fixtures are made up.

const assert = require('assert');
const { extractLinks, placeholderProblems, sourcesProblem } = require('../lib/sopChecks');

const CTA = '*[Owen\'s Applied Thinking — owencorpening.substack.com](https://owencorpening.substack.com)*';

function art(body, type = 'substack-article') {
  return { tag: 'pub/standalone/a/2025-01-01', type, body };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('finds inline, image, href and reference-style links', () => {
  const urls = extractLinks('[a](https://x.test/1 "t") ![i](https://x.test/i.png) <a href="https://x.test/2">b</a>\n\n[1]: https://x.test/3 "Ref"\n[![logo](https://x.test/l.png)](https://x.test/4)')
    .map((l) => l.url).sort();
  assert.deepStrictEqual(urls, ['https://x.test/1', 'https://x.test/2', 'https://x.test/3', 'https://x.test/4', 'https://x.test/i.png', 'https://x.test/l.png']);
});

test('flags placeholder link targets', () => {
  for (const target of ['link', '', '#', 'TODO', 'https://example.test/TBD']) {
    const p = placeholderProblems(art(`See [the report](${target}).`));
    assert.strictEqual(p.length, 1, `target "${target}" is flagged`);
    assert.ok(/placeholder link/.test(p[0]));
  }
  assert.strictEqual(placeholderProblems(art('[1]: link')).length, 1, 'reference definition too');
});

test('flags a homepage link standing in for an article, allows the CTA block', () => {
  const p = placeholderProblems(art('As I wrote in [Part II](https://owencorpening.substack.com/).'));
  assert.strictEqual(p.length, 1);
  assert.ok(/Substack homepage/.test(p[0]));
  assert.deepStrictEqual(placeholderProblems(art(`Text.\n\n${CTA}`)), []);
  assert.deepStrictEqual(placeholderProblems(art('[Subscribe here](https://owencorpening.substack.com)')), []);
});

test('real links and section anchors are fine', () => {
  assert.deepStrictEqual(placeholderProblems(art('[WHO](https://www.who.int/r) [jump](#costs) [p](https://owencorpening.substack.com/p/part-one)')), []);
});

test('Sources section: heading, bold line or details block', () => {
  assert.strictEqual(sourcesProblem(art('## Sources\n\n1. x')), null);
  assert.strictEqual(sourcesProblem(art('**References**\n\n1. x')), null);
  assert.strictEqual(sourcesProblem(art('<details>\n<summary>Sources</summary>\nx\n</details>')), null);
  assert.ok(/no Sources section/.test(sourcesProblem(art('Just an essay.'))));
  assert.ok(/no Sources section/.test(sourcesProblem(art('Text.', 'linkedin-article'))));
  assert.strictEqual(sourcesProblem(art('Short post.', 'linkedin-post')), null, 'LinkedIn posts are exempt');
});

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
if (failed) {
  console.error(`sopChecks: ${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`sopChecks tests passed (${tests.length})`);
