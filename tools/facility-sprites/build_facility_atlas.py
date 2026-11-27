"""Packs the sprites of hotels, parks, and the new facilities of newfac.py (each *_out/sprites/<type>_NN_{S,M,L}.png) into one atlas per kind.
The cell size differs by S/M/L (S=1x1 tile, M=2x2, L=3x3), so a band per size is stacked vertically, with 5 columns in each band.
Usage: python3 build_facility_atlas.py <the folder holding hotel.py and park.py (*_out is here too)> <output folder (assets)> <output json>"""
import importlib.util, json, os, sys
from PIL import Image

def load(path):
    spec = importlib.util.spec_from_file_location('m_' + os.path.basename(path)[:-3], path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def sources(src, only):
    """Return (kind, list of names, dimensions per size). hotel/park come from their own .py files, new facilities from the table in newfac.py"""
    sys.path.insert(0, src)
    out = []
    if not only or any(t in ('hotel', 'park') for t in only):
        for name in ('hotel', 'park'):
            if only and name not in only: continue
            m = load(os.path.join(src, name + '.py'))
            out.append((name, list(m.NAMES), m.GEO))
    nf = load(os.path.join(src, 'newfac.py'))
    for name, t in nf.TYPES.items():
        if only and name not in only: continue
        out.append((name, list(t['names']), t.get('geo', nf.GEO)))
    return out

def main(src, outdir, outjson, *only):
    """If a kind name is passed as `only`, build just that kind and merge it into the existing json (all kinds if not passed)"""
    meta = json.load(open(outjson, encoding='utf-8')) if only and os.path.exists(outjson) else {}
    for name, names, geo in sources(src, only):
        n = len(names)
        bands = {}
        y = 0
        sheets = []
        for s in 'SML':
            g = geo[s]
            rows = (n + 4) // 5
            bands[s] = {'w': g['w'], 'h': g['h'], 'y0': y, 'cx': g['w'] // 2, 'cy': g['h'] - g['hw'] // 2 - g.get('pad', 6)}
            sheets.append((s, rows, g, y))
            y += rows * g['h']
        width = max(5 * geo[s]['w'] for s in 'SML')
        atlas = Image.new('RGBA', (width, y), (0, 0, 0, 0))
        for s, rows, g, y0 in sheets:
            for k in range(n):
                im = Image.open(os.path.join(src, f'{name}_out', 'sprites', f'{name}_{k + 1:02d}_{s}.png')).convert('RGBA')
                assert im.size == (g['w'], g['h']), (name, k, s, im.size)
                atlas.paste(im, ((k % 5) * g['w'], y0 + (k // 5) * g['h']))
        q = atlas.quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        os.makedirs(outdir, exist_ok=True)
        q.save(os.path.join(outdir, name + '.png'), optimize=True)
        meta[name] = {'count': n, 'names': names, 'sizes': bands}
        print(name, n, atlas.size, os.path.getsize(os.path.join(outdir, name + '.png')) // 1024, 'KB')
    json.dump(meta, open(outjson, 'w', encoding='utf-8'), ensure_ascii=False)

if __name__ == '__main__':
    main(*sys.argv[1:])
