"""
stationkit.py(駅のタイル素材の生成スクリプト)から、ゲーム用のアトラスを作る。

出力(第1引数: 画像の出力先、第2引数: JSON の出力先):
  station0.png .. station3.png … 見た目の変種(0=標準 1=別色 2=ダーク 3=雪)ごとに1枚。
     列 = ピース番号*2 + 層(0=地面 1=上の物: 屋根・駅舎・跨線橋など)、行 = 基本の様式(0..19)*2 + 軸(0=x 1=y)。1セル 64x64。
  stationKit.json … 様式名・ピース名・セルの寸法・地面のひし形の位置
地面と上の物を別の層にするのは、列車を「地面の上・屋根の下」に描くため。
"""
import json, os, sys
import stationkit as k
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
JSON = sys.argv[2] if len(sys.argv) > 2 else './stationKit.json'

NAMES = {
    'rural_wood': '田舎の木造駅', 'brick_classic': '煉瓦のクラシック駅', 'concrete_modern': 'コンクリートの近代駅', 'glass_modern': 'ガラス張りの現代駅',
    'japan': '和風の駅', 'euro_iron': '欧風の鉄骨駅', 'industrial': '工業地帯の駅', 'metro': '都会の地下鉄風駅', 'alpine': '山岳リゾートの駅', 'desert': '砂漠の駅',
    'stone_gothic': '石造りのゴシック駅', 'art_deco': 'アールデコの駅', 'soviet': '無骨な社会主義風駅', 'steampunk': 'スチームパンクの駅', 'tropical': '南国の駅',
    'nordic_red': '北欧の赤い駅', 'tudor': 'チューダー様式の駅', 'mediterranean': '地中海風の駅', 'futuristic': '未来都市の駅', 'mining': '鉱山町の駅',
}
VARIANTS = ['', '(別色)', '(ダーク)', '(雪景色)']
LOW = 6  # LOW = 6  # low things at or below this height (platform edges, buffer stops) go into the ground layer


def split_prims(name, side, st):
    low, tall = [], []
    for p in k.prims(name, side, st):
        is_low = p[0] == 'sb' and p[5] <= LOW and p[6] == 0  # ('sb', s, t, L, R, h, lift, col)
        (low if is_low else tall).append(p)
    return low, tall


def render_layer(name, side, st, ax, layer):
    low, tall = split_prims(name, side, st)
    prims = low if layer == 0 else tall
    stacks = [k.mkstack(p, ax) for p in prims]
    if layer == 0:
        return k.render3(stacks, [], lambda s, t, dx, dy: k.gnd(name, side, st, ax)(s, t, dx, dy), (226, 222, 210), 'plaster', k.GEO, 'none', 1)
    old = k.ground
    k.ground = lambda *a, **kw: None  #     k.ground = lambda *a, **kw: None  # do not draw the ground (only the things above)
    try:
        return k.render3(stacks, [], lambda s, t, dx, dy: (0, 0, 0), (226, 222, 210), 'plaster', k.GEO, 'none', 1)
    finally:
        k.ground = old


def main():
    os.makedirs(OUT, exist_ok=True)
    npieces = len(k.PIECES)
    for v in range(4):
        sheet = Image.new('RGBA', (npieces * 2 * 64, 20 * 2 * 64), (0, 0, 0, 0))
        for b in range(20):
            sn, st = k.STY[b * 4 + v]
            for ax in (0, 1):
                for pi, (piece, side) in enumerate(k.PIECES):
                    for layer in (0, 1):
                        sheet.paste(render_layer(piece, side, st, ax, layer), ((pi * 2 + layer) * 64, (b * 2 + ax) * 64))
        sheet = k.grade(sheet)
        q = sheet.quantize(colors=48, method=Image.FASTOCTREE, dither=Image.NONE)
        tr = q.getpixel((0, 0))
        q.save(os.path.join(OUT, f'station{v}.png'), transparency=tr, optimize=True)
        print('station', v, os.path.getsize(os.path.join(OUT, f'station{v}.png')) // 1024, 'KB')
    info = {
        'tile': 64,
        'groundTop': 28,  #         'groundTop': 28,  # y of the top vertex of the ground diamond within the cell
        'pieces': [k.pname(b, s) for b, s in k.PIECES],
        'styles': [{'name': NAMES[k.STY[b * 4][0]] + VARIANTS[v], 'key': k.STY[b * 4 + v][0]} for b in range(20) for v in range(4)],
    }
    json.dump(info, open(JSON, 'w'), ensure_ascii=False, indent=1)


main()
