// 地面（コースのまわりの起伏）。道路の近くは道路の高さに合わせて平らにし、離れるほど丘になる。
// track.js の草地（verge）の外側の端は、ここの heightFn と同じ値にしてつなぎ目を消している。
import * as THREE from 'three';
import { MAT, mulberry32 } from './textures.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 2D の値ノイズ（周期なし）
function makeNoise(seed) {
  const rnd = mulberry32(seed), P = new Uint16Array(512), R = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; R[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const h = (x, z) => R[P[(P[x & 255] + z) & 511]];
  const n = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  return (x, z, oct = 4) => { let s = 0, a = 1, t = 0, f = 1; for (let o = 0; o < oct; o++) { s += n(x * f, z * f) * a; t += a; a *= 0.5; f *= 2.03; } return s / t; };
}

// 地面の高さの関数を作る。opts: { amp: 丘の高さ [m], scale: 丘の大きさ [m], flat: 道路から平らにする距離 [m], ramp: 丘になるまでの距離 [m], seed }
export function createHeightFn(track, { amp = 14, scale = 260, flat = 10, ramp = 140, seed = 3, base = 0 } = {}) {
  const noise = makeNoise(seed);
  const far = 60 / track.ds, n = track.n;
  const cache = new Map();
  const fn = (x, z) => {
    const key = Math.round(x * 4) * 100003 + Math.round(z * 4);
    const hit = cache.get(key); if (hit !== undefined) return hit;
    const a = track.nearest(x, z, 600);
    let h;
    if (!a) h = base + amp * (noise(x / scale, z / scale) - 0.3) * 2;
    else {
      // 近くを通る別の区間とも高さをなめらかに混ぜる（区間の境で段差ができないように）
      const b = track.nearest(x, z, Math.max(60, a.dist * 3), (i) => { let di = Math.abs(i - a.i); if (track.closed) di = Math.min(di, n - di); return di < far; });
      let yr = track.py[a.i];
      if (b) { const wa = 1 / Math.max(1, a.dist), wb = 1 / Math.max(1, b.dist); yr = (track.py[a.i] * wa + track.py[b.i] * wb) / (wa + wb); }
      const half = track.half[a.i];
      const t = smooth(half + flat, half + flat + ramp, a.dist);
      h = yr - 0.12 + t * amp * (noise(x / scale, z / scale) - 0.3) * 2;
    }
    if (cache.size > 400000) cache.clear();
    cache.set(key, h);
    return h;
  };
  fn.noise = noise;
  return fn;
}

// 地面のメッシュ。道路と草地の下は少し下げて、上の帯（track.js）が見えるようにする
// opts: { margin: コースの外側に広げる距離 [m], cell: 格子の大きさ [m], material }
export function buildTerrain(track, heightFn, { margin = 520, cell = 8, material = null } = {}) {
  const b = track.bounds;
  const x0 = b.x0 - margin, x1 = b.x1 + margin, z0 = b.z0 - margin, z1 = b.z1 + margin;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  let k = 0, u = 0;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    let y = heightFn(x, z);
    const a = track.nearest(x, z, 80);
    if (a) {
      const side = a.d >= 0 ? 1 : -1, e = track.edges[side];
      const cover = e.barrierD[a.i] + e.verge[a.i];
      y -= 0.6 * (1 - smooth(cover - 4, cover - 0.5, a.dist));
    }
    pos[k++] = x; pos[k++] = y; pos[k++] = z;
    uv[u++] = x / 8; uv[u++] = z / 8;
  }
  const idx = new Uint32Array(nx * nz * 6); let q = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, bb = a + 1, c = a + nx + 1, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = bb; idx[q++] = bb; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material || MAT.grass());
  m.name = 'terrain'; m.receiveShadow = true; m.matrixAutoUpdate = false;
  m.userData.bounds = { x0, x1, z0, z1 };
  return m;
}
