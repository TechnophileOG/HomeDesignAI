#!/usr/bin/env python3
"""Render the fixed catalog poses (backend/ai/poses.json) into OpenPose-style
condition images for ControlNet (black background, colored skeleton — the exact
format the OpenPose ControlNet was trained on).

Pure standard library (zlib + struct) — no dependencies. Run once; the PNGs
are committed to backend/ai/poses/ so the GPU worker never needs to render.

Usage:  python3 render_poses.py
"""
import json
import os
import struct
import zlib

W, H = 512, 768  # portrait SD1.5 canvas

# COCO-17 skeleton pairs
SKELETON = [
    (0, 1), (0, 2), (1, 3), (2, 4),          # head/face
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10), # arms
    (5, 11), (6, 12), (11, 12),              # torso
    (11, 13), (13, 15), (12, 14), (14, 16),  # legs
]

COLORS = {
    'head':  (0, 255, 255),   # cyan
    'arm':   (0, 255, 0),     # green
    'torso': (255, 0, 0),     # red
    'leg':   (255, 0, 255),   # magenta
}

def limb_color(a, b):
    if a <= 4 or b <= 4:
        return COLORS['head']
    if a in (5, 6, 7, 8, 9, 10) or b in (5, 6, 7, 8, 9, 10):
        return COLORS['arm']
    if a in (11, 12) or b in (11, 12):
        return COLORS['torso']
    return COLORS['leg']

def draw_dot(buf, x, y, color, r=6):
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                xx, yy = x + dx, y + dy
                if 0 <= xx < W and 0 <= yy < H:
                    buf[yy * W + xx] = color

def draw_line(buf, x0, y0, x1, y1, color, r=4):
    steps = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(steps + 1):
        t = i / steps
        cx, cy = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    xx, yy = cx + dx, cy + dy
                    if 0 <= xx < W and 0 <= yy < H:
                        buf[yy * W + xx] = color

def png_encode(flat_rgb):
    # Build real scanlines: filter byte + W pixels per row (NOT per pixel!).
    raw = b''.join(
        b'\x00' + bytes(ch for px in flat_rgb[y * W:(y + 1) * W] for ch in px)
        for y in range(H)
    )

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'poses.json'), 'r', encoding='utf-8') as f:
        poses = json.load(f)
    outdir = os.path.join(here, 'poses')
    os.makedirs(outdir, exist_ok=True)
    for i, pose in enumerate(poses):
        buf = [(0, 0, 0)] * (W * H)
        pts = [None] * 17
        for idx, (x, y, v) in enumerate(pose['keypoints']):
            if v and x > 0 and y > 0:
                pts[idx] = (int(x), int(y))
        for a, b in SKELETON:
            if pts[a] and pts[b]:
                draw_line(buf, pts[a][0], pts[a][1], pts[b][0], pts[b][1], limb_color(a, b))
        for p in pts:
            if p:
                draw_dot(buf, p[0], p[1], (255, 255, 255))
        path = os.path.join(outdir, 'pose_{}.png'.format(i))
        with open(path, 'wb') as f:
            f.write(png_encode(buf))
        print('wrote', path, '({} keypoints visible)'.format(sum(1 for p in pts if p)))

if __name__ == '__main__':
    main()
