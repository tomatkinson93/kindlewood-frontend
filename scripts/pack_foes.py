#!/usr/bin/env python3
"""
pack_foes — a foe's export from PixelLab becomes the sheet the battle draws.

    python3 scripts/pack_foes.py          every foe in art/tactics/foes/
    node scripts/pack_tactics.js          afterwards, so the game lists them

Put a PixelLab export in art/tactics/foes/<key>/ (the key is the foe's, as in
docs/TACTICS_ASSETS.md §1: rat_cutpurse, fox_footpad …), keeping its
`rotations` folder (south-east.png and the other seven). Its animations go
beside it, a folder for each direction with the frames inside:
    walking/<direction>/frame_000.png …     a walk
    idle/<direction>/frame_000.png …        standing and breathing

For each foe this writes, in assets/sprites/creatures/:
  <key>.png        one row of four frames: facing south-east, south-west,
                   north-east, north-west. On the board a unit always faces
                   one of those four, so nothing is mirrored.
  <key>_face.png   a head and shoulders, 64 × 64, for the row of who acts next.
  <key>_walk.png   the walk, when there is one: a row of frames for each
                   direction it has (see below).
  <key>_idle.png   the same for standing and breathing, when there is one.
and assets/sprites/creatures/foes.json, which says for each foe how big a
frame is, where its feet are, and how large to draw it: its height on the
board is set in art/tactics/foes/sizes.json, in mouse-heights.

Which way an animation faces. On the board a unit moves and looks along one
of the four diagonals. If the animation was exported for those (south-east,
south-west, north-east, north-west) they are used as they are. If it only has
the side views, as PixelLab's first exports did (north, east, south, west),
the walk to the east stands in for both ways right and the walk to the west
for both ways left: better than gliding, and replaced the moment the
diagonals are exported. With no idle animation the game makes a foe breathe
by itself (js/tactics.js).

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


def lone(im):
    """The picture with only its largest piece: the tip of a blade or a tail that pokes into a face's square is taken out."""
    w, h = im.size
    a = im.getchannel('A').load()
    seen, pieces = set(), []
    for y in range(h):
        for x in range(w):
            if a[x, y] == 0 or (x, y) in seen:
                continue
            piece, todo = [], [(x, y)]
            seen.add((x, y))
            while todo:
                px, py = todo.pop()
                piece.append((px, py))
                for nx, ny in ((px + 1, py), (px - 1, py), (px, py + 1), (px, py - 1)):
                    if 0 <= nx < w and 0 <= ny < h and a[nx, ny] and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        todo.append((nx, ny))
            pieces.append(piece)
    if len(pieces) < 2:
        return im
    pieces.sort(key=len, reverse=True)
    out = im.copy()
    px = out.load()
    for piece in pieces[1:]:
        for x, y in piece:
            px[x, y] = (0, 0, 0, 0)
    return out


def frames_of(folder, anim, direction):
    d = os.path.join(folder, anim, direction)
    try:
        return [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.lower().endswith('.png')]
    except OSError:
        return []


def animation(key, folder, anim, out_name):
    """An animation as a sheet: a row of frames for each direction it was drawn in. → what the game needs to draw it, or None."""
    rows, sources = {}, []
    for short, long in DIRS:
        side = 'east' if short in ('se', 'ne') else 'west'
        src = next((c for c in (long, side) if frames_of(folder, anim, c)), None)
        if not src:
            return None
        if src not in sources:
            sources.append(src)
        rows[short] = sources.index(src)
    strips = []
    for src in sources:
        frames = [Image.open(f).convert('RGBA') for f in frames_of(folder, anim, src)]
        boxes = [f.getbbox() for f in frames]
        x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
        x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
        # Where it stands: the middle of the lowest rows of ink, taken over the whole cycle so a stride does not move it.
        mids = []
        for f, b in zip(frames, boxes):
            low = f.crop((b[0], b[3] - 6, b[2], b[3])).getbbox()
            mids.append(b[0] + (low[0] + low[2]) / 2)
        strips.append({'frames': frames, 'box': (x0, y0, x1, y1), 'foot_x': sum(mids) / len(mids) - x0})
    n = min(len(st['frames']) for st in strips)
    w = max(st['box'][2] - st['box'][0] for st in strips) + 2 * PAD
    h = max(st['box'][3] - st['box'][1] for st in strips) + 2 * PAD
    sheet = Image.new('RGBA', (w * n, h * len(strips)), (0, 0, 0, 0))
    feet = []
    for r, st in enumerate(strips):
        x0, y0, x1, y1 = st['box']
        top = h - PAD - (y1 - y0)                    # every row stands on the same line, at the bottom of its cell
        for i in range(n):
            sheet.alpha_composite(st['frames'][i].crop((x0, y0, x1, y1)), (i * w + PAD, r * h + top))
        feet.append({'x': round(st['foot_x'] + PAD, 1), 'y': h - PAD})
    sheet.save(os.path.join(OUT, out_name), optimize=True)
    return {'file': out_name, 'w': w, 'h': h, 'frames': n, 'rows': rows, 'foot': feet, 'diagonal': all(s in ('south-east', 'south-west', 'north-east', 'north-west') for s in sources)}


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
    face = lone(s.crop((cx - side // 2, sb[1] - 1, cx - side // 2 + side, sb[1] - 1 + side))).resize((64, 64), Image.NEAREST)
    face.save(os.path.join(OUT, key + '_face.png'), optimize=True)
    rel = float(sizes.get(key, 1))
    meta = {
        'file': key + '.png', 'face': key + '_face.png', 'dirs': [d[0] for d in DIRS], 'w': fw, 'h': fh,
        'foot': {'x': round(sum(p[0] for p in feet) / len(feet), 1), 'y': feet[0][1]},
        'tall': round(tall, 1), 'stands': rel, 'scale': round(MOUSE_PX * rel / tall, 4),
    }
    for anim, name in (('walking', 'walk'), ('idle', 'idle')):
        a = animation(key, folder, anim, f'{key}_{name}.png')
        if a:
            meta[name] = a
    return meta


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
            moves = ', '.join(f"{n} {meta[n]['frames']} frames{'' if meta[n]['diagonal'] else ' (side views)'}" for n in ('walk', 'idle') if n in meta) or 'no animation'
            print(f"{key}: {meta['w']}x{meta['h']} a frame, {meta['tall']:.0f} px tall, drawn at {meta['scale']:.2f} ({meta['stands']} of a mouse); {moves}")
        else:
            print(f'{key}: no rotations folder with the four diagonal views; skipped')
    with open(os.path.join(OUT, 'foes.json'), 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print(f'{len(out)} foes packed')


if __name__ == '__main__':
    main()
