'use strict';

// The OAT site publish gate.
//
// An article is published only when ALL of these hold:
//   1. A tag named pub/<series>/<slug>/<YYYY-MM-DD>[.N] exists (newest wins).
//   2. The tagged commit is on the main branch.
//   3. At that commit, exactly one Markdown file has front matter with that
//      slug and series (no `series` field means the default series,
//      "vectors"; the old id "standalone" is accepted as the same series).
//   4. That file says `text_status: published` and has every required field.
//   5. On main today, that article still says `text_status: published`
//      (otherwise it has been unpublished and is dropped).
//
// Moving an article to another series: change `series` on main and tag it
// under the new series. Its tags under the old series are then ignored, and
// the article carries `formerSeries` so the site can redirect the old URLs.
// If main names a series the article has no tag for yet, that is an error,
// so the build stops instead of quietly dropping the article.
//
// The article text comes from the tagged commit only. Nothing is ever read
// by walking folders, so drafts, notes and corrections can't be picked up.
// Any problem with a tagged article is an error and stops the build.

const { execFileSync } = require('child_process');
const { parseFrontMatter } = require('./frontMatter');
const { extractLinks, placeholderProblems } = require('./sopChecks');
const { SERIES_GUIDE_SLUGS } = require('./render');
const { DEFAULT_SERIES, normalizeSeriesId } = require('./series');

const TAG_PATTERN = /^pub\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/; // a time after the date is allowed and ignored
const TYPES = new Set(['substack-article', 'linkedin-article', 'linkedin-post']);

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
  return normalizeSeriesId(data.series);
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
    const [, tagSeries, slug, date, seq] = m;
    const series = normalizeSeriesId(tagSeries); // pub/standalone/... counts as vectors
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

// Files on main with this slug that say text_status: published, any series.
function findPublishedOnMain(repoDir, mainRef, slug) {
  const pattern = `^slug:[[:space:]]*["']?${slug}["']?[[:space:]]*$`;
  let out = '';
  try {
    out = git(repoDir, ['grep', '-l', '-E', pattern, mainRef, '--', '*.md']);
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
  const found = [];
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const filePath = line.slice(mainRef.length + 1);
    const { data } = parseFrontMatter(git(repoDir, ['show', `${mainRef}:${filePath}`]));
    if (data && data.slug === slug && data.text_status === 'published') found.push(data);
  }
  return found;
}

// Picks which tags to build when a slug has been tagged under more than one
// series, or when main has moved it to a series it isn't tagged under yet.
function resolveMoves(repoDir, mainRef, tags, problems) {
  const bySlug = new Map();
  for (const tag of tags) {
    if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, []);
    bySlug.get(tag.slug).push(tag);
  }
  const kept = [];
  for (const [slug, group] of bySlug) {
    const onMain = new Set(findPublishedOnMain(repoDir, mainRef, slug).map(seriesOf));
    const stay = group.filter((t) => onMain.has(t.series));
    const gone = group.filter((t) => !onMain.has(t.series));
    if (onMain.size === 0) {
      kept.push(...group); // unpublished on main; dropped later as before
      continue;
    }
    const untagged = [...onMain].filter((s) => !group.some((t) => t.series === s));
    if (stay.length === 0 && untagged.length) {
      problems.push(`${slug}: main puts it in series "${untagged.join('", "')}" but it has no pub/${untagged[0]}/${slug}/<date> tag yet`);
      kept.push(...group); // still checked, so any other problem shows too
      continue;
    }
    if (stay.length === 1 && gone.length) {
      stay[0].formerSeries = [...new Set(gone.map((t) => t.series))];
    }
    kept.push(...stay);
  }
  return kept;
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
  if (data.cover && !/^https?:\/\/[^\s"<>]+$/i.test(data.cover)) {
    problems.push(`${where}: cover must be a full http(s) image URL`);
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

  const tags = resolveMoves(repoDir, mainRef, [...listPublishTags(repoDir, problems).values()], problems);
  for (const tag of tags) {
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
      cover: article.data.cover || null,
      body: article.body,
      tag: tag.name,
      formerSeries: tag.formerSeries || [],
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
      if (SERIES_GUIDE_SLUGS.has(substack) && a.series !== DEFAULT_SERIES) {
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
