'use strict';

// The OAT site publish gate.
//
// An article is published only when ALL of these hold:
//   1. A tag named pub/<series>/<slug>/<YYYY-MM-DD>[.N] exists (newest wins).
//   2. The tagged commit is on the main branch.
//   3. At that commit, exactly one Markdown file has front matter with that
//      slug and series (no `series` field means "standalone").
//   4. That file says `text_status: published` and has every required field.
//   5. On main today, that article still says `text_status: published`
//      (otherwise it has been unpublished and is dropped).
//
// The article text comes from the tagged commit only. Nothing is ever read
// by walking folders, so drafts, notes and corrections can't be picked up.
// Any problem with a tagged article is an error and stops the build.

const { execFileSync } = require('child_process');
const { parseFrontMatter } = require('./frontMatter');
const { extractLinks, placeholderProblems } = require('./sopChecks');
const { SERIES_GUIDE_SLUGS } = require('./render');

const TAG_PATTERN = /^pub\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/; // a time after the date is allowed and ignored
const TYPES = new Set(['substack-article', 'linkedin-article', 'linkedin-post']);
const STANDALONE = 'standalone';

class GateError extends Error {
  constructor(problems) {
    super(`Publish gate failed:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

function git(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitOk(repoDir, args) {
  try {
    git(repoDir, args);
    return true;
  } catch (err) {
    return false;
  }
}

function seriesOf(data) {
  return data.series && data.series.trim() ? data.series.trim() : STANDALONE;
}

// Newest tag per series/slug. Malformed pub/ tags are errors, not skipped.
function listPublishTags(repoDir, problems) {
  const out = git(repoDir, ['tag', '--list', 'pub/*']).trim();
  const newest = new Map();
  if (!out) return newest;
  for (const name of out.split('\n')) {
    const m = TAG_PATTERN.exec(name);
    if (!m) {
      problems.push(`tag ${name}: name must be pub/<series>/<slug>/<YYYY-MM-DD>[.N]`);
      continue;
    }
    const [, series, slug, date, seq] = m;
    const key = `${series}/${slug}`;
    const rank = `${date}.${String(Number(seq || 0)).padStart(6, '0')}`;
    const prev = newest.get(key);
    if (!prev || rank > prev.rank) {
      newest.set(key, { name, series, slug, date, rank });
    }
  }
  return newest;
}

// Files at `ref` whose front matter names this slug and series.
function findArticleFiles(repoDir, ref, series, slug) {
  const pattern = `^slug:[[:space:]]*["']?${slug}["']?[[:space:]]*$`;
  let out = '';
  try {
    out = git(repoDir, ['grep', '-l', '-E', pattern, ref, '--', '*.md']);
  } catch (err) {
    if (err.status === 1) return []; // git grep: no matches
    throw err;
  }
  const matches = [];
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const filePath = line.slice(ref.length + 1);
    const text = git(repoDir, ['show', `${ref}:${filePath}`]);
    const { data, body } = parseFrontMatter(text);
    if (!data || data.slug !== slug || seriesOf(data) !== series) continue;
    matches.push({ path: filePath, data, body });
  }
  return matches;
}

function checkFields(where, data) {
  const problems = [];
  if (data.text_status !== 'published') {
    problems.push(`${where}: text_status is "${data.text_status || ''}", not "published"`);
  }
  if (String(data.marp).toLowerCase() === 'true') {
    problems.push(`${where}: is a carousel (marp: true) and can't be published to the site`);
  }
  if (!data.title) problems.push(`${where}: missing title`);
  if (!data.published || !DATE_PATTERN.test(data.published)) {
    problems.push(`${where}: published must be a YYYY-MM-DD date (a time after it is fine)`);
  }
  if (!data.slug || !SLUG_PATTERN.test(data.slug)) {
    problems.push(`${where}: slug must be lowercase letters, digits and hyphens`);
  }
  if (!TYPES.has(data.type)) {
    problems.push(`${where}: type must be one of ${[...TYPES].join(', ')}`);
  }
  return problems;
}

// Returns the published articles. Throws GateError if anything is wrong.
function selectPublished(repoDir, options = {}) {
  const mainRef = options.mainRef || 'main';
  const problems = [];
  const articles = [];

  if (!gitOk(repoDir, ['rev-parse', '--verify', `${mainRef}^{commit}`])) {
    throw new GateError([`main branch "${mainRef}" not found`]);
  }

  for (const tag of listPublishTags(repoDir, problems).values()) {
    const commit = git(repoDir, ['rev-list', '-n', '1', tag.name]).trim();
    const where = `tag ${tag.name}`;

    if (!gitOk(repoDir, ['merge-base', '--is-ancestor', commit, mainRef])) {
      problems.push(`${where}: tagged commit is not on ${mainRef}`);
      continue;
    }

    const atTag = findArticleFiles(repoDir, commit, tag.series, tag.slug);
    if (atTag.length !== 1) {
      problems.push(`${where}: expected exactly one article with this series and slug at the tagged commit, found ${atTag.length}`);
      continue;
    }
    const article = atTag[0];
    const fieldProblems = checkFields(`${where} (${article.path})`, article.data);
    if (fieldProblems.length) {
      problems.push(...fieldProblems);
      continue;
    }

    const onMain = findArticleFiles(repoDir, mainRef, tag.series, tag.slug)
      .filter((f) => f.data.text_status === 'published');
    if (onMain.length === 0) {
      // Unpublished on main: dropped on purpose, not an error.
      continue;
    }

    articles.push({
      series: tag.series,
      slug: tag.slug,
      title: article.data.title,
      published: article.data.published.slice(0, 10),
      type: article.data.type,
      part: article.data.part || null,
      description: article.data.description || null,
      substackUrl: article.data.substack_url || null,
      linkedinUrl: article.data.linkedin_url || null,
      body: article.body,
      tag: tag.name,
      commit,
      sourcePath: article.path
    });
  }

  problems.push(...checkLinksToUnpublished(articles));

  if (problems.length) throw new GateError(problems);
  return articles.sort((a, b) => (a.series + a.slug).localeCompare(b.series + b.slug));
}

// A published article must not link to an OAT article that isn't published
// (the link alone would reveal that the draft exists), and must not carry
// placeholder links (pre-publish SOP).
function checkLinksToUnpublished(articles) {
  const problems = [];
  const publishedSubstack = new Set(
    articles.map((a) => normalizeSubstack(a.substackUrl)).filter(Boolean)
  );
  for (const a of articles) {
    problems.push(...placeholderProblems(a));
    for (const { url } of extractLinks(a.body)) {
      const substack = normalizeSubstack(url);
      if (SERIES_GUIDE_SLUGS.has(substack) && a.series !== STANDALONE) {
        continue; // becomes a link to the article's series page
      }
      if (substack && !publishedSubstack.has(substack)) {
        problems.push(`${a.tag}: links to ${url}, which is not a published article on the site`);
      } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && /\.md(#.*)?$/i.test(url)) {
        problems.push(`${a.tag}: links to the repo file ${url}`);
      }
    }
  }
  return problems;
}

function normalizeSubstack(url) {
  if (!url) return null;
  const m = /^https?:\/\/owencorpening\.substack\.com\/p\/([A-Za-z0-9-]+)/.exec(url);
  return m ? m[1].toLowerCase() : null;
}

module.exports = { selectPublished, GateError, TAG_PATTERN };
