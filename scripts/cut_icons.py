#!/usr/bin/env python3
"""
cut_icons — cut a sheet of icons on a white background into one PNG each.

    python3 scripts/cut_icons.py <sheet> <out folder> <name> <name> …

A sheet is a row of icons with clear gaps, as an image generator makes them
(docs/TACTICS_ASSETS.md §4). The names are the icons from left to right:
ability keys for assets/tactics/icons (g_strike, w_bolt, look_slash …), status
names for assets/tactics/status (weak, vulnerable …).

What it does to each icon:
  - finds it (the icons are the islands of ink between columns of white);
  - takes the white away from around it, and only from around it: white that
    the icon's own outline encloses (a snowflake, an arrowhead) stays;
  - cleans the pale fringe where the outline met the white;
  - sets it square, with a little room round it, at 64 pixels (--size).

Afterwards run `node scripts/pack_tactics.js` so the game lists them.
Needs Pillow and numpy.
"""
import sys
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

WHITE = 232          # a pixel this bright in every channel counts as the sheet's background
PAD = 0.06           # room left round the icon, as a share of its longer side


def islands(ink, gap):
    """Runs of columns that hold ink, split wherever at least `gap` columns in a row are empty."""
    cols = ink.any(axis=0)
    runs, start, empty = [], None, 0
    for x, on in enumerate(cols):
        if on:
            if start is None:
                start = x
            empty = 0
        elif start is not None:
            empty += 1
            if empty >= gap:
                runs.append((start, x - empty + 1))
                start, empty = None, 0
    if start is not None:
        runs.append((start, len(cols)))
    return runs


def outside(white):
    """The white that is joined to the sheet's edge: the background, and not white inside an icon."""
    h, w = white.shape
    out = np.zeros_like(white)
    todo = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x] and not out[y, x]:
                out[y, x] = True
                todo.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x] and not out[y, x]:
                out[y, x] = True
                todo.append((y, x))
    while todo:
        y, x = todo.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                todo.append((ny, nx))
    return out


def cut(sheet, out_dir, names, size=64):
    im = Image.open(sheet).convert('RGBA')
    px = np.asarray(im).astype(np.float32)
    rgb, a0 = px[..., :3], px[..., 3]
    white = ((rgb.min(axis=2) >= WHITE) | (a0 < 8))
    bg = outside(white)
    ink = ~bg
    runs = islands(ink, gap=max(6, im.width // 120))
    # Specks of ink (a stray pixel of compression noise) are not icons.
    runs = [r for r in runs if r[1] - r[0] >= im.width // 60]
    if len(runs) != len(names):
        # Too many islands: an icon with a part standing apart (motion lines). Join the nearest until the count fits.
        while len(runs) > len(names):
            gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
            i = gaps.index(min(gaps))
            runs[i:i + 2] = [(runs[i][0], runs[i + 1][1])]
        if len(runs) != len(names):
            raise SystemExit(f'{sheet}: found {len(runs)} icons, but {len(names)} names were given.')
    # The fringe: within two pixels of the background the outline was blended with white. Take the white back out.
    near = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0
    fringe = near & ink
    whiteness = (rgb.min(axis=2) - 40.0) / (255.0 - 40.0)                 # 0 at the outline's dark brown, 1 at white
    alpha = np.where(bg, 0.0, 1.0)
    alpha = np.where(fringe, np.clip(1.0 - whiteness, 0.0, 1.0), alpha)
    safe = np.maximum(alpha, 0.05)[..., None]
    colour = np.where(fringe[..., None], np.clip((rgb - (1.0 - safe) * 255.0) / safe, 0, 255), rgb)
    out = np.dstack([colour, alpha * 255.0]).astype(np.uint8)
    made = []
    for (x0, x1), name in zip(runs, names):
        rows = ink[:, x0:x1].any(axis=1)
        ys = np.where(rows)[0]
        y0, y1 = int(ys[0]), int(ys[-1]) + 1
        icon = Image.fromarray(out[y0:y1, x0:x1], 'RGBA')
        side = int(round(max(icon.size) * (1 + 2 * PAD)))
        square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        square.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
        square = square.resize((size, size), Image.LANCZOS)
        path = f'{out_dir.rstrip("/")}/{name}.png'
        square.save(path, optimize=True)
        made.append(path)
    return made


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--size=')]
    size = next((int(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--size=')), 64)
    if len(args) < 3:
        raise SystemExit(__doc__)
    import os
    os.makedirs(args[1], exist_ok=True)
    for p in cut(args[0], args[1], args[2:], size):
        print(p)
