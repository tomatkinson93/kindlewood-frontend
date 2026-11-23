#!/usr/bin/env python3
"""
pack_foes — a foe's export from PixelLab becomes the sheet the battle draws.

    python3 scripts/pack_foes.py          every foe in art/tactics/foes/
    node scripts/pack_tactics.js          afterwards, so the game lists them

Put a PixelLab export in art/tactics/foes/<key>/ (the key is the foe's, as in
docs/TACTICS_ASSETS.md §1: rat_cutpurse, fox_footpad …), keeping its
`rotations` folder (south-east.png and the other seven). A `walking` folder
may sit beside it; it is kept for later and not used yet (see below).

For each foe this writes, in assets/sprites/creatures/:
  <key>.png        one row of four frames: facing south-east, south-west,
                   north-east, north-west. On the board a unit always faces
                   one of those four, so nothing is mirrored.
  <key>_face.png   a head and shoulders, 64 × 64, for the row of who acts next.
and assets/sprites/creatures/foes.json, which says for each foe how big a
frame is, where its feet are, and how large to draw it: its height on the
board is set in art/tactics/foes/sizes.json, in mouse-heights.

Walking: PixelLab's walk is north, east, south and west, and the board needs
the four diagonals, so for now a foe hops along standing. Export "walking"
for south-east, south-west, north-east and north-west and it can be wired.

Needs Pillow.
"""
import json
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'art', 'tactics', 'foes')
OUT = os.path.join(ROOT, 'assets', 'sprites', 'creatures')
DIRS = [('se', 'south-east'), ('sw', 'south-west'), ('ne', 'north-east'), ('nw', 'north-west')]
MOUSE_PX = 59        # how tall the mouse villager stands in its own sheet (assets/sprites/villagers/mouse_idle.png)
PAD = 2


def find(folder, name):
    """rotations/<name>.png, wherever the export put its rotations folder."""
    for base, _dirs, files in os.walk(folder):
        if os.path.basename(base) == 'rotations' and name + '.png' in files:
            return os.path.join(base, name + '.png')
    return None


def pack(key, sizes):
    folder = os.path.join(SRC, key)
    frames = []
    for _short, long in DIRS:
        path = find(folder, long)
        if not path:
            return None
        frames.append(Image.open(path).convert('RGBA'))
    # One box that holds all four, so the foe does not jump when it turns.
    boxes = [f.getbbox() for f in frames]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    fw, fh = x1 - x0 + 2 * PAD, y1 - y0 + 2 * PAD
    sheet = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
    feet = []
    for i, f in enumerate(frames):
        sheet.alpha_composite(f.crop((x0, y0, x1, y1)), (i * fw + PAD, PAD))
        # Where it stands: the middle of the lowest rows of ink (its feet, not the tip of a tail or a blade).
        b = boxes[i]
        low = f.crop((b[0], b[3] - 6, b[2], b[3])).getbbox()
        feet.append((b[0] + (low[0] + low[2]) / 2 - x0 + PAD, b[3] - y0 + PAD))
    sheet.save(os.path.join(OUT, key + '.png'), optimize=True)
    tall = sum(b[3] - b[1] for b in boxes) / len(boxes)
    # A face: from the view that looks straight out, the top of the figure, square.
    south = find(folder, 'south') or find(folder, 'south-west')
    s = Image.open(south).convert('RGBA')
    sb = s.getbbox()
    side = int(round((sb[3] - sb[1]) * 0.56))
    cx = (sb[0] + sb[2]) // 2
    face = s.crop((cx - side // 2, sb[1] - 1, cx - side // 2 + side, sb[1] - 1 + side)).resize((64, 64), Image.NEAREST)
    face.save(os.path.join(OUT, key + '_face.png'), optimize=True)
    rel = float(sizes.get(key, 1))
    return {
        'file': key + '.png', 'face': key + '_face.png', 'dirs': [d[0] for d in DIRS], 'w': fw, 'h': fh,
        'foot': {'x': round(sum(p[0] for p in feet) / len(feet), 1), 'y': feet[0][1]},
        'tall': round(tall, 1), 'stands': rel, 'scale': round(MOUSE_PX * rel / tall, 4),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    sizes = {}
    try:
        sizes = json.load(open(os.path.join(SRC, 'sizes.json')))
    except OSError:
        pass
    out = {}
    for key in sorted(os.listdir(SRC)) if os.path.isdir(SRC) else []:
        if not os.path.isdir(os.path.join(SRC, key)):
            continue
        meta = pack(key, sizes)
        if meta:
            out[key] = meta
            print(f"{key}: {meta['w']}x{meta['h']} a frame, {meta['tall']:.0f} px tall, drawn at {meta['scale']:.2f} ({meta['stands']} of a mouse)")
        else:
            print(f'{key}: no rotations folder with the four diagonal views; skipped')
    with open(os.path.join(OUT, 'foes.json'), 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print(f'{len(out)} foes packed')


if __name__ == '__main__':
    main()
