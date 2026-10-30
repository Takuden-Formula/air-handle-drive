import numpy as np
from PIL import Image, ImageDraw
rng = np.random.default_rng(7)
OUT = r'C:\w\repo\air-handle-drive\assets'

def fnoise(h, w, sigma, seed=None):
    """周期的（タイル状に繋がる）ガウスぼかしノイズ。平均0・標準偏差1"""
    r = np.random.default_rng(seed)
    n = r.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None]; fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * g))
    return (out - out.mean()) / (out.std() + 1e-9)

def save(a, name):
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'L' if a.ndim == 2 else 'RGB').save(f'{OUT}\\{name}', optimize=True)

# ---------------- アスファルト（道路の幅 -1〜1 を横 1024、前後 3000 を縦 1024）----------------
H = W = 1024
a = np.full((H, W), 0.5)
a += 0.09 * fnoise(H, W, 0.7, 1)     # 細かい骨材の粒
a += 0.05 * fnoise(H, W, 2.2, 2)
a += 0.05 * fnoise(H, W, 9, 3)
a += 0.06 * fnoise(H, W, 45, 4)      # 大きなむら
xs = (np.arange(W) / W * 2 - 1)[None, :]; ys = (np.arange(H) / H)[:, None]
# タイヤの通り道（3 車線 × 2 本）：暗くなり、粒がつぶれて滑らかになる
trk = np.zeros((1, W))
for i in range(3):
    c = -1 + (2 * i + 1) / 3
    for d in (-0.1, 0.1): trk += np.exp(-((xs - (c + d)) / 0.035) ** 2)
trk = np.clip(trk, 0, 1) * (0.75 + 0.25 * fnoise(H, 1, 30, 5))
a -= 0.10 * trk
a = a * (1 - 0.45 * trk) + 0.42 * 0.45 * trk + 0.0   # 通り道は粒のコントラストを下げる
# 車線の間の中央に、ゴムが乗った黒い走行ライン
a -= 0.05 * np.exp(-((xs - 0.0) / 0.25) ** 2) * (0.6 + 0.4 * fnoise(H, 1, 60, 6))
# 道路の端は砂・ほこりで明るく粗い
edge = np.clip((np.abs(xs) - 0.88) / 0.12, 0, 1)
a += edge * (0.06 + 0.05 * fnoise(H, W, 1.5, 7))
# 補修パッチ・オイル染み・ひび
img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L'); d = ImageDraw.Draw(img, 'L')
for _ in range(7):   # パッチ（四角く色が違う）
    x0 = rng.integers(0, W - 300); y0 = rng.integers(0, H - 120); w = rng.integers(180, 700); h = rng.integers(40, 120)
    v = int(rng.choice([-22, 18]))
    box = img.crop((x0, y0, min(W, x0 + w), y0 + h)).point(lambda p, v=v: max(0, min(255, p + v)))
    img.paste(box, (x0, y0))
a = np.asarray(img).astype(float) / 255
for _ in range(10):   # オイル染み
    cx, cy = rng.integers(0, W), rng.integers(0, H); r = rng.integers(14, 38)
    yy, xx = np.ogrid[:H, :W]
    dx = np.minimum(abs(xx - cx), W - abs(xx - cx)); dy = np.minimum(abs(yy - cy), H - abs(yy - cy))
    m = np.exp(-((dx / (r * 0.7)) ** 2 + (dy / r) ** 2)); a -= 0.12 * m * (0.6 + 0.4 * fnoise(H, W, 3, 20 + _))
img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L'); d = ImageDraw.Draw(img, 'L')
for _ in range(14):   # ひび（折れ線。端をまたぐものは両側に描く）
    x, y = rng.integers(0, W), rng.integers(0, H); pts = [(x, y)]
    ang = rng.uniform(0, 6.28); L = rng.integers(60, 260)
    for k in range(int(L / 9)):
        ang += rng.normal(0, 0.45); x += np.cos(ang) * 9; y += np.sin(ang) * 9; pts.append((x, y))
    for ox in (-W, 0, W):
        for oy in (-H, 0, H):
            d.line([(px + ox, py + oy) for px, py in pts], fill=int(rng.integers(40, 80)), width=int(rng.choice([1, 1, 2])))
for k in range(2):   # 継ぎ目（横線）
    y = int(H * (k + 0.5) / 2); d.line([(0, y), (W, y)], fill=50, width=2)
a = np.asarray(img).astype(float) / 255
a = (a - a.mean()) * 0.62 + 0.5
save(a, 'tex_road.png')

# ---------------- 芝 ----------------
H = W = 512
g = 0.5 + 0.12 * fnoise(H, W, 0.8, 11) + 0.07 * fnoise(H, W, 3, 12) + 0.07 * fnoise(H, W, 14, 13) + 0.05 * fnoise(H, W, 60, 14)
# 刈り跡の縞（縦方向に周期的）
g += 0.025 * np.sin(np.arange(H)[:, None] / H * 2 * np.pi * 6)
# 細い葉先の筋（縦に長いノイズ）
blades = fnoise(H, W, 0.6, 15)
blades2 = np.real(np.fft.ifft2(np.fft.fft2(blades) * np.exp(-2 * (np.pi) ** 2 * ((np.fft.fftfreq(W)[None, :] * 0.8) ** 2 + (np.fft.fftfreq(H)[:, None] * 7) ** 2))))
g += 0.09 * (blades2 - blades2.mean()) / (blades2.std() + 1e-9)
g = (g - g.mean()) * 0.55 + 0.5
save(g, 'tex_grass.png')

# ---------------- 舗装（市街地の歩道・路肩）：石のタイル ----------------
H = W = 512
p = 0.5 + 0.05 * fnoise(H, W, 0.8, 31) + 0.05 * fnoise(H, W, 6, 32) + 0.04 * fnoise(H, W, 40, 33)
n = 4; step = H // n
tile_tone = rng.normal(0, 0.035, (n, n))
for i in range(n):
    for j in range(n): p[i * step:(i + 1) * step, j * step:(j + 1) * step] += tile_tone[i, j]
for k in range(n):   # 目地
    p[k * step:k * step + 3, :] -= 0.22; p[:, k * step:k * step + 3] -= 0.22
    p[k * step + 3:k * step + 5, :] += 0.04; p[:, k * step + 3:k * step + 5] += 0.04
p = (p - p.mean()) * 0.9 + 0.5
save(p, 'tex_pave.png')
print('ok')
