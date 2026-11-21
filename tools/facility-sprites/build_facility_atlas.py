"""ホテル・公園、および newfac.py の新しい施設のスプライト(各 *_out/sprites/<type>_NN_{S,M,L}.png)を、種類ごとに1枚のアトラスにまとめる。
S/M/L でセルの大きさが違う(S=1x1タイル M=2x2 L=3x3)ので、サイズごとの帯を縦に積み、各帯は5列。
使い方: python3 build_facility_atlas.py <hotel.py と park.py のあるフォルダ(*_out もここ)> <出力フォルダ(assets)> <出力json>"""
import importlib.util, json, os, sys
from PIL import Image

def load(path):
    spec = importlib.util.spec_from_file_location('m_' + os.path.basename(path)[:-3], path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def sources(src, only):
    """(種類, 名前の一覧, サイズごとの寸法) を返す。hotel/park は各 .py から、新しい施設は newfac.py の表から"""
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
        out.append((name, list(t['names']), nf.GEO))
    return out

def main(src, outdir, outjson, *only):
    """only に種類名を渡すと、その種類だけ作って、既存の json に統合する(渡さなければ全種類)"""
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
