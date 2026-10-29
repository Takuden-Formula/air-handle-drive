// 手続き生成のテクスチャとマテリアル（画像ファイルは使わない：オフライン・ライセンス対策）
// すべて起動後に一度だけ作ってキャッシュし、どのコースでも使い回す。
// 使い方: import { MAT, TEX, textTexture } from './textures.js'; MAT.asphalt() → MeshStandardMaterial
import * as THREE from 'three';

// ---------- 乱数・ノイズ ----------
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 周期的（タイル可能）な値ノイズの fBm。size×size の Float32Array（0〜1）を返す
export function tileNoise(size, { seed = 1, base = 4, octaves = 5, gain = 0.5 } = {}) {
  const out = new Float32Array(size * size), rnd = mulberry32(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const L = base << o;   // この段の格子の数（size を割り切る想定）
    if (L > size) break;
    const lat = new Float32Array(L * L); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const cell = size / L;
    for (let y = 0; y < size; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % L) * L, y1 = ((iy + 1) % L) * L;
      for (let x = 0; x < size; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % L, x1 = (ix + 1) % L;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * sx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// 高さ（0〜1）から法線マップを作る（周期的）
export function normalFromHeight(h, size, strength = 2) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = h[y * size + (x - 1 + size) % size], xr = h[y * size + (x + 1) % size];
    const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
    let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function canvasOf(size, fn, h = size) {
  const c = document.createElement('canvas'); c.width = size; c.height = h;
  fn(c.getContext('2d'), size, h); return c;
}
// ピクセルごとに色を決める（f(x, y, i) → [r,g,b] 0〜255）
function pixels(size, f) {
  return canvasOf(size, (g) => {
    const img = g.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, c = f(x, y, i);
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = c[3] ?? 255;
    }
    g.putImageData(img, 0, 0);
  });
}

let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = Math.max(1, Math.min(8, n)); }
function tex(canvas, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function grayCanvas(h, size, lo, hi) {
  return pixels(size, (x, y, i) => { const v = (lo + (hi - lo) * h[i]) * 255; return [v, v, v]; });
}
const lerp = (a, b, t) => a + (b - a) * t;
const cache = new Map();
function once(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

// ---------- テクスチャ ----------
export const TEX = {
  // アスファルト（6 m 四方で 1 枚）
  asphalt: () => once('asphalt', () => {
    const S = 512, n1 = tileNoise(S, { seed: 11, base: 4, octaves: 7, gain: 0.55 }), n2 = tileNoise(S, { seed: 12, base: 64, octaves: 3, gain: 0.6 });
    const rnd = mulberry32(5);
    const spk = new Float32Array(S * S); for (let i = 0; i < S * S; i++) { const r = rnd(); spk[i] = r > 0.985 ? 1 : r < 0.02 ? -1 : 0; }
    const hgt = new Float32Array(S * S);
    const map = pixels(S, (x, y, i) => {
      const v = 96 + (n1[i] - 0.5) * 30 + (n2[i] - 0.5) * 16 + spk[i] * 14;
      hgt[i] = n2[i] * 0.7 + (spk[i] > 0 ? 0.3 : 0);
      return [v * 1.01, v, v * 0.97];
    });
    const rough = pixels(S, (x, y, i) => { const v = (0.82 + (n1[i] - 0.5) * 0.2 - (spk[i] > 0 ? 0.1 : 0)) * 255; return [v, v, v]; });
    return { map: tex(map), roughnessMap: tex(rough, { srgb: false }), normalMap: tex(normalFromHeight(hgt, S, 2), { srgb: false }) };
  }),
  // 芝生（8 m 四方）
  grass: () => once('grass', () => {
    const S = 512, n1 = tileNoise(S, { seed: 21, base: 4, octaves: 6, gain: 0.55 }), n2 = tileNoise(S, { seed: 22, base: 128, octaves: 2 });
    const map = pixels(S, (x, y, i) => {
      const a = n1[i], b = n2[i];
      return [lerp(62, 98, a) * (0.85 + b * 0.3), lerp(86, 122, a) * (0.85 + b * 0.3), lerp(44, 60, a)];
    });
    const h = new Float32Array(S * S); for (let i = 0; i < h.length; i++) h[i] = n2[i] * 0.8 + n1[i] * 0.2;
    return { map: tex(map), normalMap: tex(normalFromHeight(h, S, 2.5), { srgb: false }) };
  }),
  // 砂利（グラベル）
  gravel: () => once('gravel', () => {
    const S = 512, n1 = tileNoise(S, { seed: 31, base: 8, octaves: 5 }), st = tileNoise(S, { seed: 32, base: 128, octaves: 2, gain: 0.4 });
    const map = pixels(S, (x, y, i) => { const s = st[i] > 0.55 ? 1.12 : st[i] < 0.42 ? 0.86 : 1; const a = n1[i]; return [lerp(170, 214, a) * s, lerp(150, 192, a) * s, lerp(116, 150, a) * s]; });
    const h = new Float32Array(S * S); for (let i = 0; i < h.length; i++) h[i] = st[i];
    return { map: tex(map), normalMap: tex(normalFromHeight(h, S, 5), { srgb: false }) };
  }),
  // 砂
  sand: () => once('sand', () => {
    const S = 256, n1 = tileNoise(S, { seed: 41, base: 4, octaves: 6 });
    const map = pixels(S, (x, y, i) => { const a = n1[i]; return [lerp(196, 226, a), lerp(176, 204, a), lerp(132, 160, a)]; });
    return { map: tex(map), normalMap: tex(normalFromHeight(n1, S, 1.5), { srgb: false }) };
  }),
  // コンクリート（目地つき。4 m 四方）
  concrete: () => once('concrete', () => {
    const S = 512, n1 = tileNoise(S, { seed: 51, base: 4, octaves: 7, gain: 0.5 }), n2 = tileNoise(S, { seed: 52, base: 64, octaves: 3 });
    const map = pixels(S, (x, y, i) => {
      let v = 160 + (n1[i] - 0.5) * 40 + (n2[i] - 0.5) * 18;
      if (x < 3 || y < 3) v *= 0.72;   // 目地
      return [v, v * 0.99, v * 0.96];
    });
    const h = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = n2[y * S + x] * 0.5 - ((x < 3 || y < 3) ? 0.5 : 0);
    return { map: tex(map), normalMap: tex(normalFromHeight(h, S, 2), { srgb: false }) };
  }),
  // 縁石（紅白。v 方向 1 周期 = 2 区画）
  kerb: (c1 = '#d42a24', c2 = '#f4f4f0') => once('kerb' + c1 + c2, () => {
    const c = canvasOf(64, (g, w, h) => {
      g.fillStyle = c1; g.fillRect(0, 0, w, h / 2); g.fillStyle = c2; g.fillRect(0, h / 2, w, h / 2);
      const rnd = mulberry32(3);
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(40,40,40,${rnd() * 0.12})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 1 + rnd() * 2); }
    }, 256);
    return tex(c);
  }),
  // タイヤバリア（タイヤを積んだ壁を横から見た図。u = 長さ 4 m で 1 枚、v = 高さ）
  tires: () => once('tires', () => {
    const c = canvasOf(512, (g, w, h) => {
      g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
      const r = w / 16;
      for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
        const x = (i + (row % 2) * 0.5) * (w / 8), y = h - (row + 0.5) * (h / 4);
        const gr = g.createRadialGradient(x, y, r * 0.3, x, y, r * 1.05);
        gr.addColorStop(0, '#060606'); gr.addColorStop(0.45, '#0c0c0c'); gr.addColorStop(0.55, '#2a2a2a'); gr.addColorStop(0.9, '#1b1b1b'); gr.addColorStop(1, '#050505');
        g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.02, h / 8 * 0.98, 0, 0, Math.PI * 2); g.fill();
      }
      // 紅白のベルト（コンベアベルト）
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#d32f2f'; g.fillRect(i * w / 4, h * 0.38, w / 4, h * 0.2); }
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, h * 0.56, w, 4);
    }, 256);
    return tex(c);
  }),
  // 金網（キャッチフェンス）。アルファ付き
  fence: () => once('fence', () => {
    const c = canvasOf(128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(200,205,210,1)'; g.lineWidth = 2.2;
      for (let k = -w; k < w * 2; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
    });
    const t = tex(c); return t;
  }),
  // 観客（スタンドの客席に貼る。u = 12 m, v = 4 段）
  crowd: () => once('crowd', () => {
    const rnd = mulberry32(77);
    const c = canvasOf(1024, (g, w, h) => {
      g.fillStyle = '#5b636c'; g.fillRect(0, 0, w, h);
      const rows = 4, rh = h / rows;
      const cols = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fafafa', '#8e24aa', '#fb8c00', '#263238', '#90caf9', '#f06292', '#00acc1'];
      for (let r = 0; r < rows; r++) {
        const y0 = r * rh;
        g.fillStyle = '#7b848e'; g.fillRect(0, y0 + rh * 0.82, w, rh * 0.18);   // 段
        for (let x = 4; x < w - 4; x += 14 + rnd() * 6) {
          if (rnd() < 0.1) continue;
          const bw = 11 + rnd() * 3, by = y0 + rh * (0.36 + rnd() * 0.08);
          g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.beginPath(); g.roundRect(x, by, bw, rh * 0.5, 4); g.fill();
          g.fillStyle = ['#f1c9a5', '#e0b48a', '#c99067', '#8d5a3b'][Math.floor(rnd() * 4)];
          g.beginPath(); g.arc(x + bw / 2, by - 4, 6.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = rnd() < 0.7 ? '#2b2018' : '#6b4b2b'; g.beginPath(); g.arc(x + bw / 2, by - 6, 6.5, Math.PI, 0); g.fill();
          if (rnd() < 0.08) { g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(x - 2, by - 22, 16, 10); }   // 旗・タオル
        }
      }
    }, 256);
    return tex(c);
  }),
  // ビルの窓（u = 1 区画 4 m、v = 1 階 3.5 m を 8×8 で 1 枚）。emissive 用の夜の明かりも作る
  windows: (style = 0) => once('win' + style, () => {
    const rnd = mulberry32(100 + style);
    const S = 512, n = 8, cw = S / n;
    const pal = [['#c9ced6', '#6d7f93', '#273444'], ['#d8cbb6', '#7b8a97', '#2b3a48'], ['#a8b6c4', '#4f6a85', '#1c2a3a'], ['#e3e3e0', '#8b9aa8', '#33404d']][style % 4];
    const lit = [];
    const map = canvasOf(S, (g) => {
      g.fillStyle = pal[0]; g.fillRect(0, 0, S, S);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const gx = x * cw, gy = y * cw;
        const gr = g.createLinearGradient(gx, gy, gx + cw, gy + cw);
        gr.addColorStop(0, pal[1]); gr.addColorStop(1, pal[2]);
        g.fillStyle = gr; g.fillRect(gx + cw * 0.1, gy + cw * 0.18, cw * 0.8, cw * 0.62);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(gx + cw * 0.1, gy + cw * 0.18, cw * 0.8, 3);
        lit.push(rnd() < 0.45 ? 0.4 + rnd() * 0.6 : 0);
      }
    });
    const em = canvasOf(S, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      let k = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const v = lit[k++]; if (!v) continue;
        const warm = rnd() < 0.7;
        g.fillStyle = warm ? `rgba(255,${190 + rnd() * 40 | 0},${120 + rnd() * 50 | 0},${v})` : `rgba(${190 + rnd() * 40 | 0},220,255,${v})`;
        g.fillRect(x * cw + cw * 0.1, y * cw + cw * 0.18, cw * 0.8, cw * 0.62);
      }
    });
    return { map: tex(map), emissiveMap: tex(em) };
  }),
  // 丸いぼかし（パーティクル・光の玉）
  softDot: () => once('softDot', () => {
    const c = canvasOf(64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    return tex(c, { repeat: false });
  }),
  // 煙・砂ぼこり（もこもこ）
  smoke: () => once('smoke', () => {
    const S = 128, n = tileNoise(S, { seed: 91, base: 4, octaves: 5 });
    const c = pixels(S, (x, y, i) => {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.hypot(dx, dy);
      const a = Math.max(0, 1 - r) ** 1.4 * (0.55 + n[i] * 0.9);
      return [255, 255, 255, Math.min(255, a * 255)];
    });
    return tex(c, { repeat: false });
  }),
  // 地面に落ちる丸い影（木や人の足もと）
  blobShadow: () => once('blob', () => {
    const c = canvasOf(64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    return tex(c, { repeat: false });
  }),
};

// 文字の看板テクスチャ（広告・標識）。lines: [{text, size(0〜1 高さに対する割合), color, weight, y(0〜1)}]
export function textTexture({ w = 1024, h = 256, bg = '#1565c0', bg2 = null, border = null, lines = [], font = '"Meiryo","Yu Gothic UI","Hiragino Sans",sans-serif', draw = null } = {}) {
  const key = 'txt' + JSON.stringify([w, h, bg, bg2, border, lines, !!draw]);
  if (!draw && cache.has(key)) return cache.get(key);
  const c = canvasOf(w, (g) => {
    if (bg2) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, bg); gr.addColorStop(1, bg2); g.fillStyle = gr; }
    else g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = h * 0.06; g.strokeRect(0, 0, w, h); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const L of lines) {
      g.fillStyle = L.color || '#fff';
      g.font = `${L.weight || 900} ${Math.round((L.size || 0.6) * h)}px ${font}`;
      const x = (L.x ?? 0.5) * w, y = (L.y ?? 0.5) * h;
      g.fillText(L.text, x, y, w * 0.94);
    }
    if (draw) draw(g, w, h);
  }, h);
  const t = tex(c, { repeat: false });
  if (!draw) cache.set(key, t);
  return t;
}

// ---------- マテリアル ----------
// 地面などの「タイルの繰り返し」が目立たないよう、ワールド座標の大きなむらを色に掛ける
export function addMacroVariation(mat, { scale = 0.02, amount = 0.25, scale2 = 0.11, amount2 = 0.1 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: new THREE.Vector4(scale, amount, scale2, amount2) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMacroPos; uniform vec4 uMacro;
float mhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mhash(i), mhash(i+vec2(1,0)), f.x), mix(mhash(i+vec2(0,1)), mhash(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ float m1 = mnoise(vMacroPos.xz * uMacro.x) * 0.65 + mnoise(vMacroPos.xz * uMacro.x * 2.7) * 0.35;
  float m2 = mnoise(vMacroPos.xz * uMacro.z);
  diffuseColor.rgb *= (1.0 + (m1 - 0.5) * 2.0 * uMacro.y) * (1.0 + (m2 - 0.5) * 2.0 * uMacro.w); }`);
  };
  mat.customProgramCacheKey = () => 'macro' + scale + amount + scale2 + amount2;
  return mat;
}

const std = (o) => new THREE.MeshStandardMaterial(o);
export const MAT = {
  asphalt: () => once('m-asphalt', () => { const t = TEX.asphalt(); return addMacroVariation(std({ name: 'asphalt', map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, metalness: 0, envMapIntensity: 0.6 }), { scale: 0.03, amount: 0.1, scale2: 0.25, amount2: 0.05 }); }),
  grass: () => once('m-grass', () => { const t = TEX.grass(); return addMacroVariation(std({ name: 'grass', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, metalness: 0 }), { scale: 0.012, amount: 0.22, scale2: 0.07, amount2: 0.12 }); }),
  gravel: () => once('m-gravel', () => { const t = TEX.gravel(); return addMacroVariation(std({ name: 'gravel', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: 0.95 }), { scale: 0.05, amount: 0.1 }); }),
  sand: () => once('m-sand', () => { const t = TEX.sand(); return std({ name: 'sand', map: t.map, normalMap: t.normalMap, roughness: 0.95 }); }),
  concrete: () => once('m-concrete', () => { const t = TEX.concrete(); return addMacroVariation(std({ name: 'concrete', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.85 }), { scale: 0.05, amount: 0.1 }); }),
  kerb: () => once('m-kerb', () => std({ name: 'kerb', map: TEX.kerb(), roughness: 0.6, metalness: 0 })),
  line: () => once('m-line', () => std({ name: 'line', color: 0xf2f2ee, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  lineYellow: () => once('m-lineY', () => std({ name: 'lineY', color: 0xf2b705, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  armco: () => once('m-armco', () => std({ name: 'armco', color: 0xb8bec6, roughness: 0.32, metalness: 0.85 })),
  steel: () => once('m-steel', () => std({ name: 'steel', color: 0x8a9098, roughness: 0.45, metalness: 0.8 })),
  darkSteel: () => once('m-dsteel', () => std({ name: 'dsteel', color: 0x3a3f46, roughness: 0.5, metalness: 0.7 })),
  tires: () => once('m-tires', () => std({ name: 'tires', map: TEX.tires(), roughness: 0.85 })),
  fence: () => once('m-fence', () => std({ name: 'fence', map: TEX.fence(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 })),
  white: () => once('m-white', () => std({ name: 'white', color: 0xf0f0ec, roughness: 0.6 })),
  black: () => once('m-black', () => std({ name: 'black', color: 0x16181b, roughness: 0.7 })),
  crowd: () => once('m-crowd', () => std({ name: 'crowd', map: TEX.crowd(), roughness: 0.9 })),
  blobShadow: () => once('m-blob', () => new THREE.MeshBasicMaterial({ name: 'blob', map: TEX.blobShadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })),
  // 色だけのマテリアル（同じ色はキャッシュ）
  color: (hex, { rough = 0.7, metal = 0, emissive = 0, emissiveIntensity = 1 } = {}) => once(`c${hex}_${rough}_${metal}_${emissive}_${emissiveIntensity}`, () => std({ color: hex, roughness: rough, metalness: metal, emissive, emissiveIntensity })),
  // 光る物（ランプ・ネオン）。ブルームで光って見える
  glow: (hex, intensity = 3) => once(`g${hex}_${intensity}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), toneMapped: true })),
};
