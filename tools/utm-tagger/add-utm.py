#!/usr/bin/env python3
"""add-utm — tag links to Owen's Applied Thinking site with ?utm_campaign=<channel>.

Appends `utm_campaign=<channel>` to every link that points at the OAT site, and
leaves every other link untouched. Use it when preparing a post/caption for a
given channel, so clicks from that channel show up in GoatCounter.

The OAT site is matched by host (same site, two URL forms):
  - owensappliedthinking.com (and www.)       — the custom domain
  - owencorpening.github.io/oat-web/...        — the raw GitHub Pages form

Everything else — Substack, LinkedIn, GitHub repos, external citations — is
left exactly as-is.

Usage:
  python3 add-utm.py linkedin < post.md > post.linkedin.md     # stdin -> stdout
  python3 add-utm.py substack post.md > post.substack.md       # file  -> stdout
  python3 add-utm.py buffer -i caption.md                      # edit in place

The transform is idempotent: an existing utm_campaign is replaced (so you can
re-tag the same text for a different channel), other query params and the #fragment
are preserved. Channel values should come from
oat-standards/standards/utm-campaign-tags.md.
"""
import sys
import re
import argparse
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

# Approved channel tags — kept in sync with oat-standards utm-campaign-tags.md.
KNOWN_CHANNELS = {
    "linkedin", "substack", "buffer", "x", "bluesky", "email", "instagram",
}

# A URL token: http(s):// up to the first whitespace or markdown/HTML delimiter
# ( ) [ ] < > " ' . Trailing sentence punctuation is trimmed separately.
URL_RE = re.compile(r"""https?://[^\s<>"'\)\]]+""")


def is_oat_site(parts):
    host = (parts.hostname or "").lower()
    if host in ("owensappliedthinking.com", "www.owensappliedthinking.com"):
        return True
    if host == "owencorpening.github.io" and parts.path.startswith("/oat-web"):
        return True
    return False


def tag_url(url, channel):
    parts = urlsplit(url)
    if not is_oat_site(parts):
        return url
    # drop any existing utm_campaign, keep everything else in order, re-add ours
    q = [(k, v) for (k, v) in parse_qsl(parts.query, keep_blank_values=True)
         if k.lower() != "utm_campaign"]
    q.append(("utm_campaign", channel))
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(q), parts.fragment))


def transform(text, channel):
    def repl(m):
        url = m.group(0)
        tail = ""
        # move trailing sentence punctuation out of the URL (bare URLs in prose)
        while url and url[-1] in ".,;:!?":
            tail = url[-1] + tail
            url = url[:-1]
        return tag_url(url, channel) + tail
    return URL_RE.sub(repl, text)


def main():
    ap = argparse.ArgumentParser(
        description="Append ?utm_campaign=<channel> to OAT-site links only.")
    ap.add_argument("channel", help="channel tag, e.g. linkedin / substack / buffer")
    ap.add_argument("files", nargs="*", help="input files (default: stdin)")
    ap.add_argument("-i", "--in-place", action="store_true",
                    help="rewrite the given files in place instead of writing to stdout")
    args = ap.parse_args()

    channel = args.channel.strip().lower()
    if channel not in KNOWN_CHANNELS:
        print(f"add-utm: warning: '{channel}' is not an approved channel "
              f"({', '.join(sorted(KNOWN_CHANNELS))}); tagging anyway. "
              f"See oat-standards utm-campaign-tags.md.", file=sys.stderr)

    if args.in_place:
        if not args.files:
            ap.error("--in-place needs one or more files")
        for path in args.files:
            with open(path, "r", encoding="utf-8") as f:
                out = transform(f.read(), channel)
            with open(path, "w", encoding="utf-8") as f:
                f.write(out)
        return

    if args.files:
        data = "".join(open(p, "r", encoding="utf-8").read() for p in args.files)
    else:
        data = sys.stdin.read()
    sys.stdout.write(transform(data, channel))


if __name__ == "__main__":
    main()
