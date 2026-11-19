"""観光地スプライト(各 *_out/sprites/<cat>_NNN_{S,M,L}.png, 128x192)を1枚のアトラスにまとめる。
使い方: python3 build_sights_atlas.py <*_out を含むフォルダ> <出力png> <出力json>
並びは他の施設と同じ: 種類 i は 行=⌊i/5⌋、列=(i%5)*3+(S=0,M=1,L=2)。"""
import csv, json, os, sys
from PIL import Image

CATS = [  # (フォルダ接頭辞, 分類名, 件数)
    ('shrine', '神社', 30), ('temple', '神殿・寺院', 20), ('tower', 'タワー', 20), ('onsen', '温泉', 20),
    ('outlet', 'アウトレット', 20), ('casino', 'カジノ', 20), ('objects', '名所', 50),
]
W, H = 128, 192

def main(src, out_png, out_json):
    n = sum(c[2] for c in CATS)
    rows = (n + 4) // 5
    atlas = Image.new('RGBA', (15 * W, rows * H), (0, 0, 0, 0))
    meta = []
    i = 0
    for pre, cname, cnt in CATS:
        names = {}
        with open(os.path.join(src, f'{pre}_out', f'{pre}_list.csv'), encoding='utf-8-sig') as f:
            for r in csv.DictReader(f):
                names[int(r['id'])] = (r['type'], r.get('variant_name') or '')
        for k in range(1, cnt + 1):
            for si, s in enumerate('SML'):
                im = Image.open(os.path.join(src, f'{pre}_out', 'sprites', f'{pre}_{k:03d}_{s}.png')).convert('RGBA')
                assert im.size == (W, H), (pre, k, s, im.size)
                atlas.paste(im, ((i % 5) * 3 * W + si * W, (i // 5) * H))
            t, v = names.get(k, (cname, ''))
            meta.append({'cat': cname, 'type': t, 'variant': v})
            i += 1
    q = atlas.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(out_png, optimize=True)
    json.dump(meta, open(out_json, 'w', encoding='utf-8'), ensure_ascii=False)
    print(len(meta), 'designs', atlas.size, os.path.getsize(out_png) // 1024, 'KB')

if __name__ == '__main__':
    main(*sys.argv[1:4])
