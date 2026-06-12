#!/usr/bin/env python3
"""
blockquoteRenderer.py — OAT Blockquote Image Renderer

Extracts all markdown blockquotes from a post file and renders each
as a styled PNG for use in Substack in place of the default left-border
blockquote styling.

Design:
  Background:  #f0f7f8 (OAT light teal)
  Text color:  #003366 (OAT navy)
  Font:        Liberation Sans Italic (pull quote body)
  Decorative:  Large opening quote mark in #94d2bd (OAT light teal)
  Drop shadow: yes, soft Gaussian
  Border:      none
  Padding:     generous
  Max width:   700px
  Watermark:   owencorpening.substack.com, bottom right, low opacity

Usage:
  python tools/blockquoteRenderer.py substack-ideas/[series]/[post]/post.md

Output:
  substack-ideas/[series]/[post]/blockquotes/blockquote-01.png ...

Next steps after running:
  1. Commit PNGs to owencorpening/images repo, get raw GitHub URLs
  2. In Substack editor: delete blockquote text, insert PNG
  3. Alt text = verbatim blockquote text
"""

import re
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Design constants ──────────────────────────────────────────────────────────

CARD_WIDTH    = 900
PADDING_H     = 60   # horizontal padding
PADDING_TOP   = 44
PADDING_BOT   = 44
LINE_SPACING  = 10   # extra px between lines beyond font size

BG_COLOR      = (0,  51, 102)          # #003366 navy
TEXT_COLOR    = (255, 255, 255)        # white
TEAL_COLOR    = (148, 210, 189)        # #94d2bd light teal — quote mark
WM_COLOR      = (255, 255, 255, 100)   # white at ~39% opacity

FONT_SIZE     = 30
WM_FONT_SIZE  = 12
QUOTE_SIZE    = 96   # decorative opening " size

ACCENT_W      = 18   # left accent bar width
ACCENT_COLOR  = (148, 210, 189)        # #94d2bd light teal

FONT_PATH     = '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf'
FONT_PATH_REG = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_font(path, size):
    return ImageFont.truetype(path, size) if os.path.exists(path) else ImageFont.load_default()

def wrap_text(draw, text, font, max_width):
    words = text.split()
    lines, current = [], []
    for word in words:
        test = ' '.join(current + [word])
        w = draw.textbbox((0, 0), test, font=font)[2]
        if w <= max_width:
            current.append(word)
        else:
            if current:
                lines.append(' '.join(current))
            current = [word]
    if current:
        lines.append(' '.join(current))
    return lines

# ── Extraction ────────────────────────────────────────────────────────────────

def strip_markdown(text):
    # Strip italic/bold markers (* and _)
    text = re.sub(r'\*+([^*]+)\*+', r'\1', text)
    text = re.sub(r'_+([^_]+)_+', r'\1', text)
    return text.strip()

def extract_blockquotes(md_text):
    blockquotes, current = [], []
    for line in md_text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith('> '):
            current.append(stripped[2:])
        elif stripped == '>':
            current.append('')
        else:
            if current:
                blockquotes.append(strip_markdown(' '.join(l for l in current if l).strip()))
                current = []
    if current:
        blockquotes.append(strip_markdown(' '.join(l for l in current if l).strip()))
    return [bq for bq in blockquotes if bq]

# ── Renderer ──────────────────────────────────────────────────────────────────

def render_blockquote(text, output_path):
    font    = load_font(FONT_PATH, FONT_SIZE)
    wm_font = load_font(FONT_PATH_REG, WM_FONT_SIZE)
    q_font  = load_font(FONT_PATH, QUOTE_SIZE)

    # Measure text area
    text_width = CARD_WIDTH - PADDING_H * 2
    probe = Image.new('RGB', (CARD_WIDTH, 100), BG_COLOR)
    probe_draw = ImageDraw.Draw(probe)
    lines = wrap_text(probe_draw, text, font, text_width)
    line_h = FONT_SIZE + LINE_SPACING

    # Quote mark height offset — let it overlap top padding
    q_h = probe_draw.textbbox((0, 0), '“', font=q_font)[3]
    q_overlap = q_h - PADDING_TOP  # how much it pushes into text area

    text_block_h = len(lines) * line_h
    card_h = PADDING_TOP + max(q_overlap, 0) + text_block_h + PADDING_BOT

    canvas_w = CARD_WIDTH
    canvas_h = card_h
    cx, cy = 0, 0

    canvas = Image.new('RGBA', (canvas_w, canvas_h), (255, 255, 255, 0))
    cd = ImageDraw.Draw(canvas)

    # Card background
    cd.rectangle([0, 0, CARD_WIDTH, card_h], fill=BG_COLOR + (255,))

    # Left accent bar
    cd.rectangle([0, 0, ACCENT_W, card_h], fill=ACCENT_COLOR + (255,))

    # Decorative opening quote mark (inset past accent bar)
    cd.text((PADDING_H - 10, PADDING_TOP - 28), '”', font=q_font, fill=TEAL_COLOR + (255,))

    # Body text
    text_y = PADDING_TOP + max(q_overlap, 0)
    for line in lines:
        cd.text((PADDING_H, text_y), line, font=font, fill=TEXT_COLOR + (255,))
        text_y += line_h

    # Watermark
    wm = 'owencorpening.substack.com'
    wm_w = cd.textbbox((0, 0), wm, font=wm_font)[2]
    cd.text(
        (CARD_WIDTH - wm_w - 14, card_h - WM_FONT_SIZE - 12),
        wm, font=wm_font, fill=WM_COLOR
    )

    # Save as RGBA — transparent background so shadow composites against actual page color
    canvas.save(output_path, 'PNG')

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print('Usage: python tools/blockquoteRenderer.py <post.md>')
        sys.exit(1)

    md_path = Path(sys.argv[1])
    if not md_path.exists():
        print(f'File not found: {md_path}')
        sys.exit(1)

    text       = md_path.read_text(encoding='utf-8')
    blockquotes = extract_blockquotes(text)

    if not blockquotes:
        print('No blockquotes found.')
        sys.exit(0)

    # Output to images repo: ~/dev/images/[series]/[slug]/blockquotes/
    # Derive slug from md filename without extension
    slug = md_path.stem
    images_base = Path.home() / 'dev' / 'images'
    # Try to find a matching series folder in images repo
    out_dir = images_base / 'standalone' / slug / 'blockquotes'
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f'Found {len(blockquotes)} blockquote(s) in {md_path.name}')
    print(f'Output → {out_dir}')
    for i, bq in enumerate(blockquotes, 1):
        out_path = out_dir / f'blockquote-{i:02d}.png'
        render_blockquote(bq, str(out_path))
        print(f'  [{i}] → {out_path}')
        print(f'       "{bq[:60]}{"..." if len(bq) > 60 else ""}"')

    print(f'\nDone. git add/commit/push {out_dir} in owencorpening/images, then insert raw URLs in Substack.')
    print('Alt text = verbatim blockquote text.')

if __name__ == '__main__':
    main()
