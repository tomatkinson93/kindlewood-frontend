#!/usr/bin/env python3
"""pack_buildings — source drawings into the scene's WebP files (docs/ART_GUIDE.md §5).

    python3 scripts/pack_buildings.py SRC_DIR [name ...]

Reads SRC_DIR/<name>.png (and <name>_lit.png) as the image generator returned
them and writes assets/images/scene_v2/buildings/<name>.webp (lossless, at 2×
the on-screen size). It needs Pillow and numpy.

What it does to each image:
  1. Cuts the background off. The generator returns four kinds: real
     transparency (kept), a white fill, a black fill, and a baked-in grey and
     white checkerboard. For the last three it floods in from the edges over
     background-coloured pixels, so white flowers and dark outlines inside the
     drawing survive, then pulls the edge in by two pixels. Background seen
     through a hole in a night image (a belfry, a sign's bracket) is cleared
     wherever the day image is clear.
  2. Crops tight to what is drawn.
  3. Sizes it. A night image is made the same size as its day image (both are
     cropped tight first, so they line up). A new drawing takes its on-screen
     width from SIZES below; an existing one keeps the size it has.
  4. Reports how well each day and night pair lines up, and prints the
     manifest's w and h (half the file's size).

The door point is not found here: set it in manifest.v2.json by eye (the
bottom middle of the door, in on-screen pixels).
"""
import os
import sys
from collections import OrderedDict

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.environ.get('KW_PACK_OUT') or os.path.join(ROOT, 'assets', 'images', 'scene_v2', 'buildings')   # KW_PACK_OUT: a scratch folder, to try a batch

# On-screen width (px) for drawings that have no file yet. A town building's
# door is about 70 px tall on screen, a house's 58 (docs/ART_GUIDE.md §2).
SIZES = {
    'jeweller': 286,
    'neighbourhood': 440,
    'village_green': 320,
}


def cut_background(im):
    """RGBA with the background transparent."""
    im = im.convert('RGBA')
    a = np.array(im)
    alpha = a[..., 3]
    if (alpha < 250).mean() > 0.02:            # real transparency: keep it, drop the faint haze
        a[..., 3] = np.where(alpha < 24, 0, alpha)
        return Image.fromarray(a)
    rgb = a[..., :3].astype(np.int16)
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    dark = edge.max(axis=1).mean() < 40
    # Background-like: near black, or near white / light grey with no colour
    # (a white fill and both tones of the checkerboard).
    like = (hi <= 28) if dark else ((hi - lo <= 16) & (lo >= 185))
    bg = np.zeros(like.shape, bool)
    bg[0], bg[-1], bg[:, 0], bg[:, -1] = like[0], like[-1], like[:, 0], like[:, -1]
    while True:                                 # flood in from the edges
        grown = bg.copy()
        grown[1:] |= bg[:-1]; grown[:-1] |= bg[1:]; grown[:, 1:] |= bg[:, :-1]; grown[:, :-1] |= bg[:, 1:]
        grown &= like
        if (grown == bg).all():
            break
        bg = grown
    a[..., 3] = np.where(bg, 0, 255)
    out = Image.fromarray(a)
    # Pull the edge in (the outline's blend into the background) and soften it.
    al = out.getchannel('A').filter(ImageFilter.MinFilter(5))
    soft = al.filter(ImageFilter.GaussianBlur(0.8))
    al = Image.fromarray(np.minimum(np.array(al), np.array(soft)))
    out.putalpha(al)
    return out


def crop_tight(im):
    """Cropped to what is drawn, ignoring stray specks at the edges."""
    solid = np.array(im.getchannel('A')) > 40
    rows, cols = solid.sum(axis=1), solid.sum(axis=0)
    ys, xs = np.where(rows >= 4)[0], np.where(cols >= 4)[0]
    box = (int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1)
    out = im.crop(box)
    a = np.array(out)
    a[a[..., 3] == 0] = 0                       # no colour under full transparency (smaller files)
    return Image.fromarray(a)


def match_holes(day, lit):
    """Background the flood could not reach from the edges (seen through a
    belfry, behind a sign's bracket): transparent in the night image wherever
    the day image is, if it still looks like background there."""
    d, l = np.array(day.convert('RGBA')), np.array(lit)
    rgb = l[..., :3].astype(np.int16)
    like = (rgb.max(axis=2) - rgb.min(axis=2) <= 22) & (rgb.min(axis=2) >= 175)
    hole = (d[..., 3] < 40) & like & (l[..., 3] > 0)
    # …and the pale rim the hole leaves on what stands in it (two pixels).
    near = np.array(Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    rim = near & (rgb.max(axis=2) - rgb.min(axis=2) <= 34) & (rgb.min(axis=2) >= 150) & (d[..., 3] < 200)
    l[hole | rim] = 0
    return Image.fromarray(l), int(hole.sum())


def save(im, name):
    path = os.path.join(OUT, name + '.webp')
    im.save(path, 'WEBP', lossless=True, method=6)
    return path


def line_up(day, lit):
    """How well a pair lines up: the share of the outline that differs."""
    d, l = np.array(day.convert('RGBA')).astype(np.int16), np.array(lit.convert('RGBA')).astype(np.int16)
    edge = np.abs(d[..., 3] - l[..., 3]) > 128
    changed = (np.abs(d[..., :3] - l[..., :3]).sum(axis=2) > 120) & (d[..., 3] > 128) & (l[..., 3] > 128)
    return edge.mean() * 100, changed.mean() * 100


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    src = argv[1]
    names = OrderedDict()
    for f in sorted(os.listdir(src)):
        if f.lower().endswith('.png'):
            base = f[:-4]
            key = base[:-4] if base.endswith('_lit') else base
            names.setdefault(key, {})['lit' if base.endswith('_lit') else 'day'] = os.path.join(src, f)
    only = argv[2:]
    for key, files in names.items():
        if only and key not in only:
            continue
        day_path = os.path.join(OUT, key + '.webp')
        day = None
        if 'day' in files:
            day = crop_tight(cut_background(Image.open(files['day'])))
            lit_path = os.path.join(OUT, key + '_lit.webp')
            if key in SIZES:
                w = SIZES[key] * 2
                size = (w, round(day.height * w / day.width))
            elif os.path.exists(day_path):
                size = Image.open(day_path).size
            elif os.path.exists(lit_path) and 'lit' not in files:
                size = Image.open(lit_path).size          # a day image for a night one that exists
            else:
                print(f'{key}: no size known. Add its on-screen width to SIZES.')
                continue
            day = day.resize(size, Image.LANCZOS)
            save(day, key)
            print(f'{key}.webp  {size[0]}×{size[1]}  manifest w {size[0] // 2}, h {size[1] // 2}')
            if 'lit' not in files and os.path.exists(lit_path):
                e, c = line_up(day, Image.open(lit_path))
                print(f'  against {key}_lit.webp: outline differs {e:.1f}%, colours changed {c:.1f}%')
        elif os.path.exists(day_path):
            day = Image.open(day_path).convert('RGBA')
        if 'lit' in files:
            if day is None:
                print(f'{key}_lit: no day image to size it by.')
                continue
            lit = crop_tight(cut_background(Image.open(files['lit']))).resize(day.size, Image.LANCZOS)
            lit, holes = match_holes(day, lit)
            save(lit, key + '_lit')
            e, c = line_up(day, lit)
            print(f'{key}_lit.webp  {day.size[0]}×{day.size[1]}  outline differs {e:.1f}%, colours changed {c:.1f}% (the lit windows)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
