"""ホテル・公園のスプライト(各 *_out/sprites/<type>_NN_{S,M,L}.png)を、種類ごとに1枚のアトラスにまとめる。
S/M/L でセルの大きさが違う(S=1x1タイル M=2x2 L=3x3)ので、サイズごとの帯を縦に積み、各帯は5列。
使い方: python3 build_facility_atlas.py <hotel.py と park.py のあるフォルダ(*_out もここ)> <出力フォルダ(assets)> <出力json>"""
import importlib.util, json, os, sys
from PIL import Image

def load(path):
    spec = importlib.util.spec_from_file_location('m_' + os.path.basename(path)[:-3], path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def main(src, outdir, outjson):
    meta = {}
    for name in ('hotel', 'park'):
        m = load(os.path.join(src, name + '.py'))
        n = len(m.NAMES)
        geo = m.GEO
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
        meta[name] = {'count': n, 'names': list(m.NAMES), 'sizes': bands}
        print(name, n, atlas.size, os.path.getsize(os.path.join(outdir, name + '.png')) // 1024, 'KB')
    json.dump(meta, open(outjson, 'w', encoding='utf-8'), ensure_ascii=False)

if __name__ == '__main__':
    main(*sys.argv[1:4])
