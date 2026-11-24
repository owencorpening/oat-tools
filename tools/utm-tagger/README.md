# utm-tagger

`add-utm.py` appends `?utm_campaign=<channel>` to links that point at the
**Owen's Applied Thinking site**, and leaves every other link alone. Run it when
preparing a post or caption for a given channel, so clicks from that channel
show up in GoatCounter (which reads `utm_campaign`).

## Why a publish-time transform

The same source markdown goes to several channels (Substack, LinkedIn, Buffer…),
each needing a *different* `utm_campaign`. So the tag can't be baked into the
source — you apply it as you prepare each channel's copy.

## Usage

```bash
python3 add-utm.py linkedin < post.md > post.linkedin.md   # stdin  -> stdout
python3 add-utm.py substack post.md > post.substack.md     # file   -> stdout
python3 add-utm.py buffer -i caption.md                    # edit file in place
```

Channel values come from **`oat-standards/standards/utm-campaign-tags.md`** —
the approved list is kept in sync with `KNOWN_CHANNELS` in the script (an
unknown channel warns but still tags).

## What counts as "the OAT site"

Matched by host (both forms are the same site via CNAME):

- `owensappliedthinking.com` / `www.owensappliedthinking.com` — the custom domain
- `owencorpening.github.io/oat-web/…` — the raw GitHub Pages form

Everything else is untouched: Substack, LinkedIn, GitHub repos, external
citations, and even other `owencorpening.github.io` paths that aren't `/oat-web`.

## Behavior

- **Idempotent / re-taggable** — an existing `utm_campaign` is replaced, so
  re-running (or tagging the same text for a different channel) is safe.
- Other query params and the `#fragment` are preserved.
- Works on Markdown links, reference definitions, bare URLs (trailing sentence
  punctuation is handled), and HTML `href=""`.
- Applies to **clickable text** — a Substack post body, a LinkedIn/Buffer
  caption. It does not touch links baked into carousel *images* (those aren't
  clickable anyway).
