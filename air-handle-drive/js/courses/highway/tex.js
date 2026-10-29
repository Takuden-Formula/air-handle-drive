// 高速道路コースだけで使う手続き生成のテクスチャと材質（画像ファイルは使わない）。すべてキャッシュして使い回す。
import * as THREE from 'three';
import { mulberry32, tileNoise, normalFromHeight, addMacroVariation } from '../../engine/textures.js';

const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
function canvas(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; }
function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// 共通のノイズ（256 × 256。どのテクスチャも使い回す）
const N256 = () => once('n256', () => tileNoise(256, { seed: 301, base: 8, octaves: 5 }));
export const FONT = '"Meiryo","Yu Gothic UI","Hiragino Sans","Noto Sans CJK JP",sans-serif';

export const HTEX = {
  // 防音壁の板（金属のリブ。u = 4 m、v = 4 m で 1 枚）。下ほど汚れる
  soundWall: () => once('sw', () => {
    const S = 256, n = N256();
    const c = canvas(S, S, (g) => {
      const img = g.createImageData(S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const rib = (x % 16) < 2 ? 0.82 : (x % 16) < 4 ? 1.06 : 1;           // 縦のリブ
        const joint = (y % 64) < 2 ? 0.72 : 1;                               // 板の継ぎ目（1 m ごと）
        const post = x < 6 || x > S - 6 ? 0.55 : 1;                          // H 形鋼の柱（4 m ごと）
        const dirt = 0.82 + 0.18 * (1 - Math.pow(y / S, 3)) ;                // 下ほど汚れる（v は上が 0）
        const v = (178 + (n[i] - 0.5) * 34) * rib * joint * post * dirt;
        d[i * 4] = v * 0.96; d[i * 4 + 1] = v * 0.99; d[i * 4 + 2] = v * 0.94; d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = ((x % 16) < 2 ? 0 : (x % 16) < 4 ? 1 : 0.6) * ((y % 64) < 2 ? 0.2 : 1);
    return { map: tex(c), normalMap: tex(normalFromHeight(h, S, 3), { srgb: false }) };
  }),
  // トンネルの内側（光らない材質に焼き込んだ照明）。u = 長さ 8 m、v = 断面の位置（0 = 左の床 → 1 = 右の床）
  tunnelLining: () => once('tl', () => {
    // キャンバスの読み戻し（getImageData）は遅いので、画素を JS で計算して一度に書く
    const W = 256, H = 512, n = N256();
    const c = canvas(W, H, (g) => {
      const img = g.createImageData(W, H), d = img.data;
      for (let y = 0; y < H; y++) {
        const v = y / H, f = Math.min(v, 1 - v);            // f = 床からの距離（0〜0.5。0.5 = 天井）
        let r, gg, b;
        if (f < 0.035) { r = 70; gg = 58; b = 44; }                                                        // 監査歩廊の縁石
        else if (f < 0.2) { const k = 1 - (f - 0.035) / 0.165 * 0.25; r = 232 * k; gg = 190 * k; b = 128 * k; }   // 白い内装板（ナトリウム灯で橙）
        else if (f < 0.215) { r = 120; gg = 92; b = 60; }                                                  // 内装板の上の縁
        else { const k = Math.max(0.18, 0.62 - (f - 0.215) * 1.5); r = 150 * k; gg = 112 * k; b = 78 * k; }   // コンクリートの天井
        const panelJoint = (f >= 0.035 && f < 0.2) && (Math.abs(f - 0.09) < 0.002 || Math.abs(f - 0.145) < 0.002);
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          let k = 0.88 + n[(y % 256) * 256 + x] * 0.24;
          if (panelJoint || ((f >= 0.035 && f < 0.2) && (x % (W / 8)) < 2)) k *= 0.62;   // 内装板の目地
          if (f >= 0.215 && x < 3) k *= 0.75;                                               // 打継ぎ
          d[i] = r * k; d[i + 1] = gg * k; d[i + 2] = b * k; d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    });
    return tex(c);
  }),
  // トンネル内の路面（光らない材質。照明で橙に照らされたアスファルト・白線）。u = 横（左の壁 → 右の壁）、v = 長さ 20 m
  tunnelRoad: (wL, wR) => once('tr' + wL + wR, () => {
    const W = 256, H = 512, n = N256();
    const span = wL + wR;   // 左の壁から右の壁まで [m]
    const px = (d) => (d + wL) / span * W;   // d [m] → x
    const c = canvas(W, H, (g) => {
      const img = g.createImageData(W, H), dd = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, d = x / W * span - wL;
        // 照明の光だまり（4 m ごと = 5 個 / 20 m）・タイヤの通り道は少し暗い
        const pool = 0.78 + 0.22 * Math.pow(Math.cos((y / H) * Math.PI * 10) * 0.5 + 0.5, 2);
        let lane = 1;
        for (const c0 of [-3.5, 0, 3.5]) for (const t of [-0.8, 0.8]) { const q = Math.abs(d - c0 - t); if (q < 0.35) lane *= 0.9 + q * 0.28; }
        const side = Math.min(1, 0.7 + 0.3 * Math.min(Math.abs(d + wL), Math.abs(d - wR)) / 2);
        const v = (96 + (n[(y % 256) * 256 + x] - 0.5) * 34) * pool * lane * side;
        dd[i * 4] = v * 1.18; dd[i * 4 + 1] = v * 0.94; dd[i * 4 + 2] = v * 0.7; dd[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      // 白線（車線の境界は破線 8 m / 12 m、外側は実線）
      g.fillStyle = 'rgb(236,206,150)';
      for (const d of [-5.1, 5.1]) g.fillRect(px(d) - 0.1 / span * W, 0, 0.2 / span * W, H);
      for (const d of [-1.75, 1.75]) g.fillRect(px(d) - 0.075 / span * W, H * 12 / 20, 0.15 / span * W, H * 8 / 20);   // 画像の上 = v の 1 側
    });
    return tex(c);
  }),
  // 法面の法枠（コンクリートの格子＋草）。2.5 m 四方で 1 枚
  slopeFrame: () => once('sf', () => {
    const S = 256, n = N256();
    const c = canvas(S, S, (g) => {
      const img = g.createImageData(S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x, beam = x < 22 || y < 22;
        const k = n[i];
        let r, gg, b;
        if (beam) { const v = 150 + (k - 0.5) * 40; r = v; gg = v * 0.98; b = v * 0.93; if (x < 3 || y < 3) { r *= 0.7; gg *= 0.7; b *= 0.7; } }
        else { r = 70 + k * 40; gg = 92 + k * 46; b = 44 + k * 20; }
        d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
    const h = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = (x < 22 || y < 22) ? 1 : n[y * S + x] * 0.4;
    return { map: tex(c), normalMap: tex(normalFromHeight(h, S, 4), { srgb: false }) };
  }),
  // 窓の明かりのついたビルの壁（夕方）。u = 横 1 区画 3.2 m を 8 区画、v = 1 階 3.4 m を 8 階で 1 枚
  facade: (style) => once('fac' + style, () => {
    const rnd = mulberry32(700 + style);
    const S = 512, n = 8, cw = S / n;
    const pal = [
      ['#c9c4bb', '#59636d', '#2a3038'], ['#b9b2a6', '#5d6a75', '#262e36'], ['#d6d3cc', '#3e4a55', '#1f262d'],
      ['#8e8a84', '#4f5964', '#1c2228'], ['#c7b9a3', '#66717a', '#2b3238'], ['#a9b2ba', '#48607a', '#1a2533'],
    ][style % 6];
    const lit = [];
    const glassy = style === 5;
    const map = canvas(S, S, (g) => {
      g.fillStyle = pal[0]; g.fillRect(0, 0, S, S);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gx = x * cw, gy = y * cw;
        const gr = g.createLinearGradient(gx, gy, gx, gy + cw);
        gr.addColorStop(0, pal[1]); gr.addColorStop(1, pal[2]);
        g.fillStyle = gr;
        if (glassy) g.fillRect(gx + 1, gy + cw * 0.08, cw - 2, cw * 0.84);
        else if (style % 2) g.fillRect(gx + cw * 0.12, gy + cw * 0.22, cw * 0.76, cw * 0.52);
        else g.fillRect(gx + cw * 0.06, gy + cw * 0.18, cw * 0.88, cw * 0.58);
        lit.push(rnd() < 0.34 ? 0.3 + rnd() * 0.6 : 0);
      }
      // 汚れ（雨だれ）
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(30,30,30,${rnd() * 0.08})`; g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 20 + rnd() * 80); }
    });
    const em = canvas(S, S, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      let k = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const v = lit[k++]; if (!v) continue;
        const r = rnd();
        g.fillStyle = r < 0.55 ? `rgba(255,${196 + rnd() * 24 | 0},${132 + rnd() * 36 | 0},${v})` : r < 0.92 ? `rgba(214,228,240,${v * 0.75})` : `rgba(255,170,100,${v})`;
        const gx = x * cw, gy = y * cw;
        if (glassy) g.fillRect(gx + 1, gy + cw * 0.08, cw - 2, cw * 0.84);
        else if (style % 2) g.fillRect(gx + cw * 0.12, gy + cw * 0.22, cw * 0.76, cw * 0.52);
        else g.fillRect(gx + cw * 0.06, gy + cw * 0.18, cw * 0.88, cw * 0.58);
        // ブラインド
        if (rnd() < 0.4) { g.fillStyle = 'rgba(0,0,0,.35)'; for (let b = 0; b < 4; b++) g.fillRect(gx + cw * 0.08, gy + cw * (0.25 + b * 0.12), cw * 0.84, 2); }
      }
    });
    return { map: tex(map), emissiveMap: tex(em) };
  }),
};

// 光る物の色（頂点カラー用。線形の色 × 強さ）
export function glowRGB(hex, k = 1) { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; }

// 材質（キャッシュ）
export const HMAT = {
  // 光る物（ランプ・表示灯）。色と明るさは頂点カラーで持つ（いろいろな色のランプを 1 回で描く）
  glow: () => once('m-glow', () => new THREE.MeshBasicMaterial({ name: 'hw-glow', vertexColors: true, toneMapped: true })),
  soundWall: () => once('m-sw', () => { const t = HTEX.soundWall(); return addMacroVariation(new THREE.MeshStandardMaterial({ name: 'hw-soundwall', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.55, metalness: 0.35, color: 0xdfe4dc }), { scale: 0.03, amount: 0.12 }); }),
  // 透明な防音板（高架）
  clearPanel: () => once('m-cp', () => new THREE.MeshStandardMaterial({ name: 'hw-clear', color: 0x9fb8c4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 })),
  tunnelLining: () => once('m-tl', () => new THREE.MeshBasicMaterial({ name: 'hw-tunnel', map: HTEX.tunnelLining(), side: THREE.BackSide })),
  tunnelRoad: (wL, wR) => once('m-tr' + wL + wR, () => new THREE.MeshBasicMaterial({ name: 'hw-troad', map: HTEX.tunnelRoad(wL, wR), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })),
  slopeFrame: () => once('m-sf', () => { const t = HTEX.slopeFrame(); return addMacroVariation(new THREE.MeshStandardMaterial({ name: 'hw-slope', map: t.map, normalMap: t.normalMap, roughness: 0.92 }), { scale: 0.03, amount: 0.15 }); }),
  facade: (style) => once('m-fac' + style, () => { const t = HTEX.facade(style); return new THREE.MeshStandardMaterial({ name: 'hw-facade' + style, map: t.map, emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: style === 5 ? 0.18 : 0.62, metalness: style === 5 ? 0.6 : 0.05 }); }),
};
