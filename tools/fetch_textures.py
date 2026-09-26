"""
Download CC0 textures from Poly Haven (https://polyhaven.com, all assets CC0) and prepare them for the game.

Terrain layers become 512x512 RGBA images (RGB = colour, A = blend height), stored as WebP in the order of the terrain ids in
src/sim/map.ts, plus a rock layer used on steep slopes. Building layers become 256x256 grayscale detail maps
(mean ~0.5) that are multiplied with the procedural vertex colours, so player colours and palettes still work.

Usage: python tools/fetch_textures.py
"""
import io
import json
import os
import urllib.request

from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_T = os.path.join(ROOT, 'public', 'textures', 'terrain')
OUT_B = os.path.join(ROOT, 'public', 'textures', 'detail')
CACHE = os.path.join(ROOT, 'tools', '.texcache')
UA = {'User-Agent': 'realms-ascendant-texture-fetch/1.0'}

# (layer file, poly haven id, saturation, brightness, warmth, contrast)
TERRAIN = [
    ('0_grass', 'leafy_grass', 1.35, 1.05, 0.0, 1.05),
    ('1_steppe', 'aerial_grass_rock', 1.15, 1.08, 0.02, 1.0),
    ('2_dirt', 'brown_mud_dry', 1.1, 1.05, 0.02, 1.0),
    ('3_sand', 'sand_01', 1.05, 1.18, 0.04, 0.95),
    ('4_forest', 'forest_leaves_02', 1.1, 0.8, 0.0, 1.05),
    ('5_shallows', 'river_small_rocks', 1.0, 1.05, 0.02, 1.0),
    ('6_waterbed', 'pebble_ground_01', 0.9, 0.85, 0.0, 1.0),
    ('7_deepbed', 'brown_mud', 0.8, 0.7, 0.0, 1.0),
    ('8_snow', 'snow_02', 0.9, 1.08, -0.02, 1.0),
    ('9_road', 'stone_pathway', 1.0, 1.05, 0.02, 1.0),
    ('10_rock', 'aerial_rocks_02', 1.0, 0.95, 0.0, 1.05),
]
# (layer file, poly haven id, rotate degrees)
DETAIL = [
    ('1_stone', 'rustic_stone_wall', 0),
    ('2_planks', 'weathered_planks', 0),
    ('3_thatch', 'thatch_roof_angled', 0),
    ('4_tiles', 'roof_tiles', 0),
    ('5_plaster', 'white_plaster_rough_01', 0),
    ('6_brick', 'brick_wall_02', 0),
    ('7_logs', 'wood_trunk_wall', 90),
]


def fetch_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read())


def fetch_bytes(url, cache_name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path):
        return open(path, 'rb').read()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        data = r.read()
    open(path, 'wb').write(data)
    return data


def map_url(files, kind, res='1k'):
    for key in ([kind] if isinstance(kind, str) else kind):
        if key in files and res in files[key]:
            entry = files[key][res]
            for fmt in ('jpg', 'png'):
                if fmt in entry:
                    return entry[fmt]['url']
    return None


def warm(img, amount):
    if abs(amount) < 1e-6:
        return img
    r, g, b = img.split()
    r = r.point(lambda v: min(255, int(v * (1 + amount))))
    b = b.point(lambda v: min(255, int(v * (1 - amount))))
    return Image.merge('RGB', (r, g, b))


def main():
    os.makedirs(OUT_T, exist_ok=True)
    os.makedirs(OUT_B, exist_ok=True)
    for name, aid, sat, bri, wr, con in TERRAIN:
        files = fetch_json(f'https://api.polyhaven.com/files/{aid}')
        diff = map_url(files, ['Diffuse', 'diffuse'])
        disp = map_url(files, ['Displacement', 'displacement', 'disp'])
        img = Image.open(io.BytesIO(fetch_bytes(diff, f'{aid}_diff.jpg'))).convert('RGB').resize((512, 512), Image.LANCZOS)
        img = ImageEnhance.Color(img).enhance(sat)
        img = ImageEnhance.Brightness(img).enhance(bri)
        img = ImageEnhance.Contrast(img).enhance(con)
        img = warm(img, wr)
        if disp:
            h = Image.open(io.BytesIO(fetch_bytes(disp, f'{aid}_disp.png'))).convert('L').resize((512, 512), Image.LANCZOS)
        else:
            h = img.convert('L')
        h = ImageOps.autocontrast(h, cutoff=2)
        # keep alpha in 128..255: browsers premultiply alpha when decoding, which would band low-alpha colours
        h = h.point(lambda v: 128 + v // 2)
        rgba = img.copy()
        rgba.putalpha(h)
        out = os.path.join(OUT_T, f'{name}.webp')
        rgba.save(out, 'WEBP', quality=86, method=6)
        print('terrain', name, aid, os.path.getsize(out) // 1024, 'KB')
    for name, aid, rot in DETAIL:
        files = fetch_json(f'https://api.polyhaven.com/files/{aid}')
        diff = map_url(files, ['Diffuse', 'diffuse'])
        img = Image.open(io.BytesIO(fetch_bytes(diff, f'{aid}_diff.jpg'))).convert('L').resize((256, 256), Image.LANCZOS)
        if rot:
            img = img.rotate(rot)
        # remove large-scale shading so only surface detail remains, then normalise to mean 0.5
        blur = img.filter(ImageFilter.GaussianBlur(24))
        px = img.load()
        bl = blur.load()
        detail = Image.new('L', img.size)
        dp = detail.load()
        for y in range(img.size[1]):
            for x in range(img.size[0]):
                v = px[x, y] - bl[x, y] + 128
                dp[x, y] = max(0, min(255, int(v)))
        detail = ImageOps.autocontrast(detail, cutoff=1)
        mean = ImageStat.Stat(detail).mean[0]
        detail = detail.point(lambda v: max(0, min(255, int((v - mean) * 0.75 + 128))))
        out = os.path.join(OUT_B, f'{name}.webp')
        detail.save(out, 'WEBP', quality=90, method=6)
        print('detail', name, aid, os.path.getsize(out) // 1024, 'KB')
    with open(os.path.join(ROOT, 'public', 'textures', 'CREDITS.md'), 'w', encoding='utf8') as f:
        f.write('# Texture credits\n\nAll textures in this folder are from [Poly Haven](https://polyhaven.com) and are released under CC0 (public domain).\n\n')
        for name, aid, *_ in TERRAIN + DETAIL:
            f.write(f'- `{name}` — [{aid}](https://polyhaven.com/a/{aid})\n')
    print('done')


if __name__ == '__main__':
    main()
