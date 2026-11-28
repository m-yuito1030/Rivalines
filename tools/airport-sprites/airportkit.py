"""Airport sprites: runway / taxiway / apron / stand pieces, the terminal, the control tower, hangars, fences and jet bridges.

One cell is 64 x 96. The tile's diamond sits at the bottom of the cell: its top corner is at (32, 64), its left / right corners at (0, 80) / (64, 80)
and its bottom corner at (32, 96). Things taller than the ground rise above the diamond (up to 64 px).
u runs toward the lower right (east), v toward the lower left (south), as in the game's drawTile.ts.

    python3 airportkit.py ../../src/client/assets/airport.png ../../src/shared/data/airportKit.json [preview.png]
"""
import json
import sys
from PIL import Image, ImageDraw

W, H = 64, 96
TOPY = 64
OUT = (34, 38, 46)  # outline colour

im = d = px = None


def new():
    global im, d, px
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    px = im.load()


def mul(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c[:3])


def lerp(a, b, t):
    return tuple(int(a[n] + (b[n] - a[n]) * t) for n in range(3))


def hsh(a, b, c=0):
    return ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) % 1000


def put(x, y, c):
    x = int(x)
    y = int(y)
    if 0 <= x < W and 0 <= y < H:
        px[x, y] = (c[0], c[1], c[2], 255)


def P(u, v, z=0):
    """Screen position of the point (u, v) at height z (in pixels) of the tile"""
    return (32 + (u - v) * 32, TOPY + (u + v) * 16 - z)


def ground(fn):
    """Paint every pixel of the diamond with fn(u, v, x, y)"""
    for y in range(TOPY, H):
        for x in range(W):
            a = (x + 0.5 - 32) / 32
            b = (y + 0.5 - TOPY) / 16
            u = (a + b) / 2
            v = (b - a) / 2
            if 0 <= u < 1 and 0 <= v < 1:
                c = fn(u, v, x, y)
                if c:
                    put(x, y, c)


def strip(u0, u1, v0, v1, color, only_ground=True):
    """Paint the rectangle u0..u1 x v0..v1 of the ground"""
    for y in range(TOPY, H):
        for x in range(W):
            a = (x + 0.5 - 32) / 32
            b = (y + 0.5 - TOPY) / 16
            u = (a + b) / 2
            v = (b - a) / 2
            if 0 <= u < 1 and 0 <= v < 1 and u0 <= u < u1 and v0 <= v < v1:
                put(x, y, color)


def poly(pts, fill, outline=None):
    pts = [(round(x), round(y)) for x, y in pts]
    d.polygon(pts, fill=(*fill, 255), outline=(*(outline or OUT), 255))


def line(a, b, c):
    d.line([(round(a[0]), round(a[1])), (round(b[0]), round(b[1]))], fill=(*c, 255))


def asphalt(base, noise=5, speck=0):
    def f(u, v, x, y):
        n = hsh(x, y)
        c = mul(base, 1 + (n - 500) / 500 * noise / 100)
        if speck and hsh(x, y, 9) < speck:
            c = mul(base, 1.28)
        return c

    return f


# ---------------------------------------------------------------- ground pieces
RUNWAY = (50, 53, 60)
TAXI = (74, 78, 86)
APRON = (146, 150, 150)
WHITE = (240, 240, 236)
YELLOW = (232, 200, 64)
PAINT = (228, 220, 150)


def runway(axis, kind):
    """A runway tile. axis 0 = along u, 1 = along v. kind: mid, alt (touchdown marks), start / end (threshold stripes at the u0 / u1 end)"""
    new()
    ground(asphalt(RUNWAY, 7, 6))

    def R(a0, a1, b0, b1, c):
        # a runs along the runway, b across it
        if axis == 0:
            strip(a0, a1, b0, b1, c)
        else:
            strip(b0, b1, a0, a1, c)

    R(0, 1, 0.045, 0.085, WHITE)
    R(0, 1, 0.915, 0.955, WHITE)
    if kind in ('mid', 'alt'):
        for a in ([0.05, 0.40, 0.75] if kind == 'mid' else [0.0, 0.35, 0.70]):
            R(a, a + 0.22, 0.47, 0.53, WHITE)
        if kind == 'alt':
            for b in (0.2, 0.74):
                R(0.3, 0.72, b, b + 0.07, WHITE)
    else:
        a0 = 0.1 if kind == 'start' else 0.62
        for k in range(8):
            b = 0.12 + k * 0.1
            R(a0, a0 + 0.26, b, b + 0.055, WHITE)
        R(0.45 if kind == 'start' else 0.0, 0.62 if kind == 'start' else 0.15, 0.47, 0.53, WHITE)
    # Edge lights: small white dots on both edges of the runway
    for b in (0.02, 0.98):
        x, y = P(0.5, b) if axis == 0 else P(b, 0.5)
        put(x, y, (255, 250, 200))
    # Rubber marks at the ends
    if kind in ('start', 'end'):
        for k in range(14):
            a = 0.35 + hsh(k, 1) / 1000 * 0.4 if kind == 'start' else 0.05 + hsh(k, 2) / 1000 * 0.4
            b = 0.2 + hsh(k, 3) / 1000 * 0.6
            x, y = P(a, b) if axis == 0 else P(b, a)
            put(x, y, mul(RUNWAY, 0.7))
    return im.copy()


def taxiway(mask):
    """A taxiway tile. mask bits: 1 = u0, 2 = u1, 4 = v0, 8 = v1 neighbour is linked. The yellow centre line goes to the linked sides"""
    new()
    ground(asphalt(TAXI, 6, 5))
    yel = YELLOW
    w = 0.03
    cu0 = 0.5 if not mask & 1 else 0
    cu1 = 0.5 if not mask & 2 else 1
    cv0 = 0.5 if not mask & 4 else 0
    cv1 = 0.5 if not mask & 8 else 1
    if mask & 3:
        strip(cu0, cu1, 0.5 - w, 0.5 + w, yel)
    if mask & 12:
        strip(0.5 - w, 0.5 + w, cv0, cv1, yel)
    if not mask & 15:
        strip(0.45, 0.55, 0.45, 0.55, yel)
    # Blue edge lights at the sides that are not linked
    for sidebit, (u, v) in ((1, (0.03, 0.5)), (2, (0.97, 0.5)), (4, (0.5, 0.03)), (8, (0.5, 0.97))):
        if not mask & sidebit:
            x, y = P(u, v)
            put(x, y, (90, 170, 255))
    return im.copy()


def apron(variant):
    new()
    base = (146, 150, 150)

    def f(u, v, x, y):
        n = hsh(x, y, variant)
        c = mul(base, 1 + (n - 500) / 500 * 0.05)
        # Panel joints
        ju = abs(u - (0.5 + (variant % 2) * 0.0)) < 0.018
        jv = abs(v - 0.5) < 0.018
        if ju or jv:
            c = mul(base, 0.8)
        # Oil stains
        if variant >= 2 and (u - 0.3) ** 2 + (v - 0.65) ** 2 < 0.012 + 0.002 * hsh(x, y, 4) / 1000:
            c = mul(base, 0.84)
        return c

    ground(f)
    return im.copy()


def stand(direction):
    """A parking stand: painted box and a lead-in line toward `direction` (0 u0, 1 u1, 2 v0, 3 v1)"""
    new()
    ground(lambda u, v, x, y: mul((146, 150, 150), 1 + (hsh(x, y, 7) - 500) / 500 * 0.05))
    pc = PAINT
    t = 0.03
    strip(0.14, 0.86, 0.14, 0.14 + t, pc)
    strip(0.14, 0.86, 0.86 - t, 0.86, pc)
    strip(0.14, 0.14 + t, 0.14, 0.86, pc)
    strip(0.86 - t, 0.86, 0.14, 0.86, pc)
    # Lead-in line and the stop bar
    if direction == 0:
        strip(0, 0.14, 0.48, 0.52, YELLOW)
        strip(0.3, 0.34, 0.35, 0.65, pc)
    elif direction == 1:
        strip(0.86, 1, 0.48, 0.52, YELLOW)
        strip(0.66, 0.7, 0.35, 0.65, pc)
    elif direction == 2:
        strip(0.48, 0.52, 0, 0.14, YELLOW)
        strip(0.35, 0.65, 0.3, 0.34, pc)
    else:
        strip(0.48, 0.52, 0.86, 1, YELLOW)
        strip(0.35, 0.65, 0.66, 0.7, pc)
    return im.copy()


def hold_line(side):
    """A double yellow hold-short line along one edge of a taxiway tile that meets a runway"""
    new()
    if side == 0:
        strip(0.0, 0.04, 0, 1, YELLOW)
        strip(0.08, 0.12, 0, 1, YELLOW)
    elif side == 1:
        strip(0.96, 1.0, 0, 1, YELLOW)
        strip(0.88, 0.92, 0, 1, YELLOW)
    elif side == 2:
        strip(0, 1, 0.0, 0.04, YELLOW)
        strip(0, 1, 0.08, 0.12, YELLOW)
    else:
        strip(0, 1, 0.96, 1.0, YELLOW)
        strip(0, 1, 0.88, 0.92, YELLOW)
    return im.copy()


# ---------------------------------------------------------------- solids
def face_left(u0, u1, v, h, z0=0):
    """The left face (the plane v = const, facing lower left): points p (0..1 along u) and q (0..1 up)"""
    return [P(u0, v, z0), P(u1, v, z0), P(u1, v, z0 + h), P(u0, v, z0 + h)]


def face_right(u, v0, v1, h, z0=0):
    return [P(u, v0, z0), P(u, v1, z0), P(u, v1, z0 + h), P(u, v0, z0 + h)]


def top_face(u0, u1, v0, v1, z):
    return [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)]


def paint_left(u0, u1, v, h, fn, z0=0):
    """Paint the left face with fn(p, q, x, y) -> colour or None"""
    n = 90
    for i in range(n * 2):
        for j in range(int(h * 3)):
            p = (i + 0.5) / (n * 2)
            q = (j + 0.5) / (h * 3)
            x, y = P(u0 + (u1 - u0) * p, v, z0 + h * q)
            c = fn(p, q, int(x), int(y))
            if c:
                put(x, y, c)


def paint_right(u, v0, v1, h, fn, z0=0):
    n = 90
    for i in range(n * 2):
        for j in range(int(h * 3)):
            p = (i + 0.5) / (n * 2)
            q = (j + 0.5) / (h * 3)
            x, y = P(u, v0 + (v1 - v0) * p, z0 + h * q)
            c = fn(p, q, int(x), int(y))
            if c:
                put(x, y, c)


def paint_top(u0, u1, v0, v1, z, fn):
    n = 70
    for i in range(n):
        for j in range(n):
            p = (i + 0.5) / n
            q = (j + 0.5) / n
            x, y = P(u0 + (u1 - u0) * p, v0 + (v1 - v0) * q, z)
            c = fn(p, q, int(x), int(y))
            if c:
                put(x, y, c)


def box(u0, u1, v0, v1, h, wall, roof, z0=0, wall_fn=None, roof_fn=None):
    """A box: left face (v = v1), right face (u = u1) and a roof. wall_fn(side, p, q, x, y) paints the details (side 'L' / 'R')"""
    poly(face_left(u0, u1, v1, h, z0), wall)
    poly(face_right(u1, v0, v1, h, z0), mul(wall, 0.66))
    poly(top_face(u0, u1, v0, v1, z0 + h), roof)
    if wall_fn:
        paint_left(u0, u1, v1, h, lambda p, q, x, y: wall_fn('L', p, q, x, y), z0)
        paint_right(u1, v0, v1, h, lambda p, q, x, y: wall_fn('R', p, q, x, y), z0)
    if roof_fn:
        paint_top(u0, u1, v0, v1, z0 + h, roof_fn)
    # Outline last, so that it stays crisp
    for pts in (face_left(u0, u1, v1, h, z0), face_right(u1, v0, v1, h, z0), top_face(u0, u1, v0, v1, z0 + h)):
        for k in range(4):
            line(pts[k], pts[(k + 1) % 4], OUT)


GLASS = (86, 132, 178)
WALL = (216, 220, 228)


def terminal_wall(h, band=(0.24, 0.74)):
    def f(side, p, q, x, y):
        k = 1.0 if side == 'L' else 0.66
        if q < 0.07 or q > 0.93:
            return mul((150, 156, 168), k)
        if band[0] <= q <= band[1]:
            col = int(p * 8) % 2
            # Glass with mullions every eighth
            if (p * 8) % 1 < 0.1:
                return mul((226, 230, 238), k)
            g = lerp((110, 158, 204), (70, 112, 160), (q - band[0]) / (band[1] - band[0]))
            if hsh(x, y, 3) < 70:
                g = lerp(g, (190, 220, 245), 0.4)
            return mul(g, k)
        if q > band[1]:
            return mul((236, 240, 246), k)
        return None

    return f


def roof_clutter(variant, base=(124, 128, 138)):
    def f(p, q, x, y):
        n = hsh(x, y, 5)
        c = mul(base, 1 + (n - 500) / 500 * 0.05)
        # Air conditioning boxes and a skylight strip
        for (a, b, ww, hh, col) in ((0.15, 0.2, 0.18, 0.2, (176, 180, 188)), (0.6, 0.55, 0.2, 0.22, (170, 174, 184))):
            if variant % 2 == 0 and a <= p < a + ww and b <= q < b + hh:
                return col
        if variant >= 1 and 0.12 <= p <= 0.88 and 0.44 <= q <= 0.56:
            return (120, 170, 214)
        if p < 0.06 or p > 0.94 or q < 0.06 or q > 0.94:
            return mul(base, 1.2)
        return c

    return f


def terminal_part(mask, variant):
    """The terminal building: mask bits tell which sides touch another building tile (1 u0, 2 u1, 4 v0, 8 v1)"""
    new()
    ground(asphalt(APRON, 4))
    u0 = 0.0 if mask & 1 else 0.08
    u1 = 1.0 if mask & 2 else 0.92
    v0 = 0.0 if mask & 4 else 0.08
    v1 = 1.0 if mask & 8 else 0.92
    h = 24
    box(u0, u1, v0, v1, h, WALL, (118, 122, 132), wall_fn=terminal_wall(h), roof_fn=roof_clutter(variant))
    return im.copy()


def terminal_main():
    """The terminal tile that is the stop: taller, with the entrance canopy and the control tower on top"""
    new()
    ground(asphalt(APRON, 4))
    h = 28
    box(0.04, 0.96, 0.04, 0.96, h, (224, 228, 236), (58, 112, 190), wall_fn=terminal_wall(h, (0.2, 0.76)), roof_fn=lambda p, q, x, y: (74, 134, 212) if 0.04 < p < 0.96 and 0.04 < q < 0.96 and (p < 0.07 or p > 0.93 or q < 0.07 or q > 0.93) else mul((58, 112, 190), 1 + (hsh(x, y, 1) - 500) / 6000))
    # Entrance canopy on the lower left face
    poly([P(0.25, 1.0, 12), P(0.75, 1.0, 12), P(0.75, 1.1, 10), P(0.25, 1.1, 10)], (250, 250, 252))
    # Control tower
    base = h
    box(0.4, 0.6, 0.4, 0.6, 14, (232, 236, 242), (160, 166, 176), z0=base)
    # Cab (wider, glass)
    box(0.33, 0.67, 0.33, 0.67, 7, (120, 178, 224), (90, 96, 108), z0=base + 14, wall_fn=lambda s, p, q, x, y: (200, 232, 255) if (p * 4) % 1 < 0.12 else None)
    # Antenna
    x, y = P(0.5, 0.5, base + 24)
    line((x, y), (x, y - 8), OUT)
    put(x, y - 8, (255, 60, 60))
    # Sign band on the right face
    paint_right(0.96, 0.04, 0.96, 6, lambda p, q, x, y: (40, 80, 150) if 0.3 < p < 0.7 and 0.2 < q < 0.8 else None, z0=h - 8)
    return im.copy()


def hangar(kind, variant):
    """A hangar: kind 'L' has its big door on the lower-left face, kind 'R' on the lower-right face"""
    new()
    ground(asphalt(APRON, 4))
    wall = [(172, 168, 156), (150, 160, 172)][variant]
    roof = [(120, 126, 134), (104, 118, 138)][variant]
    h = 14
    u0, u1, v0, v1 = 0.06, 0.94, 0.06, 0.94

    def door(side, p, q, x, y):
        k = 1.0 if side == 'L' else 0.66
        if q < 0.08:
            return mul((110, 112, 116), k)
        if (side == 'L') == (kind == 'L') and 0.12 <= p <= 0.88 and q < 0.82:
            # The sliding door with a rail and vertical panels
            c = (88, 94, 104) if int(p * 10) % 2 == 0 else (78, 84, 94)
            if q > 0.7:
                c = (200, 190, 70)  # hazard band
            return mul(c, k)
        if 0.12 <= p <= 0.88 and 0.82 <= q:
            return mul((60, 64, 72), k)
        return None

    poly(face_left(u0, u1, v1, h), wall)
    poly(face_right(u1, v0, v1, h), mul(wall, 0.66))
    paint_left(u0, u1, v1, h, lambda p, q, x, y: door('L', p, q, x, y))
    paint_right(u1, v0, v1, h, lambda p, q, x, y: door('R', p, q, x, y))
    # Gable roof: the ridge runs along v for 'L' (gable end = the left face), along u for 'R'
    rz = h + 9
    if kind == 'L':
        a = [P(u0, v0, h), P(u1, v0, h), P(0.5 + (u1 - 0.5) * 0, v0, h)]
        slope1 = [P(u0, v0, h), P(0.5, v0, rz), P(0.5, v1, rz), P(u0, v1, h)]
        slope2 = [P(0.5, v0, rz), P(u1, v0, h), P(u1, v1, h), P(0.5, v1, rz)]
        poly(slope1, mul(roof, 1.12))
        poly(slope2, mul(roof, 0.82))
        # Gable triangle on the left face (v = v1)
        poly([P(u0, v1, h), P(u1, v1, h), P(0.5, v1, rz)], wall)
        # Door shows below the gable (painted above)
        paint_left(u0, u1, v1, h, lambda p, q, x, y: door('L', p, q, x, y))
        line(P(u0, v1, h), P(0.5, v1, rz), OUT)
        line(P(u1, v1, h), P(0.5, v1, rz), OUT)
        line(P(0.5, v0, rz), P(0.5, v1, rz), OUT)
    else:
        slope1 = [P(u0, v0, h), P(u1, v0, h), P(u1, 0.5, rz), P(u0, 0.5, rz)]
        slope2 = [P(u0, 0.5, rz), P(u1, 0.5, rz), P(u1, v1, h), P(u0, v1, h)]
        poly(slope1, mul(roof, 0.9))
        poly(slope2, mul(roof, 1.1))
        poly([P(u1, v0, h), P(u1, v1, h), P(u1, 0.5, rz)], mul(wall, 0.66))
        paint_right(u1, v0, v1, h, lambda p, q, x, y: door('R', p, q, x, y))
        line(P(u1, v0, h), P(u1, 0.5, rz), OUT)
        line(P(u1, v1, h), P(u1, 0.5, rz), OUT)
        line(P(u0, 0.5, rz), P(u1, 0.5, rz), OUT)
    for pts in (face_left(u0, u1, v1, h), face_right(u1, v0, v1, h)):
        for k in range(4):
            line(pts[k], pts[(k + 1) % 4], OUT)
    return im.copy()


# ---------------------------------------------------------------- overlays
def fence(side):
    """A chain-link fence along one edge of the tile (0 u0, 1 u1, 2 v0, 3 v1)"""
    new()
    hh = 6
    if side in (0, 1):
        u = 0.0 if side == 0 else 1.0
        a, b = P(u, 0, 0), P(u, 1, 0)
    else:
        v = 0.0 if side == 2 else 1.0
        a, b = P(0, v, 0), P(1, v, 0)
    for t in range(0, 17):
        f = t / 16
        x = a[0] + (b[0] - a[0]) * f
        y = a[1] + (b[1] - a[1]) * f
        # Mesh: a thin lighter wire at the top and the middle
        put(x, y - hh, (186, 190, 196))
        put(x, y - hh // 2, (146, 150, 158)) if t % 2 == 0 else None
        if t % 4 == 0:
            for z in range(hh + 1):
                put(x, y - z, (70, 74, 82))
    return im.copy()


def jet_bridge(side):
    """A jet bridge: a covered walkway from the building at `side` toward the middle of the stand"""
    new()
    h = 8
    cu, cv = 0.5, 0.5
    if side == 0:
        a, b = (0.0, 0.5), (0.5, 0.5)
    elif side == 1:
        a, b = (1.0, 0.5), (0.5, 0.5)
    elif side == 2:
        a, b = (0.5, 0.0), (0.5, 0.5)
    else:
        a, b = (0.5, 1.0), (0.5, 0.5)
    w = 0.09
    if side in (0, 1):
        u0, u1 = sorted((a[0], b[0]))
        v0, v1 = 0.5 - w, 0.5 + w
    else:
        v0, v1 = sorted((a[1], b[1]))
        u0, u1 = 0.5 - w, 0.5 + w
    box(u0, u1, v0, v1, 3, (214, 218, 226), (236, 240, 246), z0=h - 3, wall_fn=lambda s, p, q, x, y: (90, 130, 176) if 0.25 < q < 0.75 else None)
    # The rotunda at the aircraft end and its support
    x, y = P(b[0], b[1], 0)
    for z in range(h - 3):
        put(x, y - z, (110, 114, 122))
    return im.copy()


def windsock():
    new()
    x, y = P(0.5, 0.5, 0)
    for z in range(14):
        put(x, y - z, (200, 200, 204))
    # Orange-and-white cone
    for k, c in enumerate([(240, 120, 40), (250, 250, 250), (240, 120, 40), (250, 250, 250)]):
        put(x + 1 + k, y - 13 + (k // 2), c)
        put(x + 1 + k, y - 12 + (k // 2), c)
    return im.copy()


def main(out_png, out_json, preview=None):
    pieces = {}
    for axis in (0, 1):
        for kind in ('mid', 'alt', 'start', 'end'):
            pieces[f'runway_{axis}_{kind}'] = runway(axis, kind)
    for m in range(16):
        pieces[f'taxi_{m}'] = taxiway(m)
    for v in range(4):
        pieces[f'apron_{v}'] = apron(v)
    for s in range(4):
        pieces[f'stand_{s}'] = stand(s)
        pieces[f'hold_{s}'] = hold_line(s)
        pieces[f'fence_{s}'] = fence(s)
        pieces[f'jet_{s}'] = jet_bridge(s)
    for m in range(16):
        for var in range(3):
            pieces[f'term_{m}_{var}'] = terminal_part(m, var)
    pieces['term_main'] = terminal_main()
    for k in ('L', 'R'):
        for var in range(2):
            pieces[f'hangar_{k}_{var}'] = hangar(k, var)
    pieces['windsock'] = windsock()
    names = list(pieces)
    cols = 16
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * W, rows * H), (0, 0, 0, 0))
    for i, n in enumerate(names):
        sheet.alpha_composite(pieces[n], ((i % cols) * W, (i // cols) * H))
    sheet.save(out_png, optimize=True)
    json.dump({'cell': [W, H], 'cols': cols, 'groundTop': TOPY, 'names': names}, open(out_json, 'w'), indent=1)
    if preview:
        bg = Image.new('RGBA', sheet.size, (74, 122, 62, 255))
        bg.alpha_composite(sheet)
        bg.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(preview)
    print(len(names), 'pieces', sheet.size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
