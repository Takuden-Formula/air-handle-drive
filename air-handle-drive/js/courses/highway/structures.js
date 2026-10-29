// 高速道路コースの構造物：反対車線・防音壁・中央分離帯・照明柱・視線誘導標
// （高架・トンネル・料金所は bridge.js / tunnel.js / plaza.js）
import * as THREE from 'three';
import { MAT } from '../../engine/textures.js';
import { HMAT, glowRGB } from './tex.js';
import { SEC, LANE_W, wallL, wallR, oppEdges, wallKind } from './layout.js';

// ---------------------------------------------------------------------
// 断面を中心線に沿って押し出す（chunk m ごとに別の形に分ける：視錐台カリング用）
//   prof(s) → [[o, h], ...]（o = 中心線から外向きの距離 [m]、h = 路面からの高さ [m]）。点の数は同じにする。
//   side = +1（右）/ -1（左）。右側で「(o, h) 平面を時計回り」に並べると面が外を向く（左側は自動で逆順にする）
//   on(s) が false の所は切る。uLen = 長さ方向の UV 1 枚 [m]、vLen = 断面方向
// ---------------------------------------------------------------------
export function sweep(track, { s0 = 0, s1 = track.length, step = 2, side = 1, prof, on = null, uLen = 4, vLen = 4, chunk = 160, yFn = null, swap = false }) {
  const out = [];
  let pos = [], uv = [], idx = [], rows = 0, cols = 0, start = s0;
  const flush = () => {
    if (rows > 1) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
      out.push(g);
    }
    pos = []; uv = []; idx = []; rows = 0;
  };
  const v = new THREE.Vector3();
  const sEnd = Math.min(s1, track.length);
  const S = []; for (let s = s0; s < sEnd - 1e-6; s += step) S.push(s); S.push(sEnd);
  for (const s of S) {
    if (on && !on(s)) { flush(); start = s; continue; }
    let P = prof(s); if (side < 0) P = P.slice().reverse();
    cols = P.length;
    let acc = 0;
    for (let j = 0; j < cols; j++) {
      const [o, h] = P[j];
      if (j > 0) acc += Math.hypot(o - P[j - 1][0], h - P[j - 1][1]);
      track.toWorld(s, side * o, h, v);
      if (yFn) v.y = yFn(s, side * o, h, v);
      pos.push(v.x, v.y, v.z); if (swap) uv.push(acc / vLen, s / uLen); else uv.push(s / uLen, acc / vLen);
    }
    if (rows > 0) {
      const b = (rows - 1) * cols, c = rows * cols;
      for (let j = 0; j < cols - 1; j++) idx.push(b + j, b + j + 1, c + j, b + j + 1, c + j + 1, c + j);
    }
    rows++;
    if (s - start >= chunk && s < sEnd) { const last = pos.slice(-cols * 3), lastUv = uv.slice(-cols * 2); flush(); pos = last; uv = lastUv; rows = 1; start = s; }
  }
  flush();
  return out;
}
// 角をくっきりさせるため、同じ点を 2 回並べる
export const crisp = (pts) => pts.flatMap((p, i) => (i === 0 || i === pts.length - 1 ? [p] : [p, p]));

// 小さな形をたくさん：行列で動かして 1 つにまとめる（形の頂点を直接書き込むので速い）
const _baseCache = new WeakMap(), _nm = new THREE.Matrix3();
function baseArrays(geo) {
  let b = _baseCache.get(geo);
  if (!b) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    b = { p: g.attributes.position.array, n: g.attributes.normal.array, uv: g.attributes.uv ? g.attributes.uv.array : null, count: g.attributes.position.count };
    _baseCache.set(geo, b);
  }
  return b;
}
export class Batch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = null; }
  // color: [r, g, b]（頂点カラーにする場合）
  add(geo, m, color = null) {
    const b = baseArrays(geo), e = m ? m.elements : null;
    const ne = m ? _nm.getNormalMatrix(m).elements : null;
    const P = this.p, Nn = this.n, U = this.uv;
    if (color && !this.c) this.c = new Array(P.length).fill(1);
    for (let i = 0; i < b.count; i++) {
      const x = b.p[i * 3], y = b.p[i * 3 + 1], z = b.p[i * 3 + 2];
      const nx = b.n[i * 3], ny = b.n[i * 3 + 1], nz = b.n[i * 3 + 2];
      if (e) {
        P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        const ax = ne[0] * nx + ne[3] * ny + ne[6] * nz, ay = ne[1] * nx + ne[4] * ny + ne[7] * nz, az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const l = Math.hypot(ax, ay, az) || 1; Nn.push(ax / l, ay / l, az / l);
      } else { P.push(x, y, z); Nn.push(nx, ny, nz); }
      if (b.uv) U.push(b.uv[i * 2], b.uv[i * 2 + 1]); else U.push(0, 0);
      if (this.c) { const c = color || [1, 1, 1]; this.c.push(c[0], c[1], c[2]); }
    }
    return this;
  }
  get empty() { return this.p.length === 0; }
  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    this.p = []; this.n = []; this.uv = []; this.c = null;
    return g;
  }
}
export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

// コースの上の (s, d, h) に置く行列（-Z が進行方向）
const _m = new THREE.Matrix4();
export function at(track, s, d, h = 0, yaw = 0) { return track.placeMatrix(s, d, h, { yaw, out: new THREE.Matrix4() }); }

// 区間ごとに mb へ入れる（長い形はいくつかに分かれている）
function addAll(mb, geos, mat, opts) { for (const g of geos) mb.add(g, mat, null, opts); }

// ---------------------------------------------------------------------
// 反対車線（d の + 側）：舗装・白線
// ---------------------------------------------------------------------
export function buildOpposite(ctx) {
  const { track, mb } = ctx;
  const L = track.length;
  // 舗装（トンネルの中も：トンネルの形が上にかぶさる）
  addAll(mb, sweep(track, { step: 4, prof: (s) => { const e = oppEdges(s); const w = e.outer - e.inner; return [0, 0.25, 0.5, 0.75, 1].map((f) => [e.inner + w * f, 0]); }, uLen: 6, vLen: 6 }), MAT.asphalt());
  // 白線（外側の実線・車線の破線）
  for (const which of ['in', 'out']) {
    for (const g of sweep(track, { s0: SEC.plazaEnd + 10, step: 2, prof: (s) => { const e = oppEdges(s); const d = which === 'in' ? e.lanesIn + 0.12 : e.lanesOut - 0.12; return [[d - 0.1, 0.012], [d + 0.1, 0.012]]; }, uLen: 4, vLen: 1 })) ctx.lines.add(g);
  }
  for (const k of [1, 2]) {
    for (const g of sweep(track, { s0: SEC.taperEnd - 5, step: 1, on: (s) => ((L - s) % 20 + 20) % 20 < 8, prof: (s) => { const e = oppEdges(s); const d = e.lanesIn + LANE_W * k; return [[d - 0.075, 0.012], [d + 0.075, 0.012]]; }, uLen: 4, vLen: 1, chunk: 400 })) ctx.lines.add(g);
  }
}

// ---------------------------------------------------------------------
// 壁：左の防音壁、中央分離帯、反対車線の外の防音壁
// ---------------------------------------------------------------------
// 断面（(o, h)、o は壁の中心からの外向き。時計回り）
const PROF = {
  // コンクリートの低い壁（F 形）
  jersey: crisp([[-0.3, 0], [-0.22, 0.26], [-0.09, 0.86], [0.09, 0.86], [0.22, 0.26], [0.3, 0]]),
  // 高欄（高架の壁）。厚い
  parapet: crisp([[-0.25, 0], [-0.18, 0.2], [-0.12, 1.1], [0.28, 1.1], [0.28, -0.3]]),
  // 防音壁の板（柱の間）
  panel: crisp([[-0.06, 0.86], [-0.06, 4.4], [0.06, 4.4], [0.06, 0.86]]),
  // 防音壁の先端の円筒（先端改良型）
  cap: [[0.06, 4.38], [-0.1, 4.42], [-0.2, 4.58], [-0.16, 4.76], [0, 4.82], [0.14, 4.72], [0.16, 4.52], [0.06, 4.38]],
  // 透明板（高架）
  clear: crisp([[-0.03, 1.1], [-0.03, 3.1], [0.03, 3.1], [0.03, 1.1]]),
};

export function buildWalls(ctx) {
  const { track, mb } = ctx;
  const L = track.length;
  const conc = MAT.concrete(), sw = HMAT.soundWall(), clear = HMAT.clearPanel();
  const steel = MAT.color(0x7d858d, { rough: 0.45, metal: 0.75 }), green = MAT.color(0x3f6b4c, { rough: 0.6, metal: 0.2 });
  // 壁の線（左：自分の防音壁、右の外：反対車線の防音壁）と、その区間の種類
  const lines = [
    { side: -1, D: (s) => wallL(s), kind: (s) => wallKind(s) },
    { side: 1, D: (s) => oppEdges(s).wall, kind: (s) => wallKind(s) },
  ];
  for (const ln of lines) {
    const { side, D } = ln;
    const kindIs = (...k) => (s) => k.includes(ln.kind(s));
    const prof = (P) => (s) => P.map(([o, h]) => [D(s) + o, h]);
    // 平地：コンクリートの下の壁＋防音板＋先端
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('tall', 'plaza', 'jersey'), prof: prof(PROF.jersey), uLen: 4, vLen: 1.2 }), conc);
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('tall'), prof: prof(PROF.panel), uLen: 4, vLen: 4 }), sw);
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('tall'), prof: prof(PROF.cap), uLen: 4, vLen: 1 }), MAT.color(0x9aa39c, { rough: 0.5, metal: 0.4 }));
    // 高架・橋：高欄
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('clear', 'low'), prof: prof(PROF.parapet), uLen: 4, vLen: 1.5 }), conc);
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('clear'), prof: prof(PROF.clear), uLen: 4, vLen: 2 }), clear, { shadow: false });
    // 柱（H 形鋼）と手すり
    const posts = new Batch();
    for (let s = 0; s < L; s += 2) {
      const k = ln.kind(s);
      if (k === 'tall' && Math.round(s) % 4 === 0) posts.add(box(0.2, 3.7, 0.3, 0, 0.82, 0), at(track, s, side * (D(s) - 0.12), 0));
      if (k === 'clear') posts.add(box(0.1, 2.05, 0.16, 0, 1.08, 0), at(track, s, side * (D(s) - 0.02), 0));
      if (k === 'low') posts.add(box(0.08, 0.5, 0.08, 0, 1.1, 0), at(track, s, side * (D(s) + 0.05), 0));
    }
    const pg = posts.build(); if (pg) mb.add(pg, steel);
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('clear'), prof: (s) => [[D(s) - 0.06, 3.06], [D(s) - 0.06, 3.16], [D(s) + 0.06, 3.16], [D(s) + 0.06, 3.06]], uLen: 4, vLen: 1 }), steel);
    addAll(mb, sweep(track, { side, step: 4, on: kindIs('low'), prof: (s) => [[D(s) - 0.05, 1.52], [D(s) - 0.05, 1.6], [D(s) + 0.1, 1.6], [D(s) + 0.1, 1.52]], uLen: 4, vLen: 1 }), steel);
  }
  // ---- 中央分離帯（自分の右）：コンクリートの壁＋防眩板 ----
  const medOn = (s) => wallKind(s) !== 'tunnel';
  addAll(mb, sweep(track, { side: 1, step: 4, on: medOn, prof: (s) => PROF.jersey.map(([o, h]) => [wallR(s) + o, h]), uLen: 4, vLen: 1.2 }), conc);
  // 反対車線が離れている所は、反対車線の内側にも壁
  addAll(mb, sweep(track, { side: 1, step: 4, on: (s) => medOn(s) && oppEdges(s).sep, prof: (s) => PROF.jersey.map(([o, h]) => [oppEdges(s).inner - 0.3 + o, h]), uLen: 4, vLen: 1.2 }), conc);
  // 防眩板（1 m ごと。分離帯の上に斜めに並ぶ緑の板）
  const glare = new Batch(), plate = new THREE.PlaneGeometry(0.22, 0.62).translate(0, 0.86 + 0.31, 0);
  const plate2 = plate.clone().rotateY(Math.PI);
  for (let s = SEC.taperEnd; s < L; s += 1) {
    if (!medOn(s) || oppEdges(s).sep) continue;
    const m = at(track, s, wallR(s), 0, 0.45);
    glare.add(plate, m).add(plate2, m);
  }
  const gg = glare.build(); if (gg) mb.add(gg, green, null, { shadow: true });
}

// ---------------------------------------------------------------------
// 照明柱（中央分離帯の上、両側に腕）・視線誘導標
// ---------------------------------------------------------------------
export function buildLights(ctx) {
  const { track, mb, group } = ctx;
  const L = track.length;
  const pole = new Batch(), pools = [];
  const steel = MAT.color(0x8c949b, { rough: 0.4, metal: 0.8 });
  const H = 10.5;
  const poleG = new THREE.CylinderGeometry(0.11, 0.17, H, 8).translate(0, H / 2 + 0.86, 0);
  const armG = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6).rotateZ(Math.PI / 2 - 0.12).translate(1.65, H + 0.86 + 0.2, 0);
  const headG = box(0.75, 0.16, 0.36, 3.3, H + 0.86 + 0.28, 0);
  const lampG = new THREE.PlaneGeometry(0.62, 0.26).rotateX(Math.PI / 2).translate(3.3, H + 0.86 + 0.27, 0);
  for (let s = 60; s < L; s += 42) {
    const k = wallKind(s); if (k === 'tunnel') continue;
    const e = oppEdges(s);
    if (e.sep) continue;
    const m = at(track, s, wallR(s), 0);
    pole.add(poleG, m);
    // 腕は両側（自分の車線と反対車線）
    for (const dir of [-1, 1]) {
      const r = new THREE.Matrix4().makeRotationY(dir < 0 ? Math.PI : 0), mm = m.clone().multiply(r);
      pole.add(armG, mm); pole.add(headG, mm); ctx.glow.add(lampG, mm, glowRGB(0xffd9a0, 5));
      pools.push([s, wallR(s) + dir * 3.3]);
    }
  }
  const pg = pole.build(); if (pg) mb.add(pg, steel);
  // 路面の光だまり（加算合成のぼかし。夕方なので控えめ）
  const pm = new THREE.MeshBasicMaterial({ map: poolTex(), color: 0xffb46a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
  const pb = new Batch(), q = new THREE.PlaneGeometry(13, 16).rotateX(-Math.PI / 2);
  for (const [s, d] of pools) pb.add(q, at(track, s, d * 0.92, 0.03));
  const pmesh = new THREE.Mesh(pb.build(), pm); pmesh.renderOrder = 2; pmesh.name = 'hw-pools'; pmesh.matrixAutoUpdate = false;
  group.add(pmesh);
}
let _pool = null;
function poolTex() {
  if (_pool) return _pool;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _pool = new THREE.CanvasTexture(c); _pool.colorSpace = THREE.SRGBColorSpace;
  return _pool;
}
