"""新しい施設(映画館・動物園/水族館・スキー場・ビーチ・アリーナ・コンベンション・ビジネスホテル・大学・ゴルフ場・病院・駅ビル)のスプライト。
fackit.py(ホテル・公園と同じ描画部品)の上に、種類ごとのデザイン表を持つ。
使い方: python3 newfac.py <種類> ... (引数なしで全種類)。出力は <種類>_out/(sprites, sheets/<種類>_preview_{S,M,L}.png)"""
import sys
from fackit import *

TYPES = {}
VAR_BASE = (0, 2, 5, 8)  # 別色にするデザイン(各種類 +4)
def reg(name, names):
    base = len(names)
    allnames = names + [names[b] + '(別色)' for b in VAR_BASE]
    def deco(fn):
        def wrapped(a):
            if a < base: return fn(a)
            v = a - base; bi = VAR_BASE[v]
            sp = dict(fn(bi)); sp['pal'] = WARM[(bi * 3 + 5 + v * 2) % 10]
            return sp
        TYPES[name] = dict(names=allnames, fn=wrapped)
        return fn
    return deco

def sprite(typ, k, s):
    sp = TYPES[typ]['fn'](k)
    L = sp['layers'](s)
    g = mkground(L, sp.get('base', 0))
    gfn = lambda S_, T_, dx, dy: g(S_, T_, dx, dy)[0]
    tag = lambda S_, T_: g(S_, T_, 0, 0)[1]
    tn = sp.get('tn', {'S': 0, 'M': 5, 'L': 14})[s]
    trees = scatter(tag, tn, k * 5 + 2, .18, sp.get('trees', ['round', 'bush', 'tall'])) if tn else []
    return render3(sp['st'], trees, gfn, sp['pal'], sp['kind'], GEO[s], sp['cr'], k)

def export(typ):
    names = TYPES[typ]['names']
    n = len(names)
    export3(typ, n, GEO, lambda k, s: sprite(typ, k, s), lambda k: f'{k+1:02d} {k+1}', [[i + 1, names[i]] for i in range(n)], ['id', 'type'])

# ---- 共通のパレット ----
WARM = [(236, 232, 220), (214, 196, 160), (190, 98, 70), (176, 176, 182), (150, 190, 220), (130, 190, 170), (232, 220, 190), (120, 170, 150), (200, 170, 110), (150, 160, 176)]
def pk(i, lst=WARM): return lst[i % len(lst)]

# ===== 映画館 =====
CN = ['シネコン(箱型+看板)', '古典の劇場(円柱)', 'ガラスのモール併設', 'ドライブインシアター', 'IMAXドーム', 'L字の複合館', 'レンガの名画座', 'タワー上層シネマ', 'ネオンの小劇場', '野外スクリーン広場', 'ツイン館', '近未来の円筒館']
@reg('cinema', CN)
def cinema(a):
    pal = [(60, 66, 96), (190, 70, 60), (84, 90, 110), (214, 190, 150), (70, 100, 140), (120, 60, 90)][a % 6]
    park = lambda s: [Lasphalt(-.46, -.12, -.44, .44)] if s != 'S' else [Lplaza(.46)]
    st, cr, kind = None, 'marquee', 'concrete'
    if a == 0: st = [S([B(52, 26, R=38, kind='concrete', gr=True)])]
    elif a == 1: st = [S([B(50, 28, R=34, kind='columns'), B(36, 10, R=26, kind='plaster')])]; cr = 'neon'; kind = 'plaster'
    elif a == 2: st = [S([B(56, 20, R=40, kind='glass')], z=-5, crown=False), S([LIFT(20), B(22, 36, R=22, kind='glass')], off=(-10, -6))]; kind = 'glass'
    elif a == 3: st = [S([SB(3, 44, 40, (240, 240, 244))], off=(14, -14), crown=False), S([SB(12, 12, 6, (200, 190, 170))], off=(-24, 14), crown=False)]; cr = 'none'
    elif a == 4: st = [S([C(26, 34, rc=(150, 172, 196))])]; cr = 'dome'; kind = 'glass'
    elif a == 5: st = [S([B(44, 22, R=18)], off=(-14, -8), crown=False), S([B(18, 22, R=44)], off=(18, -2), crown=False), S([B(24, 30, R=24, gr=True)], off=(0, 10))]
    elif a == 6: st = [S([B(40, 22, R=30, kind='brick', roof=('gA', (110, 60, 50), 8), door=True)])]; cr = 'clocktop'; kind = 'brick'
    elif a == 7: st = [S([B(54, 14, R=40, kind='concrete'), B(28, 48, R=28, kind='glass')])]; kind = 'glass'; cr = 'antenna'
    elif a == 8: st = [S([B(32, 30, R=26, kind='stripe', door=True)])]; cr = 'neon'; kind = 'stripe'
    elif a == 9: st = [S([SB(3, 52, 46, (244, 244, 248))], off=(10, -16), crown=False), S([SB(14, 14, 7, (140, 130, 120))], off=(-26, 10), crown=False)]; cr = 'none'
    elif a == 10: st = [S([B(30, 28, R=26, kind='concrete')], off=(-18, -4), crown=False), S([B(30, 28, R=26, kind='stripe')], off=(18, 6))]; cr = 'marquee'
    else: st = [S([C(18, 40, taper=.8)], off=(-12, -4), crown=False), S([B(40, 18, R=24, kind='glass')], off=(14, 8))]; cr = 'searchlight'; kind = 'glass'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=6 if a in (3, 9) else 0, layers=park if a in (0, 3, 9, 10) else (lambda s: [Lplaza(.4 if s != 'S' else .46)]), trees=['bush', 'round'])


def plz(r=.4): return lambda s: [Lplaza(r if s != 'S' else .46)]
def lay(*fs): return lambda s: [f(s) if getattr(f, '_sz', False) else f for f in fs]
def sz(f):
    f._sz = True
    return f

# ===== 動物園・水族館 =====
ZN = ['水族館(ガラスと大水槽)', '動物園のゲート', '大水槽パビリオン', 'ペンギン館', '熱帯ドーム温室', 'イルカショーのプール', 'ふれあい牧場', 'クジラの曲面館', 'サファリの広場', '爬虫類館(レンガ)', '海洋パーク(2棟)', 'アクアリウムタワー']
@reg('zoo', ZN)
def zoo(a):
    pal = [(150, 190, 220), (214, 196, 160), (236, 232, 220), (130, 190, 170), (200, 170, 110), (120, 170, 150)][a % 6]
    cr, kind, st, base = 'none', 'glass', None, 0
    pool = sz(lambda s: Ltank(.04, .44, -.4, -.08) if s != 'S' else Lrect(.0, .4, -.4, -.1, (70, 150, 204), 'water'))
    LY = lay(Lplaza(.3), pool)
    if a == 0: st = [S([B(46, 24, R=34, kind='glass')], off=(-4, 4)), S([B(22, 16, R=22, kind='plaster')], off=(-24, -8), crown=False)]
    elif a == 1: st = [S([B(14, 24, R=14, kind='brick')], off=(-22, 6), crown=False), S([B(14, 24, R=14, kind='brick')], off=(22, 6), crown=False), S([B(54, 6, R=8, kind='plaster')], off=(0, 6), crown=False)]; cr = 'pennants'; kind = 'brick'; LY = plz(.4)
    elif a == 2: st = [S([B(52, 28, R=30, kind='glass')])]; cr = 'flag'
    elif a == 3: st = [S([B(44, 14, R=28, kind='plaster', pal=(244, 246, 250), roof=('gA', (130, 170, 210), 6))])]; cr = 'none'; pal = (244, 246, 250); kind = 'plaster'
    elif a == 4: st = [S([C(28, 24, rc=(170, 210, 190), taper=.86)])]; cr = 'dome'; kind = 'glass'; pal = (120, 190, 150); LY = plz(.3)
    elif a == 5: st = [S([B(26, 20, R=26, kind='concrete')], off=(-14, -10), crown=False)]; cr = 'none'; LY = lay(Lplaza(.3), sz(lambda s: Ltank(.04, .44, -.1, .36)))
    elif a == 6: st = [S([B(26, 12, R=20, kind='plaster', roof=('gA', (150, 70, 54), 6))], off=(-16, -8))]; cr = 'none'; pal = (200, 150, 110); kind = 'plaster'; LY = lay(Lfence(), Lrect(.04, .4, .1, .4, (150, 120, 80), 'paved', 1)); base = 2
    elif a == 7: st = [S([C(24, 22, rc=(70, 130, 200)), C(16, 16, rc=(70, 130, 200))])]; cr = 'whale'; pal = (90, 150, 210)
    elif a == 8: st = [S([B(22, 14, R=22, kind='plaster', roof=('hip', (190, 120, 60), 8))], off=(-18, -6))]; cr = 'none'; pal = (214, 190, 140); kind = 'plaster'; LY = lay(Lring(.34, .05), Lcross(.05)); base = 2
    elif a == 9: st = [S([B(40, 18, R=30, kind='brick', roof=('gA', (96, 120, 80), 7))])]; cr = 'none'; pal = (150, 96, 76); kind = 'brick'
    elif a == 10: st = [S([B(26, 20, R=26, kind='glass')], off=(-18, -6), crown=False), S([B(24, 14, R=24, kind='concrete')], off=(18, 6))]; cr = 'flag'
    else: st = [S([C(18, 62, rc=(110, 190, 220), taper=.9)])]; cr = 'whale'; kind = 'glass'; pal = (100, 180, 220); cr = 'pennants'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=base, layers=LY, trees=['round', 'palm', 'bush'])

# ===== スキー場 =====
KN = ['ゲレンデのロッジ', '山小屋のペンション', 'ゴンドラ駅', 'リゾートホテル併設', 'ログハウス', '山頂レストラン', 'チロル風の宿', 'スキーセンター(ガラス)', '温泉付きロッジ', 'リフト乗り場', '2棟の宿泊棟', 'モダン山岳リゾート']
@reg('ski', KN)
def ski(a):
    pal = [(150, 96, 70), (200, 170, 130), (176, 176, 182), (214, 196, 160), (120, 84, 60), (190, 98, 70)][a % 6]
    cr, kind, st = 'lift', 'plaster', None
    rf = ('gA', (240, 244, 250), 10)
    LY = lay(Lpiste(.16, .0), Lpiste(.12, .62))
    if a == 0: st = [S([B(36, 16, R=26, kind='plaster', roof=rf)])]
    elif a == 1: st = [S([B(28, 14, R=22, kind='brick', roof=('gB', (240, 244, 250), 10))])]; kind = 'brick'
    elif a == 2: st = [S([B(22, 22, R=22, kind='concrete', roof=('hip', (200, 210, 224), 8))])]; kind = 'concrete'
    elif a == 3: st = [S([B(40, 30, R=26, kind='stripe')])]; kind = 'stripe'; cr = 'flag'
    elif a == 4: st = [S([B(32, 14, R=28, kind='brick', roof=('gA', (240, 244, 250), 12))])]; kind = 'brick'; pal = (130, 90, 60); cr = 'none'
    elif a == 5: st = [S([B(30, 26, R=30, kind='glass')])]; kind = 'glass'; cr = 'lift'
    elif a == 6: st = [S([B(34, 18, R=22, kind='plaster', roof=('gA', (176, 76, 60), 12))])]; pal = (236, 226, 204); cr = 'pennants'
    elif a == 7: st = [S([B(46, 16, R=30, kind='glass')])]; kind = 'glass'; pal = (150, 190, 220); cr = 'lift'
    elif a == 8: st = [S([B(28, 14, R=24, kind='plaster', roof=rf)], off=(-10, -4)), S([C(6, 10, rc=(230, 240, 248))], off=(22, 12), crown=False)]; cr = 'none'
    elif a == 9: st = [S([B(14, 12, R=14, kind='concrete', roof=('hip', (90, 90, 100), 6))], off=(-12, 6))]; cr = 'lift'
    elif a == 10: st = [S([B(26, 14, R=20, kind='brick', roof=rf)], off=(-16, -6), crown=False), S([B(22, 16, R=24, kind='plaster', roof=('gB', (240, 244, 250), 9))], off=(16, 8))]; kind = 'brick'
    else: st = [S([B(44, 12, R=24, kind='concrete'), B(30, 12, R=18, kind='glass')])]; kind = 'concrete'; cr = 'flag'; pal = (96, 104, 120)
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=3, layers=LY, trees=['conifer', 'conifer', 'bush'], tn={'S': 0, 'M': 7, 'L': 18})

# ===== ビーチ =====
BN = ['海の家', 'ビーチクラブ(ヤシ)', 'ライフセーバーの塔', 'マリンリゾート', 'サーフショップ', '桟橋とカフェ', 'ビーチバレーのコート', 'ヨットハーバー', '水上コテージ', 'テラス型ビーチハウス', '屋台村', '灯台のあるビーチ']
@reg('beach', BN)
def beach(a):
    pal = [(250, 232, 190), (90, 170, 220), (240, 120, 90), (236, 232, 220), (120, 200, 190), (250, 200, 90)][a % 6]
    cr, kind, st = 'umbrella', 'plaster', None
    LY = lay(Lsea(.12), Lwave(.12))
    if a == 0: st = [S([B(26, 12, R=20, kind='plaster', roof=('gA', (230, 90, 70), 6))], off=(-4, -14))]
    elif a == 1: st = [S([B(34, 12, R=24, kind='plaster', roof=('hip', (90, 170, 210), 6))], off=(-6, -14))]; cr = 'flag'
    elif a == 2: st = [S([SB(3, 3, 8, (220, 220, 214)), LIFT(8), B(12, 8, R=12, kind='plaster', roof=('hip', (214, 60, 52), 5))], off=(0, -12))]; cr = 'none'
    elif a == 3: st = [S([B(36, 30, R=24, kind='stripe')], off=(-2, -16))]; kind = 'stripe'; cr = 'flag'
    elif a == 4: st = [S([B(22, 14, R=20, kind='plaster', roof=('gB', (70, 150, 210), 5))], off=(-6, -14))]; cr = 'none'
    elif a == 5: st = [S([B(22, 12, R=18, kind='plaster', roof=('hip', (250, 200, 90), 6))], off=(-12, -16), crown=False), S([SB(6, 40, 3, (176, 140, 96))], off=(14, 8), crown=False)]
    elif a == 6: st = [S([SB(2, 2, 14, (240, 240, 236))], off=(-14, -10), crown=False)]; cr = 'none'; LY = lay(Lsea(.2), Lcourt(-.4, .1, -.4, .1, (236, 214, 160)))
    elif a == 7: st = [S([B(24, 12, R=18, kind='plaster', roof=('gA', (240, 240, 244), 6))], off=(-10, -14), crown=False), S([SB(4, 46, 3, (176, 140, 96))], off=(10, 8), crown=False)]; cr = 'none'
    elif a == 8: st = [S([B(14, 8, R=14, kind='plaster', roof=('hip', (200, 160, 100), 6))], off=(-14, 4), crown=False), S([B(14, 8, R=14, kind='plaster', roof=('hip', (200, 160, 100), 6))], off=(18, 14), crown=False)]; cr = 'none'; LY = lay(Lsea(-.05), Lwave(-.05))
    elif a == 9: st = [S([B(40, 14, R=26, kind='stripe'), B(30, 12, R=18, kind='glass')], off=(0, -14))]; kind = 'stripe'
    elif a == 10: st = [S([B(10, 8, R=10, kind='plaster', roof=('hip', c, 4))], off=o, crown=False) for o, c in (((-20, -10), (230, 80, 70)), ((0, -16), (250, 200, 90)), ((20, -6), (90, 170, 210)), ((0, 4), (120, 200, 150)))]; cr = 'umbrella'
    else: st = [S([C(8, 44, taper=.7, rc=(214, 60, 52))], off=(-6, -16)), S([B(18, 10, R=16, kind='plaster', roof=('hip', (90, 90, 100), 5))], off=(14, -2), crown=False)]; cr = 'none'; pal = (240, 236, 226)
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=4, layers=LY, trees=['palm', 'palm', 'bush'], tn={'S': 0, 'M': 3, 'L': 8})

# ===== アリーナ・コンサートホール =====
AN = ['ドーム(円形)', 'アリーナ(楕円)', '野外ステージ', 'コンサートホール', 'ライブハウス', '多目的アリーナ+駐車場', '古典のオペラハウス', 'スタジアム型', 'ガラスのホール', '開閉屋根のドーム', 'フェスのテント村', '劇場+ネオン']
@reg('arena', AN)
def arena(a):
    pal = [(176, 176, 182), (120, 130, 150), (214, 196, 160), (96, 104, 130), (190, 98, 70), (150, 160, 176)][a % 6]
    cr, kind, st = 'searchlight', 'concrete', None
    LY = plz(.4)
    if a == 0: st = [S([C(30, 20, rc=(210, 214, 222)), C(26, 8, rc=(230, 232, 238))])]; cr = 'dome'
    elif a == 1: st = [S([B(54, 22, R=40, kind='concrete'), B(42, 8, R=30, kind='stripe')])]
    elif a == 2: st = [S([SB(40, 10, 4, (150, 120, 90))], off=(-6, 10), crown=False), S([B(6, 30, R=40, kind='concrete', pal=(70, 70, 80))], off=(-26, -8), crown=False), S([B(40, 6, R=6, kind='concrete', pal=(70, 70, 80))], off=(8, -14))]; cr = 'none'; LY = lay(Lplaza(.4), Lrect(-.3, .3, .0, .4, (196, 182, 150), 'paved', 1))
    elif a == 3: st = [S([B(40, 24, R=34, kind='columns'), B(28, 12, R=22, kind='plaster')])]; cr = 'neon'; kind = 'plaster'; pal = (222, 206, 176)
    elif a == 4: st = [S([B(26, 20, R=24, kind='brick', door=True)])]; cr = 'neon'; kind = 'brick'
    elif a == 5: st = [S([B(46, 20, R=34, kind='concrete')], off=(0, -4))]; LY = lay(Lplaza(.2), Lasphalt(-.46, -.18, -.44, .44))
    elif a == 6: st = [S([B(44, 22, R=30, kind='columns', roof=('gA', (96, 110, 100), 8))])]; cr = 'dome'; kind = 'columns'; pal = (230, 222, 200)
    elif a == 7: st = [S([C(34, 16, rc=(90, 150, 80)), C(28, 10, rc=(104, 168, 90))])]; cr = 'searchlight'
    elif a == 8: st = [S([B(46, 28, R=34, kind='glass')])]; kind = 'glass'; pal = (130, 170, 210)
    elif a == 9: st = [S([C(30, 22, rc=(110, 120, 140)), SB(20, 20, 6, (200, 205, 214))])]; cr = 'dome'; pal = (120, 126, 146)
    elif a == 10: st = [S([B(14, 12, R=14, kind='plaster', roof=('hip', c, 8))], off=o, crown=False) for o, c in (((-22, -8), (220, 70, 60)), ((0, -14), (250, 200, 80)), ((22, -4), (80, 160, 220)), ((-2, 8), (120, 190, 120)))]; cr = 'pennants'; kind = 'plaster'; pal = (240, 236, 226); LY = lay(Lplaza(.44)); 
    else: st = [S([B(40, 30, R=28, kind='stripe')])]; cr = 'neon'; kind = 'stripe'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=6 if a == 5 else 0, layers=LY, trees=['bush', 'round'])

# ===== コンベンションセンター =====
VN = ['国際会議場(ガラス)', '巨大な展示ホール', 'ツイン展示棟', 'タワー+展示場', '円形ホール', 'ウォーターフロント', 'ガラスのピラミッド', '展示場+広場', 'メッセ(曲面)', 'コの字の会議棟', '高層の会議棟', '屋根付きの回廊']
@reg('convention', VN)
def convention(a):
    pal = [(150, 190, 220), (176, 176, 182), (96, 104, 130), (214, 214, 220), (130, 170, 150), (200, 170, 110)][a % 6]
    cr, kind, st = 'flag', 'glass', None
    LY = plz(.4)
    if a == 0: st = [S([B(50, 24, R=34, kind='glass'), B(30, 14, R=22, kind='glass')])]
    elif a == 1: st = [S([B(60, 18, R=44, kind='concrete')])]; kind = 'concrete'; cr = 'none'
    elif a == 2: st = [S([B(40, 20, R=22, kind='concrete')], off=(-14, -8), crown=False), S([B(22, 20, R=40, kind='concrete')], off=(18, 6))]; kind = 'concrete'
    elif a == 3: st = [S([B(52, 14, R=40, kind='concrete')], z=-9, crown=False), S([LIFT(14), B(18, 50, R=18, kind='glass')], off=(-14, -8))]; cr = 'antenna'
    elif a == 4: st = [S([C(30, 22, rc=(190, 200, 212))])]; cr = 'dome'; pal = (190, 196, 206)
    elif a == 5: st = [S([B(54, 18, R=30, kind='glass'), B(38, 14, R=22, kind='stripe')])]; LY = lay(Lplaza(.2), Lsea(.28))
    elif a == 6: st = [S([B(46, 12, R=46, kind='glass'), B(34, 12, R=34, kind='glass'), B(22, 12, R=22, kind='glass'), B(10, 10, R=10, kind='glass')])]; cr = 'spire'; pal = (170, 210, 230)
    elif a == 7: st = [S([B(50, 16, R=32, kind='concrete')], off=(-4, -14))]; LY = lay(Lplaza(.2), Lrect(-.2, .46, .12, .46, (196, 190, 176), 'paved', 1)); kind = 'concrete'; cr = 'none'
    elif a == 8: st = [S([C(34, 14, rc=(170, 180, 196)), C(26, 10, rc=(196, 204, 216))])]; cr = 'none'; pal = (150, 160, 180)
    elif a == 9: st = [S([B(14, 24, R=44, kind='stripe')], off=(-26, 0), crown=False), S([B(44, 24, R=14, kind='stripe')], off=(24, 0), crown=False), S([B(30, 18, R=24, kind='glass')], off=(0, -20))]; kind = 'stripe'
    elif a == 10: st = [S([B(34, 12, R=34, kind='concrete'), B(24, 46, R=24, kind='glass')])]; cr = 'antenna'
    else: st = [S([B(52, 12, R=36, kind='glass', roof=('gA', (196, 210, 224), 8))])]; cr = 'none'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=0, layers=LY, trees=['bush', 'round'])

# ===== ビジネスホテル =====
HN = ['細長タワー', '駅前のビジネスホテル', 'ツインタワー', 'L字のホテル', 'カプセルホテル', '高層ガラスタワー', '低層チェーンホテル', 'ポディウム+客室棟', 'レンガの中層ホテル', '円筒タワー', '空港ホテル', 'コの字の客室棟']
@reg('bizhotel', HN)
def bizhotel(a):
    pal = [(176, 176, 182), (214, 214, 220), (150, 160, 176), (190, 98, 70), (96, 104, 130), (236, 232, 220)][a % 6]
    cr, kind, st = 'sign', 'concrete', None
    LY = plz(.4)
    if a == 0: st = [S([B(26, 70, R=26, kind='concrete')])]
    elif a == 1: st = [S([B(38, 44, R=22, kind='stripe', gr=True)])]; kind = 'stripe'
    elif a == 2: st = [S([B(20, 54, R=20, kind='concrete')], off=(-18, -6), crown=False), S([B(20, 46, R=20, kind='concrete')], off=(18, 6))]
    elif a == 3: st = [S([B(46, 30, R=18, kind='concrete')], off=(-8, -10), crown=False), S([B(18, 30, R=40, kind='concrete')], off=(18, 6))]
    elif a == 4: st = [S([B(44, 14, R=26, kind='lattice'), B(44, 14, R=26, kind='lattice'), B(44, 14, R=26, kind='lattice')])]; kind = 'lattice'; cr = 'sign2'
    elif a == 5: st = [S([B(30, 80, R=30, kind='glass')])]; kind = 'glass'; cr = 'antenna'
    elif a == 6: st = [S([B(52, 20, R=24, kind='plaster', roof=('gA', (150, 90, 70), 6))])]; kind = 'plaster'; pal = (236, 226, 204)
    elif a == 7: st = [S([B(54, 12, R=40, kind='concrete'), B(24, 44, R=24, kind='concrete')])]; cr = 'sign'
    elif a == 8: st = [S([B(40, 36, R=26, kind='brick')])]; kind = 'brick'; cr = 'sign'; pal = (170, 96, 76)
    elif a == 9: st = [S([C(22, 64)])]; cr = 'sign'; kind = 'glass'; pal = (96, 130, 170)
    elif a == 10: st = [S([B(50, 26, R=34, kind='glass')], z=-5, crown=False), S([LIFT(26), B(16, 20, R=16, kind='glass')], off=(-8, -4))]; kind = 'glass'; cr = 'helipad'
    else: st = [S([B(14, 34, R=42, kind='concrete')], off=(-24, 0), crown=False), S([B(42, 34, R=14, kind='concrete')], off=(22, 0), crown=False), S([B(24, 34, R=24, kind='concrete')], off=(0, -18))]
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=0, layers=LY, trees=['bush', 'round'])

# ===== 大学 =====
UN = ['本館(時計塔)', 'コの字のキャンパス', 'レンガの古典校舎', '近代のガラス棟', '図書館(ドーム)', '理工学部(複数棟)', '講堂と広場', 'グラウンド併設', '研究棟タワー', '学生寮', '体育館', '中庭型キャンパス']
@reg('campus', UN)
def campus(a):
    pal = [(214, 196, 160), (190, 98, 70), (236, 232, 220), (176, 176, 182), (150, 190, 220), (200, 170, 110)][a % 6]
    cr, kind, st = 'clocktop', 'plaster', None
    LY = lay(Lplaza(.2), Lcross(.05))
    if a == 0: st = [S([B(44, 24, R=30, kind='brick', clock=False, door=True)])]; kind = 'brick'
    elif a == 1: st = [S([B(14, 22, R=40, kind='plaster')], off=(-24, 0), crown=False), S([B(40, 22, R=14, kind='plaster')], off=(22, 0), crown=False), S([B(26, 22, R=22, kind='plaster', door=True)], off=(0, -16))]; cr = 'clocktop'
    elif a == 2: st = [S([B(46, 20, R=30, kind='brick', roof=('gA', (96, 110, 100), 8), door=True)])]; kind = 'brick'; cr = 'clocktop'
    elif a == 3: st = [S([B(44, 26, R=30, kind='glass')])]; kind = 'glass'; cr = 'none'
    elif a == 4: st = [S([B(36, 16, R=28, kind='columns'), B(22, 8, R=18, kind='plaster')])]; cr = 'gdome'; kind = 'columns'
    elif a == 5: st = [S([B(24, 20, R=22, kind='concrete')], off=(-18, -8), crown=False), S([B(24, 28, R=22, kind='concrete')], off=(16, -2), crown=False), S([B(22, 16, R=22, kind='concrete')], off=(0, 12))]; cr = 'none'; kind = 'concrete'
    elif a == 6: st = [S([B(40, 18, R=28, kind='columns')])]; cr = 'gdome'; kind = 'columns'; LY = lay(Lplaza(.46))
    elif a == 7: st = [S([B(26, 16, R=22, kind='plaster', door=True)], off=(-16, -10))]; cr = 'clocktop'; LY = lay(Lrect(-.1, .44, -.1, .44, (110, 170, 80), 'field'), Lcross(.0))
    elif a == 8: st = [S([B(22, 68, R=22, kind='glass')])]; kind = 'glass'; cr = 'antenna'; pal = (130, 170, 210)
    elif a == 9: st = [S([B(44, 26, R=20, kind='concrete')], off=(-8, -6), crown=False), S([B(20, 26, R=36, kind='concrete')], off=(20, 10))]; cr = 'none'; kind = 'concrete'
    elif a == 10: st = [S([B(52, 14, R=40, kind='stripe', roof=('gA', (150, 160, 176), 6))])]; cr = 'none'; kind = 'stripe'
    else: st = [S([B(46, 20, R=14, kind='plaster')], off=(-8, -20), crown=False), S([B(14, 20, R=46, kind='plaster')], off=(24, -2), crown=False), S([B(46, 20, R=14, kind='plaster')], off=(8, 18), crown=False)]; cr = 'clocktop'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=0, layers=LY, trees=['round', 'sakura', 'bush'])

# ===== ゴルフ場 =====
GN = ['クラブハウスとグリーン', '打ちっぱなし練習場', '池越えのホール', 'リゾートコース', 'ミニゴルフ', '丘のコース', '林間コース', '海沿いコース', '2階建ての練習場', 'ホテル併設のコース', 'パターゴルフ広場', 'クラシックなコース']
@reg('golf', GN)
def golf(a):
    pal = [(236, 232, 220), (214, 196, 160), (176, 176, 182), (230, 226, 210), (150, 190, 170), (200, 170, 110)][a % 6]
    cr, kind, st = 'flag', 'plaster', None
    LY = lay(Lfairway(.14, .35), Lgreen(.28, -.18, .12), Lbunker(.05, .22, .09, .06), Lbunker(-.28, -.2, .08, .05))
    if a == 0: st = [S([B(26, 14, R=22, kind='plaster', roof=('gA', (90, 130, 100), 6))], off=(-20, 12))]; cr = 'flag'
    elif a == 1: st = [S([B(24, 14, R=26, kind='concrete', roof=('gA', (160, 160, 168), 4))], off=(-18, 8), crown=False), S([SB(2, 40, 16, (110, 160, 110))], off=(10, -8), crown=False)]; cr = 'none'; LY = lay(Lrect(-.1, .46, -.3, .3, (110, 176, 80), 'fairway'))
    elif a == 2: st = [S([B(24, 14, R=20, kind='plaster', roof=('hip', (150, 70, 54), 6))], off=(-22, 12))]; LY = lay(Lfairway(.12, .2), Lpond(.0, .0, .2, .14), Lgreen(.34, -.26, .1))
    elif a == 3: st = [S([B(34, 18, R=26, kind='stripe', roof=('hip', (90, 120, 150), 6))], off=(-20, 12))]; kind = 'stripe'
    elif a == 4: st = [S([B(14, 10, R=14, kind='plaster', roof=('hip', (200, 80, 60), 5))], off=(-22, 14))]; LY = lay(Lgreen(-.1, -.2, .1), Lgreen(.2, .0, .1), Lgreen(-.05, .24, .1), Lcross(.03))
    elif a == 5: st = [S([B(28, 14, R=22, kind='brick', roof=('gA', (110, 60, 50), 6))], off=(-20, 12))]; kind = 'brick'; LY = lay(Lfairway(.14, -.3), Lgreen(.3, .2, .12), Lbunker(.0, -.1, .1, .06))
    elif a == 6: st = [S([B(24, 12, R=22, kind='plaster', roof=('gA', (90, 70, 50), 6))], off=(-22, 12))]; cr = 'none'
    elif a == 7: st = [S([B(26, 14, R=22, kind='plaster', roof=('hip', (230, 230, 236), 6))], off=(-20, 12))]; LY = lay(Lsea(.2), Lfairway(.1, .2), Lgreen(.24, -.22, .1))
    elif a == 8: st = [S([B(24, 28, R=26, kind='concrete', roof=('gA', (160, 160, 168), 4))], off=(-18, 4), crown=False), S([SB(2, 40, 20, (110, 160, 110))], off=(14, -8), crown=False)]; cr = 'none'; LY = lay(Lrect(-.1, .46, -.3, .3, (110, 176, 80), 'fairway'))
    elif a == 9: st = [S([B(30, 28, R=22, kind='stripe')], off=(-18, 8))]; kind = 'stripe'; cr = 'flag'
    elif a == 10: st = [S([B(12, 8, R=12, kind='plaster', roof=('hip', (200, 80, 60), 4))], off=(-24, 14))]; LY = lay(Lgreen(-.16, -.18, .13), Lgreen(.2, -.08, .13), Lgreen(.0, .24, .13), Lbunker(.3, .3, .08, .05))
    else: st = [S([B(30, 18, R=24, kind='columns', roof=('gA', (96, 110, 100), 6))], off=(-18, 12))]; kind = 'columns'; cr = 'flag'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=5, layers=LY, trees=['round', 'tall', 'bush'], tn={'S': 0, 'M': 6, 'L': 16})

# ===== 病院 =====
PN = ['総合病院(白い箱)', 'クリニック', '大学病院タワー', 'L字の病棟', 'ヘリポート付き', 'コの字の病院', 'レンガの古い病院', 'ガラスの病棟', 'ツイン棟', '円形病棟', 'リハビリセンター', '救急センター']
@reg('hospital', PN)
def hospital(a):
    pal = [(236, 238, 242), (214, 226, 236), (236, 232, 220), (200, 220, 214), (226, 214, 230), (244, 240, 230)][a % 6]
    cr, kind, st = 'redcross', 'concrete', None
    LY = lay(Lplaza(.3), Lrect(.1, .46, -.12, .12, (110, 110, 116), 'paved', 1)) if False else plz(.38)
    if a == 0: st = [S([B(46, 30, R=30, kind='concrete')])]
    elif a == 1: st = [S([B(30, 14, R=24, kind='plaster', roof=('gA', (120, 170, 200), 6))])]; kind = 'plaster'
    elif a == 2: st = [S([B(44, 16, R=34, kind='concrete'), B(24, 46, R=24, kind='glass')])]; cr = 'redcross'
    elif a == 3: st = [S([B(46, 28, R=18, kind='concrete')], off=(-8, -10), crown=False), S([B(18, 28, R=40, kind='concrete')], off=(18, 6))]
    elif a == 4: st = [S([B(40, 30, R=30, kind='concrete')])]; cr = 'helipad'
    elif a == 5: st = [S([B(14, 28, R=42, kind='concrete')], off=(-24, 0), crown=False), S([B(42, 28, R=14, kind='concrete')], off=(22, 0), crown=False), S([B(26, 28, R=24, kind='concrete')], off=(0, -18))]
    elif a == 6: st = [S([B(44, 22, R=30, kind='brick', roof=('gA', (96, 110, 100), 8), door=True)])]; kind = 'brick'; pal = (190, 120, 96)
    elif a == 7: st = [S([B(46, 26, R=34, kind='glass')])]; kind = 'glass'; pal = (150, 190, 214)
    elif a == 8: st = [S([B(22, 36, R=22, kind='concrete')], off=(-18, -6), crown=False), S([B(22, 30, R=22, kind='concrete')], off=(18, 6))]
    elif a == 9: st = [S([C(26, 30)])]; kind = 'concrete'
    elif a == 10: st = [S([B(46, 16, R=26, kind='plaster', roof=('gA', (130, 180, 150), 6))])]; cr = 'none'; kind = 'plaster'; LY = lay(Lplaza(.2), Lrect(.1, .46, -.4, .1, (110, 170, 80), 'grass'))
    else: st = [S([B(34, 18, R=30, kind='stripe', door=True)])]; kind = 'stripe'; cr = 'redcross'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=0, layers=LY, trees=['bush', 'round'])

# ===== 駅ビル =====
SN = ['駅ビル(箱型)', '駅ナカの長い商業棟', '百貨店型の駅ビル', 'ガラスのコンコース', 'ホーム直結タワー', 'レンガの駅舎ビル', 'アーケード商店街', 'バスターミナル併設', 'ステーションシティ', '円弧のファサード', 'ペデストリアンデッキ', 'トレインビュー']
@reg('stationmall', SN)
def stationmall(a):
    pal = [(214, 214, 220), (190, 98, 70), (150, 190, 220), (236, 232, 220), (176, 176, 182), (200, 170, 110)][a % 6]
    cr, kind, st = 'train', 'stripe', None
    LY = lay(Lrails(.1, .46, 2), Lplaza(.0))
    if a == 0: st = [S([B(46, 28, R=24, kind='stripe')], off=(-6, -12))]
    elif a == 1: st = [S([B(60, 14, R=20, kind='stripe')], off=(-4, -10))]
    elif a == 2: st = [S([B(44, 30, R=26, kind='columns')], off=(-6, -12))]; kind = 'columns'; pal = (230, 222, 200)
    elif a == 3: st = [S([B(52, 14, R=26, kind='glass', roof=('gA', (190, 210, 226), 8))], off=(-4, -10))]; kind = 'glass'; cr = 'none'
    elif a == 4: st = [S([B(44, 12, R=24, kind='stripe'), B(24, 46, R=22, kind='glass')], off=(-6, -12))]; cr = 'antenna'
    elif a == 5: st = [S([B(46, 22, R=24, kind='brick', roof=('gA', (96, 110, 100), 8), door=True)], off=(-6, -12))]; kind = 'brick'; cr = 'clocktop'
    elif a == 6: st = [S([B(56, 10, R=18, kind='plaster', roof=('gA', (150, 100, 80), 6))], off=(-6, -10))]; kind = 'plaster'; cr = 'none'
    elif a == 7: st = [S([B(34, 20, R=22, kind='stripe')], off=(-14, -12), crown=False), S([B(24, 8, R=30, kind='concrete', roof=('gB', (170, 170, 176), 4))], off=(16, 8))]
    elif a == 8: st = [S([B(30, 14, R=30, kind='stripe'), B(22, 40, R=22, kind='glass')], off=(-12, -12), crown=False), S([B(30, 18, R=24, kind='stripe')], off=(16, 2))]; cr = 'train'
    elif a == 9: st = [S([C(24, 22, taper=.9)], off=(-8, -12))]; cr = 'train'
    elif a == 10: st = [S([B(30, 22, R=22, kind='stripe')], off=(-16, -12), crown=False), S([SB(6, 50, 4, (190, 190, 196))], off=(14, 6), crown=False)]; cr = 'train'
    else: st = [S([B(40, 26, R=24, kind='glass')], off=(-6, -12))]; kind = 'glass'; cr = 'train'
    return dict(st=st, cr=cr, pal=pal, kind=kind, base=6, layers=LY, trees=['bush'], tn={'S': 0, 'M': 2, 'L': 5})

if __name__ == '__main__':
    for t in (sys.argv[1:] or list(TYPES)): export(t)
