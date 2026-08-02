# Text-Blockiness Report

Scores markdown articles for "text-blockiness" — how much unbroken prose sits
between visual breaks (headings, images, tables, blockquotes, code fences,
horizontal rules, or existing pullquotes).

Purpose: triage a backlog of published articles to find which ones would
benefit most from pullquotes, before reprocessing everything.

## Usage

```bash
npm run report:blockiness -- ~/dev/oat-content/substack-published
```

JSON output:

```bash
npm run report:blockiness -- ~/dev/oat-content/substack-published --json
```

Custom pullquote marker (default `>>`):

```bash
npm run report:blockiness -- path/to/article.md --pullquote-marker=">>"
```

Accepts a single markdown file or a directory (recursed, skipping
`node_modules` and dotfolders). Ranks results by blockiness score, highest
first, and lists the top 5 candidates for `add-pullquotes`.
