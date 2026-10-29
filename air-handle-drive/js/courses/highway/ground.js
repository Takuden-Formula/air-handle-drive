// 高速道路コースの地面（自前）。道路の近くは道路の高さ（盛土・切土）、高架と橋の下は元の地面、トンネルの上は山。
// 地面の起伏（町の平地・トンネルの山・谷・川・山地）はコースの中心線の位置から決める。
import * as THREE from 'three';
import { TEX, addMacroVariation } from '../../engine/textures.js';
import { SEC, wallL, oppEdges, fillWeight, BASE, FAR_Y } from './layout.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 区分的になめらかな関数（[[s, 値], ...]）。track.js の profile と同じ考え（ここは単純な smoothstep 補間）
function profileFn(keys) {
  return (s) => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (s <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i], u = (s - a) / (b - a); return va + (vb - va) * u * u * (3 - 2 * u); }
    return keys[keys.length - 1][1];
  };
}

// 2D の値ノイズ（fBm）
export function makeNoise(seed) {
  let a = seed | 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const P = new Uint16Array(512), R = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; R[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const h = (x, z) => R[P[(P[x & 255] + z) & 511]];
  const n = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const A = h(ix, iz), B = h(ix + 1, iz), C = h(ix, iz + 1), D = h(ix + 1, iz + 1);
    return A + (B - A) * sx + (C - A) * sz + (A - B - C + D) * sx * sz;
  };
  return (x, z, oct = 4) => { let s = 0, am = 1, t = 0, f = 1; for (let o = 0; o < oct; o++) { s += n(x * f, z * f) * am; t += am; am *= 0.5; f *= 2.03; } return s / t; };
}

// 谷の小川（中心線の距離 s と、谷底の高さ）
export const VALLEY_S = 1340, VALLEY_FLOOR = BASE - 27;

// 地面の高さの関数を作る。戻り値 { base(x, z): 元の地面, height(x, z): 道路に合わせた地面, near(x, z): 道路からの位置, features }
export function makeGround(track, rnd) {
  const noise = makeNoise(4242);
  const P = (s) => track.toWorld(s, 0, 0);
  const H = (s) => track.headingAt(s);
  // ---- 地形はコースに沿った「高さの表」で決める（道路の近くの自然な地面の高さ [m]、絶対値）----
  //   料金所・町は平地（0 m）、トンネルの山は 45〜62 m、谷は -28 m、その先は山あい（25〜40 m）
  const Habs = profileFn([[0, 0], [300, 0.4], [SEC.embank0, 0], [SEC.bridge1 - 30, 0], [SEC.bridge1 + 5, 6], [SEC.tunnel0 - 40, 26],
    [SEC.tunnel0, 44], [1065, 60], [SEC.tunnel1, 42], [SEC.tunnel1 + 45, 28], [SEC.valley0, 9], [SEC.valley0 + 40, -16], [1340, -27],
    [SEC.valley1 - 40, -16], [SEC.valley1, 9], [SEC.valley1 + 50, 13], [1600, 10], [1760, 8], [1900, 10], [2050, 8], [2300, 7]]);
  // 山の斜面を横切る区間（谷の橋の先）：左（山側）が高く、右（谷側）が低い
  const sideK = profileFn([[0, 0], [SEC.valley1 + 10, 0], [SEC.valley1 + 70, 1], [2400, 1]]);
  // 道から離れると山が高くなる度合い（山あいの区間だけ）
  const mountainK = profileFn([[0, 0], [SEC.bridge1, 0], [SEC.tunnel0, 1], [SEC.tunnel1, 1], [SEC.valley0, 0.4], [SEC.valley1, 0.4], [SEC.valley1 + 60, 1], [2400, 1]]);
  // 遠くの地形（コースから 400 m 以上）：ゆるい丘
  const far = (x, z) => 6 + 34 * Math.pow(noise(x / 520 + 3, z / 520 - 2), 1.5) * 1.6 + (noise(x / 140, z / 140, 3) - 0.5) * 8;
  // 川（高架の下）：町を横切る川
  const pR = P(SEC.river), hR = H(SEC.river);
  const river = { x: pR.x, z: pR.z, tx: Math.cos(hR - 0.35), tz: Math.sin(hR - 0.35), w: 15, bank: 9, depth: 3.2 };
  // 町（高架のまわり）
  const town = { s0: SEC.embank0 - 60, s1: SEC.bridge1 + 40 };
  const valley = { s: (SEC.valley0 + SEC.valley1) / 2 };
  const hills = [];

  // 直線（点 + 向き）に沿った距離
  const along = (f, x, z) => (x - f.x) * f.tx + (z - f.z) * f.tz;

  // 道路からの位置（地面の計算用）。null = 遠い
  const near = (x, z) => track.nearest(x, z, 600);

  // 元の地面（道路がないときの高さ）。nr: その点の道路からの位置（省略で求める）
  const base = (x, z, nr = undefined) => {
    if (nr === undefined) nr = near(x, z);
    let y;
    const fy = BASE + far(x, z);
    if (!nr) y = fy;
    else {
      const s = nr.s, ad = Math.abs(nr.d);
      const mk = mountainK(s);
      const sk = sideK(s);
      let ny = BASE + Habs(s) + (noise(x / 160, z / 160, 3) - 0.5) * (2 + 14 * mk);
      // 斜面を横切る区間：左が上り・右が下り
      if (sk > 0) ny += sk * Math.max(-34, Math.min(46, -nr.d * 0.42));
      // 山あい：道から離れるほど高い尾根（ノイズで起伏）。斜面の区間は山側だけ
      ny += mk * (nr.d < 0 ? 1 : 1 - sk) * sstep(40, 220, ad) * (10 + 38 * noise(x / 210 - 5, z / 210 + 9, 3));
      // 町・料金所のあたり：遠くはゆるい丘に
      const w = sstep(330, 600, nr.dist);
      y = ny * (1 - w) + fy * w;
      // 谷の底の小川（谷の橋の真下を横切る）
      const vs = Math.abs(s - VALLEY_S);
      if (vs < 22 && nr.dist < 520) { const k = 1 - sstep(7, 22, vs); y = y * (1 - k) + Math.min(y, VALLEY_FLOOR - 3.2) * k; }
    }
    // 川
    {
      const a = along(river, x, z), off = Math.sin(a / 160) * 22;
      const p = Math.abs((x - river.x) * river.tz - (z - river.z) * river.tx + off);
      if (p < river.w + river.bank) {
        const k = p < river.w ? 1 : 1 - sstep(river.w, river.w + river.bank, p);
        y = y * (1 - k) + (BASE - river.depth) * k;
      }
    }
    return y;
  };

  // 道路に合わせた地面
  const CELL = 10;
  const height = (x, z, nr = near(x, z)) => {
    const B = base(x, z, nr);
    if (!nr) return B;
    const s = nr.s, d = nr.d, ad = Math.abs(d);
    const w = fillWeight(s);
    if (w <= 0 || ad > 260) return B;
    const R = track.heightAt(s, 0);
    // 道路の脇の平らな帯の端（左は防音壁の外、右は反対車線の外）＋ 1.5 マスぶん
    const e = (d < 0 ? wallL(s) + 0.3 + 1.2 : oppEdges(s).wall + 1.2) + CELL * 1.5;
    const T = R - 0.32;
    let G;
    if (ad <= e) G = T;
    else {
      const k = ad - e;
      G = T + clamp(B - T, -k / 1.7, k * 1.4);    // 盛土 1:1.7、切土 1:0.7（法面）
    }
    return B * (1 - w) + G * w;
  };

  return { base, height, near, noise, hills, valley, river, town, CELL, Habs };
}

// 格子の各点に一番近い中心線のサンプル（距離変換で一度に求める。track.nearest を点ごとに呼ぶより速い）
// 戻り値 (k, x, z) => { i, s, d, dist }（track.nearest と同じ形）
export function nearestField(track, x0, z0, nx, nz, cell) {
  const W = nx + 1, H = nz + 1, N = W * H;
  const best = new Int32Array(N).fill(-1), d2 = new Float32Array(N).fill(Infinity);
  const px = track.px, pz = track.pz;
  const tryAt = (k, i) => {
    const gx = x0 + (k % W) * cell, gz = z0 + Math.floor(k / W) * cell;
    const dx = px[i] - gx, dz = pz[i] - gz, q = dx * dx + dz * dz;
    if (q < d2[k]) { d2[k] = q; best[k] = i; }
  };
  // 種：中心線の各サンプルの近くの点
  for (let i = 0; i < track.n; i++) {
    const gi = Math.round((px[i] - x0) / cell), gj = Math.round((pz[i] - z0) / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const ii = gi + a, jj = gj + b;
      if (ii >= 0 && ii < W && jj >= 0 && jj < H) tryAt(jj * W + ii, i);
    }
  }
  // 前から・後ろから伝える（2 回ずつ）
  const NB = [[-1, 0], [0, -1], [-1, -1], [1, -1]];
  for (let rep = 0; rep < 2; rep++) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      for (const [a, b] of NB) { const ii = i + a, jj = j + b; if (ii < 0 || ii >= W || jj < 0) continue; const s = best[jj * W + ii]; if (s >= 0) tryAt(k, s); }
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      for (const [a, b] of NB) { const ii = i - a, jj = j - b; if (ii < 0 || ii >= W || jj >= H) continue; const s = best[jj * W + ii]; if (s >= 0) tryAt(k, s); }
    }
  }
  return (k, x, z) => {
    let i = best[k]; if (i < 0) return null;
    // 近くのサンプルで正確に
    let bd = Infinity, bi = i;
    for (let q = Math.max(0, i - 8); q <= Math.min(track.n - 1, i + 8); q++) { const dx = px[q] - x, dz = pz[q] - z, e = dx * dx + dz * dz; if (e < bd) { bd = e; bi = q; } }
    i = bi;
    const d = (x - px[i]) * track.rx[i] + (z - pz[i]) * track.rz[i];
    return { i, s: i * track.ds, d, dist: Math.sqrt(bd) };
  };
}

// 地面のメッシュ（格子。道路から遠いマスは作らない。外周は遠くの地面の高さへ下げる）
export function buildGround(track, G, { margin = 560, cell = G.CELL, outerY = FAR_Y + 1 } = {}) {
  const b = track.bounds;
  const x0 = b.x0 - margin, x1 = b.x1 + margin, z0 = b.z0 - margin, z1 = b.z1 + margin;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const NV = (nx + 1) * (nz + 1);
  const pos = new Float32Array(NV * 3), col = new Float32Array(NV * 3), keep = new Uint8Array(NV);
  const cA = new THREE.Color(), cTown = new THREE.Color(0.66, 0.62, 0.55), cField = new THREE.Color(0.86, 0.8, 0.55), cHill = new THREE.Color(0.74, 0.86, 0.66), cLow = new THREE.Color(0.7, 1.0, 0.62);
  const NF = nearestField(track, x0, z0, nx, nz, cell);
  let k = 0;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++, k++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    const nr = NF(k, x, z);
    const dist = nr ? nr.dist : 1e9;
    let y = G.height(x, z, nr);
    // 外周：遠くの地面（world の farGround）の高さへ下げる
    const f = sstep(margin - 160, margin - 10, dist);
    y = y * (1 - f) + outerY * f;
    keep[k] = dist < margin ? 1 : 0;
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    // 色：町の平地は乾いた土色、料金所のあたりは田畑の色、山は濃い緑
    const s = nr ? nr.s : 0;
    const town = nr ? sstep(G.town.s0 - 60, G.town.s0 + 30, s) * (1 - sstep(G.town.s1 - 20, G.town.s1 + 80, s)) * (1 - sstep(260, 420, dist)) : 0;
    const field = nr ? (1 - sstep(SEC.embank0 - 80, SEC.embank0 + 40, s)) * sstep(30, 70, dist) : 0;
    const hill = clamp((y - BASE - 6) / 30, 0, 1), low = clamp((BASE - y - 8) / 12, 0, 1);
    cA.setRGB(1, 1, 1).lerp(cTown, town * 0.9).lerp(cField, field * 0.7).lerp(cHill, hill * 0.6).lerp(cLow, low * 0.7);
    const n = G.noise(x / 37, z / 37, 2);
    cA.multiplyScalar(0.86 + n * 0.28);
    col[k * 3] = cA.r; col[k * 3 + 1] = cA.g; col[k * 3 + 2] = cA.b;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, bb = a + 1, c = a + nx + 1, d = c + 1;
    if (!(keep[a] || keep[bb] || keep[c] || keep[d])) continue;
    idx.push(a, c, bb, bb, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = new Float32Array(NV * 2); for (let v = 0; v < NV; v++) { uv[v * 2] = pos[v * 3] / 8; uv[v * 2 + 1] = pos[v * 3 + 2] / 8; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(NV > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, groundMaterial());
  m.name = 'hw-ground'; m.receiveShadow = true; m.matrixAutoUpdate = false;
  return m;
}

// 地面の帯（トンネルの山・法面の外）の頂点の色を、格子の地面と同じ式で付ける
export function addGroundColor(g, G) {
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), c = new THREE.Color(), cHill = new THREE.Color(0.74, 0.86, 0.66);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    c.setRGB(1, 1, 1).lerp(cHill, clamp((y - BASE - 6) / 30, 0, 1) * 0.6).multiplyScalar(0.86 + G.noise(x / 37, z / 37, 2) * 0.28);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

let gMat = null;
export function groundMaterial() {
  if (gMat) return gMat;
  const t = TEX.grass();
  gMat = addMacroVariation(new THREE.MeshStandardMaterial({ name: 'hw-ground', map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.96, metalness: 0, vertexColors: true }),
    { scale: 0.012, amount: 0.22, scale2: 0.07, amount2: 0.12 });
  return gMat;
}

// 遠くの山並み（地面の外。中くらいの距離の丘）。地面の外周の外側に輪を作る
export function buildFarHills(track, G, { inner = 520, width = 1700, seed = 9 } = {}) {
  const noise = makeNoise(seed);
  const b = track.bounds, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const NA = 128, NR = 9;
  // 方向ごとに、コースの点の一番外の距離（サポート関数）＋ inner
  const rIn = new Float32Array(NA);
  for (let a = 0; a < NA; a++) {
    const th = a / NA * Math.PI * 2, ux = Math.sin(th), uz = -Math.cos(th);
    let m = 0;
    for (let i = 0; i < track.n; i += 8) m = Math.max(m, (track.px[i] - cx) * ux + (track.pz[i] - cz) * uz);
    rIn[a] = m + inner;
  }
  const pos = [], colA = [], idx = [];
  const c0 = new THREE.Color(0.16, 0.2, 0.17), c1 = new THREE.Color(0.1, 0.14, 0.13);
  for (let r = 0; r <= NR; r++) for (let a = 0; a <= NA; a++) {
    const aa = a % NA, th = aa / NA * Math.PI * 2, ux = Math.sin(th), uz = -Math.cos(th);
    const f = r / NR, R = rIn[aa] + width * f * f;
    const x = cx + ux * R, z = cz + uz * R;
    const ridge = Math.pow(noise(th * 3.1, f * 2.2 + 3), 1.6) * 1.5;
    let y = FAR_Y + (sstep(0.02, 0.5, f)) * (30 + 190 * ridge + 60 * noise(x / 260, z / 260)) * (1 - sstep(0.85, 1, f) * 0.3);
    if (r === 0) y = FAR_Y;
    pos.push(x, y, z);
    const c = c0.clone().lerp(c1, noise(x / 90, z / 90));
    colA.push(c.r, c.g, c.b);
  }
  for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) {
    const i0 = r * (NA + 1) + a, i1 = i0 + 1, i2 = i0 + NA + 1, i3 = i2 + 1;
    idx.push(i0, i1, i2, i1, i3, i2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, name: 'hw-farhills' }));
  m.name = 'hw-farhills'; m.receiveShadow = false; m.castShadow = false; m.matrixAutoUpdate = false;
  return m;
}
