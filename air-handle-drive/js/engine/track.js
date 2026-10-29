// コースの中心線と、その上の問い合わせ（距離 → 位置・向き・幅・路面）と、路面まわりのメッシュ生成。
// 座標: 単位 m、Y が上。向き（heading）0 は -Z 方向（コースマップの上）、+ で右回り。
// 中心線の右 = 進行方向の右 = d の + 側。曲率 kappa は + が右カーブ。
import * as THREE from 'three';
import { MAT } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// =====================================================================
// 中心線をつくる（タートル方式）：直線とカーブ（入口・出口はクロソイド）を順につなぐ
//   const p = new PathBuilder({ x: 0, z: 0, heading: 0 });
//   p.straight(200).turn(60, 90).straight(100).turn(20, -180, { entry: 10 });
//   const pts = p.build({ ds: 1, close: true });   // 周回コースは close で継ぎ目を合わせる
// =====================================================================
export class PathBuilder {
  constructor({ x = 0, z = 0, heading = 0 } = {}) {
    this.x0 = x; this.z0 = z; this.h0 = heading * DEG; this.segs = []; this.marks = {};
  }
  // 今の位置（中心線の距離 s）に名前を付ける。build() のあと marks[name] で s が分かる（景色を置く場所に使う）
  mark(name) { this.marks[name] = this.length; (this._markOrder || (this._markOrder = [])).push({ name, seg: this.segs.length }); return this; }
  // id を付けた直線は build({ close: true, solve: [id1, id2] }) で長さを自動で決められる（周回コースの継ぎ目をぴったり閉じる）
  straight(len, { id = null } = {}) { this.segs.push({ len: Math.max(0, len), k0: 0, k1: 0, id }); return this; }
  // radius [m]、angle [度]（+ = 右）。entry / exit はクロソイド（曲率がだんだん変わる区間）の長さ [m]
  turn(radius, angle, { entry = null, exit = null } = {}) {
    const k = Math.sign(angle) / radius, total = Math.abs(angle) * DEG;
    let le = entry ?? Math.min(radius * 0.45, 28), lx = exit ?? le;
    let arc = total - Math.abs(k) * (le + lx) / 2;
    if (arc < 0) { const f = total / (Math.abs(k) * (le + lx) / 2); le *= f; lx *= f; arc = 0; }
    if (le > 0) this.segs.push({ len: le, k0: 0, k1: k });
    if (arc > 0) this.segs.push({ len: arc * radius, k0: k, k1: k });
    if (lx > 0) this.segs.push({ len: lx, k0: k, k1: 0 });
    return this;
  }
  // 名前つきの 2 本の直線の長さを、終点が始点にぴったり戻るように決める（直線は向きが決まっているので一次式で解ける）
  _solve([a, b]) {
    const ia = this.segs.findIndex((s) => s.id === a), ib = this.segs.findIndex((s) => s.id === b);
    if (ia < 0 || ib < 0) return;
    const end = () => {   // 細かく積分して終点を出す
      let x = this.x0, z = this.z0, h = this.h0;
      for (const sg of this.segs) {
        const steps = Math.max(1, Math.ceil(sg.len / 0.05)), st = sg.len / steps;
        for (let i = 0; i < steps; i++) { const u = (i + 0.5) / steps, k = sg.k0 + (sg.k1 - sg.k0) * u, hm = h + k * st / 2; x += Math.sin(hm) * st; z -= Math.cos(hm) * st; h += k * st; }
      }
      return [x - this.x0, z - this.z0];
    };
    const la = this.segs[ia].len, lb = this.segs[ib].len;
    this.segs[ia].len = 0; this.segs[ib].len = 0; const e0 = end();
    this.segs[ia].len = 1; const ea = end(); this.segs[ia].len = 0;
    this.segs[ib].len = 1; const eb = end(); this.segs[ib].len = 0;
    const A = [ea[0] - e0[0], ea[1] - e0[1]], B = [eb[0] - e0[0], eb[1] - e0[1]], det = A[0] * B[1] - A[1] * B[0];
    if (Math.abs(det) < 1e-6) { this.segs[ia].len = la; this.segs[ib].len = lb; return; }
    const x = (-e0[0] * B[1] + e0[1] * B[0]) / det, y = (-A[0] * e0[1] + A[1] * e0[0]) / det;
    if (x < 0 || y < 0) console.warn(`PathBuilder: 直線 ${a}=${x.toFixed(1)} m, ${b}=${y.toFixed(1)} m が負になりました。形を見直してください`);
    this.segs[ia].len = Math.max(0, x); this.segs[ib].len = Math.max(0, y);
    this.solved = { [a]: x, [b]: y };
    this._remark();   // marks（名前つきの位置）を付け直す
  }
  _remark() {
    if (!this._markOrder) return;
    for (const mk of this._markOrder) { let s = 0; for (let i = 0; i < mk.seg; i++) s += this.segs[i].len; this.marks[mk.name] = s; }
  }
  // 曲率を直接指定する区間（S 字など）
  curve(len, k0, k1 = k0) { this.segs.push({ len, k0, k1 }); return this; }
  get length() { return this.segs.reduce((a, s) => a + s.len, 0); }

  // 積分して点列にする。戻り値 { x:[], z:[], closed, ds }（ds 間隔、n = floor(L/ds)+1 点。周回は終点を含めない）
  build({ ds = 1, close = false, solve = null } = {}) {
    if (close && solve && solve.length === 2) this._solve(solve);
    const L = this.length, sub = 0.05;
    const integrate = (dk) => {
      const xs = [this.x0], zs = [this.z0];
      let x = this.x0, z = this.z0, h = this.h0, s = 0, next = ds;
      for (const sg of this.segs) {
        const steps = Math.max(1, Math.ceil(sg.len / sub)), st = sg.len / steps;
        for (let i = 0; i < steps; i++) {
          const u = (i + 0.5) / steps, k = sg.k0 + (sg.k1 - sg.k0) * u + dk;
          const hm = h + k * st / 2;
          x += Math.sin(hm) * st; z -= Math.cos(hm) * st; h += k * st; s += st;
          while (s >= next - 1e-9) {
            const back = s - next;   // 行き過ぎた分を戻して ds ちょうどの位置を記録
            xs.push(x - Math.sin(h) * back); zs.push(z + Math.cos(h) * back); next += ds;
          }
        }
      }
      return { xs, zs, h, x, z };
    };
    let r = integrate(0);
    if (close) {
      // 向きのずれを曲率に均等に配って直し、位置のずれは距離に比例して配る
      let dh = r.h - this.h0; const turns = Math.round(dh / (2 * Math.PI)); dh -= turns * 2 * Math.PI;
      r = integrate(-dh / L);
      const ex = r.x - this.x0, ez = r.z - this.z0, n = r.xs.length;
      this.closeError = Math.hypot(ex, ez);
      for (let i = 0; i < n; i++) { const t = (i * ds) / L; r.xs[i] -= ex * t; r.zs[i] -= ez * t; }
      // 終点（= 始点）は含めない
      while (r.xs.length > 1 && Math.hypot(r.xs[r.xs.length - 1] - this.x0, r.zs[r.zs.length - 1] - this.z0) < ds * 0.5) { r.xs.pop(); r.zs.pop(); }
    }
    return { x: r.xs, z: r.zs, closed: close, ds };
  }
}

// 点列（[[x, z], ...]）を通るなめらかな線（周回なら closed）。ds 間隔で取り直す
export function pathFromPoints(pts, { closed = false, ds = 1, tension = 0.5 } = {}) {
  const v = pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(v, closed, 'centripetal', tension);
  const L = curve.getLength(), n = Math.max(2, Math.round(L / ds));
  const sp = curve.getSpacedPoints(n);
  if (closed) sp.pop();
  return { x: sp.map((p) => p.x), z: sp.map((p) => p.z), closed, ds: L / n };
}

// 区分的になめらかな関数（高さ・幅など）。keys: [[s, value], ...]（s の昇順）。周回なら period を渡す
// 単調な 3 次エルミート補間（行き過ぎない）
export function profile(keys, { period = 0 } = {}) {
  if (!keys || !keys.length) return () => 0;
  if (keys.length === 1) return () => keys[0][1];
  let K = keys.slice();
  if (period) K = [[K[K.length - 1][0] - period, K[K.length - 1][1]], ...K, [K[0][0] + period, K[0][1]]];
  const n = K.length, m = new Array(n).fill(0), d = [];
  for (let i = 0; i < n - 1; i++) d.push((K[i + 1][1] - K[i][1]) / Math.max(1e-6, K[i + 1][0] - K[i][0]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (s) => {
    if (period) s = ((s - K[1][0]) % period + period) % period + K[1][0];
    if (s <= K[0][0]) return K[0][1];
    if (s >= K[n - 1][0]) return K[n - 1][1];
    let i = 0; while (i < n - 2 && s > K[i + 1][0]) i++;
    const h = K[i + 1][0] - K[i][0], t = (s - K[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * K[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * K[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// =====================================================================
// Track：中心線のサンプル（ds ごと）と、その上の問い合わせ
// layout（コースの build() が返す）から作る:
//   path: PathBuilder.build() か pathFromPoints() の戻り値
//   width: 舗装の全幅 [m]（数値か (s) => 数値）、elevation: (s) => 高さ [m]、bank: (s) => バンク角 [rad]（+ で右が低い）
//   edges(s, side, info) => { kerb, runoff, runoffW, barrier, barrierD, verge }   side: -1 = 左, 1 = 右
//     kerb: 縁石の幅 [m]（0 で無し） / runoff: 'grass'|'gravel'|'asphalt'|'sand'|'concrete' / runoffW: その幅 [m]
//     barrier: 'armco'|'tires'|'wall'|'fence'|'none' / barrierD: 中心線から壁までの距離 [m]（省略時は舗装端+縁石+runoffW+1）
//     verge: 壁の外側の地面（草）の幅 [m]
//   ground: 舗装の外の地面の種類（surfaceAt の戻り値。既定 'grass'）
// =====================================================================
export const RUNOFF_TYPES = ['grass', 'gravel', 'asphalt', 'sand', 'concrete', 'dirt'];
export const BARRIER_TYPES = ['none', 'armco', 'tires', 'wall', 'fence'];

export class Track {
  constructor(layout) {
    const P = layout.path;
    this.closed = !!P.closed; this.ds = P.ds;
    const n = this.n = P.x.length;
    this.length = this.closed ? n * this.ds : (n - 1) * this.ds;
    this.ground = layout.ground || 'grass';
    const elev = layout.elevation || (() => 0), bankF = layout.bank || (() => 0);
    const widthF = typeof layout.width === 'function' ? layout.width : () => (layout.width || 10);
    const A = (T = Float32Array) => new T(n);
    this.px = A(); this.py = A(); this.pz = A(); this.tx = A(); this.ty = A(); this.tz = A();
    this.rx = A(); this.rz = A(); this.kappa = A(); this.heading = A(); this.bank = A(); this.half = A();
    for (let i = 0; i < n; i++) {
      const s = i * this.ds;
      this.px[i] = P.x[i]; this.pz[i] = P.z[i]; this.py[i] = elev(s); this.bank[i] = bankF(s); this.half[i] = widthF(s) / 2;
    }
    // 向き・接線・曲率
    const idx = (i) => this.closed ? (i % n + n) % n : clamp(i, 0, n - 1);
    for (let i = 0; i < n; i++) {
      const a = idx(i - 1), b = idx(i + 1);
      let dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], dy = this.py[b] - this.py[a];
      const lh = Math.hypot(dx, dz) || 1;
      this.heading[i] = Math.atan2(dx / lh, -dz / lh);
      const l3 = Math.hypot(dx, dy, dz) || 1;
      this.tx[i] = dx / l3; this.ty[i] = dy / l3; this.tz[i] = dz / l3;
      this.rx[i] = -dz / lh; this.rz[i] = dx / lh;
    }
    for (let i = 0; i < n; i++) {
      const a = idx(i - 2), b = idx(i + 2);
      let dh = this.heading[b] - this.heading[a];
      dh = (dh + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
      const span = (this.closed || (i >= 2 && i < n - 2)) ? 4 * this.ds : Math.max(this.ds, (b - a) * this.ds);
      this.kappa[i] = dh / span;
    }
    // なめらかにした曲率（縁石・砂利・自動ブレーキの判断用）
    this.kappaS = A();
    const W = Math.round(8 / this.ds);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = -W; j <= W; j++) { const k = i + j; if (!this.closed && (k < 0 || k >= n)) continue; s += this.kappa[idx(k)]; c++; }
      this.kappaS[i] = s / c;
    }
    // 道の脇（縁石・ランオフ・壁）
    this.edges = { [-1]: null, [1]: null };
    const edgesF = layout.edges || defaultEdges;
    for (const side of [-1, 1]) {
      const e = { kerb: A(), runoffT: A(Uint8Array), runoffW: A(), barrierT: A(Uint8Array), barrierD: A(), verge: A() };
      for (let i = 0; i < n; i++) {
        const s = i * this.ds;
        const r = edgesF(s, side, { kappa: this.kappaS[i], half: this.half[i], track: this }) || {};
        e.kerb[i] = r.kerb || 0;
        e.runoffT[i] = Math.max(0, RUNOFF_TYPES.indexOf(r.runoff || this.ground));
        e.runoffW[i] = r.runoffW ?? 3;
        e.barrierT[i] = Math.max(0, BARRIER_TYPES.indexOf(r.barrier || 'armco'));
        e.barrierD[i] = r.barrierD ?? (this.half[i] + e.kerb[i] + e.runoffW[i] + 1);
        e.verge[i] = r.verge ?? 14;
      }
      // 壁の位置は急に変わらないように前後 ±12 m でならす（見た目も当たり判定も同じ値を使う）
      e.barrierD = smoothArray(e.barrierD, Math.round(12 / this.ds), this.closed);
      e.runoffW = smoothArray(e.runoffW, Math.round(6 / this.ds), this.closed);
      this.edges[side] = e;
    }
    this._limitByCurvature();
    this._buildGrid();
    this._limitByNeighbours();
  }

  // カーブの内側では、壁や草地が曲率半径を越えて裏返らないようにする
  _limitByCurvature() {
    const n = this.n, W = Math.round(15 / this.ds);
    for (let i = 0; i < n; i++) {
      let km = 0;
      for (let j = -W; j <= W; j++) {
        let k = i + j; if (this.closed) k = (k % n + n) % n; else if (k < 0 || k >= n) continue;
        if (Math.sign(this.kappaS[k]) === Math.sign(this.kappaS[i])) km = Math.max(km, Math.abs(this.kappaS[k]));
      }
      if (km < 1e-4) continue;
      const side = Math.sign(this.kappaS[i]), lim = 0.85 / km, e = this.edges[side];
      const minD = this.half[i] + e.kerb[i] + 0.8;
      if (e.barrierD[i] > lim) e.barrierD[i] = Math.max(minD, lim);
      if (this.half[i] + e.kerb[i] + e.runoffW[i] > lim) e.runoffW[i] = Math.max(0, lim - this.half[i] - e.kerb[i]);
      e.verge[i] = Math.min(e.verge[i], Math.max(0.5, lim - e.barrierD[i]));
    }
  }

  // ---------- 基本の問い合わせ ----------
  wrap(s) { return this.closed ? ((s % this.length) + this.length) % this.length : clamp(s, 0, this.length); }
  _at(s) {   // サンプル番号と補間係数
    const f = this.wrap(s) / this.ds; let i = Math.floor(f), u = f - i;
    if (this.closed) { i = i % this.n; return [i, (i + 1) % this.n, u]; }
    if (i >= this.n - 1) return [this.n - 1, this.n - 1, 0];
    return [i, i + 1, u];
  }
  _lerp(arr, s) { const [a, b, u] = this._at(s); return arr[a] + (arr[b] - arr[a]) * u; }
  kappaAt(s) { return this._lerp(this.kappaS, s); }
  halfWidth(s, side = 1) { return this._lerp(this.half, s); }
  bankAt(s) { return this._lerp(this.bank, s); }
  heightAt(s, d = 0) { return this._lerp(this.py, s) - d * Math.tan(this.bankAt(s)); }
  headingAt(s) { const [a, b, u] = this._at(s); let dh = this.heading[b] - this.heading[a]; dh = (dh + 3 * Math.PI) % (2 * Math.PI) - Math.PI; return this.heading[a] + dh * u; }
  barrierD(s, side) { return this._lerp(this.edges[side].barrierD, s); }
  edgeAt(s, side) {
    const e = this.edges[side], [a, b, u] = this._at(s), i = u < 0.5 ? a : b;
    return { kerb: e.kerb[i], runoff: RUNOFF_TYPES[e.runoffT[i]], runoffW: e.runoffW[i], barrier: BARRIER_TYPES[e.barrierT[i]], barrierD: this.barrierD(s, side), verge: e.verge[i] };
  }
  // 横の位置 d の路面の種類: 'road' | 'kerb' | ランオフの種類 | 地面（ground）
  surfaceAt(s, d) {
    const side = d >= 0 ? 1 : -1, a = Math.abs(d), half = this.halfWidth(s, side);
    if (a <= half) return 'road';
    const e = this.edgeAt(s, side);
    if (a <= half + e.kerb) return 'kerb';
    if (a <= half + e.kerb + e.runoffW) return e.runoff;
    return this.ground;
  }
  // 中心線の位置 s での座標系（pos, 3D の接線 tan, 水平の右 right, up）
  frame(s, out = {}) {
    const [a, b, u] = this._at(s);
    const L = (arr) => arr[a] + (arr[b] - arr[a]) * u;
    out.pos = (out.pos || new THREE.Vector3()).set(L(this.px), L(this.py), L(this.pz));
    out.tan = (out.tan || new THREE.Vector3()).set(L(this.tx), L(this.ty), L(this.tz)).normalize();
    out.right = (out.right || new THREE.Vector3()).set(L(this.rx), 0, L(this.rz)).normalize();
    const bk = L(this.bank);
    out.up = (out.up || new THREE.Vector3()).copy(out.right).cross(out.tan).normalize();   // 右 × 前 = 上
    if (bk) out.up.applyAxisAngle(out.tan, bk);
    out.bank = bk; out.kappa = L(this.kappaS); out.half = L(this.half); out.s = this.wrap(s);
    return out;
  }
  // 中心線から横に d、高さ h の点（ワールド座標）
  toWorld(s, d = 0, h = 0, out = new THREE.Vector3()) {
    const [a, b, u] = this._at(s);
    const L = (arr) => arr[a] + (arr[b] - arr[a]) * u;
    let rx = L(this.rx), rz = L(this.rz); const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    return out.set(L(this.px) + rx * d, L(this.py) - d * Math.tan(L(this.bank)) + h, L(this.pz) + rz * d);
  }
  // 物を道に沿って置く行列（物の -Z が進行方向、+X が右、+Y が上）。yaw [rad] で向きを足せる
  placeMatrix(s, d = 0, h = 0, { yaw = 0, scale = 1, followSlope = false, out = new THREE.Matrix4() } = {}) {
    const p = this.toWorld(s, d, h, _v1);
    const hd = this.headingAt(s) + yaw;
    _q.setFromEuler(_e.set(followSlope ? Math.asin(clamp(this._lerp(this.ty, s), -1, 1)) : 0, -hd, 0, 'YXZ'));
    return out.compose(p, _q, _s.set(scale, scale, scale));
  }

  // ---------- 平面の位置 → コース上の位置 ----------
  _buildGrid() {
    // 中心線のサンプルを C m 四方のマス目に分けて入れておく（近い点を速く探すため）
    const C = this.gridCell = 16;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) { x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]); z0 = Math.min(z0, this.pz[i]); z1 = Math.max(z1, this.pz[i]); }
    this.bounds = { x0, x1, z0, z1 };
    const gx0 = this._gx0 = Math.floor(x0 / C), gz0 = this._gz0 = Math.floor(z0 / C);
    const GW = this._gw = Math.floor(x1 / C) - gx0 + 1, GH = this._gh = Math.floor(z1 / C) - gz0 + 1;
    const cnt = new Uint32Array(GW * GH + 1);
    const cellOf = (i) => (Math.floor(this.pz[i] / C) - gz0) * GW + (Math.floor(this.px[i] / C) - gx0);
    for (let i = 0; i < this.n; i++) cnt[cellOf(i) + 1]++;
    for (let k = 1; k <= GW * GH; k++) cnt[k] += cnt[k - 1];
    const fill = cnt.slice(), items = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) items[fill[cellOf(i)]++] = i;
    this._gStart = cnt; this._gItems = items;
  }
  // 最も近い中心線のサンプル。maxR [m] 以内に無ければ null。戻り値 { i, s, d(+右), dist }
  // exclude(i) が true のサンプルは除く
  nearest(x, z, maxR = 64, exclude = null) {
    const C = this.gridCell, GW = this._gw, GH = this._gh;
    const cx = Math.floor(x / C) - this._gx0, cz = Math.floor(z / C) - this._gz0;
    const R = Math.ceil(maxR / C);
    // マス目の外の点は、マス目までの距離ぶんの輪から探し始める
    const r0 = Math.max(0, -cx, -cz, cx - (GW - 1), cz - (GH - 1));
    let best = -1, bd = maxR * maxR;
    const st = this._gStart, it = this._gItems, px = this.px, pz = this.pz;
    for (let r = r0; r <= R; r++) {
      if (best >= 0 && (r - 1) * C > Math.sqrt(bd)) break;
      const za = Math.max(0, cz - r), zb = Math.min(GH - 1, cz + r);
      for (let gz = za; gz <= zb; gz++) {
        const edgeRow = gz === cz - r || gz === cz + r;
        const step = edgeRow || r === 0 ? 1 : 2 * r;
        for (let gx = cx - r; gx <= cx + r; gx += step) {
          if (gx < 0 || gx >= GW) continue;
          const c = gz * GW + gx;
          for (let k = st[c], e = st[c + 1]; k < e; k++) {
            const i = it[k];
            if (exclude && exclude(i)) continue;
            const dx = px[i] - x, dz = pz[i] - z, d2 = dx * dx + dz * dz;
            if (d2 < bd) { bd = d2; best = i; }
          }
        }
      }
    }
    if (best < 0) return null;
    const d = (x - px[best]) * this.rx[best] + (z - pz[best]) * this.rz[best];
    return { i: best, s: best * this.ds, d, dist: Math.sqrt(bd) };
  }
  // 近くを通る別の区間（コースが折り返して近づく所）に壁や草地がはみ出さないよう制限する
  _limitByNeighbours() {
    const n = this.n, ds = this.ds, far = 60 / ds;
    this.clear = { [-1]: new Float32Array(n).fill(200), [1]: new Float32Array(n).fill(200) };
    const C = this.gridCell, GW = this._gw, GH = this._gh, R = 6, st = this._gStart, it = this._gItems;
    for (let i = 0; i < n; i += 2) {
      const cx = Math.floor(this.px[i] / C) - this._gx0, cz = Math.floor(this.pz[i] / C) - this._gz0;
      for (let gz = Math.max(0, cz - R); gz <= Math.min(GH - 1, cz + R); gz++) for (let gx = Math.max(0, cx - R); gx <= Math.min(GW - 1, cx + R); gx++) {
        const c = gz * GW + gx;
        for (let q = st[c], e = st[c + 1]; q < e; q++) {
          const j = it[q];
          let di = Math.abs(i - j); if (this.closed) di = Math.min(di, n - di);
          if (di < far) continue;
          const dx = this.px[j] - this.px[i], dz = this.pz[j] - this.pz[i], dist = Math.hypot(dx, dz);
          const side = dx * this.rx[i] + dz * this.rz[i] >= 0 ? 1 : -1;
          const cl = this.clear[side];
          if (dist < cl[i]) { cl[i] = dist; if (i + 1 < n) cl[i + 1] = dist; }
        }
      }
    }
    for (const side of [-1, 1]) {
      const c = smoothArray(this.clear[side], 4, this.closed, true);
      this.clear[side] = c;
      const e = this.edges[side];
      for (let i = 0; i < n; i++) {
        if (c[i] >= 200) continue;
        // 別の区間との真ん中より手前に壁を置く
        const lim = c[i] / 2;
        if (e.barrierD[i] > lim) e.barrierD[i] = Math.max(this.half[i] + e.kerb[i] + 0.8, lim);
        e.verge[i] = Math.min(e.verge[i], Math.max(1, c[i] / 2 - e.barrierD[i] + 2));
      }
    }
  }

  // コースマップ用の点列 [[x, z], ...]（s0〜s1、step m ごと）
  mapPoints(s0 = 0, s1 = this.length, step = 4) {
    const pts = [];
    for (let s = s0; s < s1; s += step) { const [a] = this._at(s); pts.push([this.px[a], this.pz[a]]); }
    const [b] = this._at(s1); pts.push([this.px[b], this.pz[b]]);
    return pts;
  }
}

const _v1 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();

function smoothArray(arr, w, closed, minOnly = false) {
  const n = arr.length, out = new Float32Array(n);
  if (w <= 0) { out.set(arr); return out; }
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0, m = Infinity;
    for (let j = -w; j <= w; j++) {
      let k = i + j; if (closed) k = (k % n + n) % n; else if (k < 0 || k >= n) continue;
      s += arr[k]; c++; m = Math.min(m, arr[k]);
    }
    out[i] = minOnly ? m : s / c;
  }
  return out;
}

// 既定の道の脇：カーブの内側と外側に縁石、外側に砂利とタイヤバリア、それ以外は芝とガードレール（サーキット風）
export function defaultEdges(s, side, { kappa, half }) {
  const k = Math.abs(kappa), outside = Math.sign(kappa) === -side;
  const corner = k > 1 / 140;
  if (!corner) return { kerb: 0, runoff: 'grass', runoffW: 6, barrier: 'armco', barrierD: half + 7 };
  return outside
    ? { kerb: 1.2, runoff: 'gravel', runoffW: 12, barrier: 'tires', barrierD: half + 1.2 + 13 }
    : { kerb: 1.0, runoff: 'grass', runoffW: 4, barrier: 'armco', barrierD: half + 6 };
}

// =====================================================================
// メッシュ生成（道路・白線・縁石・ランオフ・道の脇の草地・壁）
// style: {
//   road: Material（既定 MAT.asphalt()）, roadTex: テクスチャ 1 枚の大きさ [m]
//   markings: [{ d: 中心からの位置 [m] または edge: ±1 + inset, w: 幅, dash: [線, すき間] [m], color: 'white'|'yellow', from, to }]
//   kerbHeight, kerbMat
//   heightFn: (x, z) => 地面の高さ（terrain.js の createHeightFn）。草地の外側をこれに合わせる
//   chunk: 分割の長さ [m]（視錐台カリング用）
//   barriers: false で壁を作らない（コース側で自前に作るとき）
// }
// 戻り値: THREE.Group（userData.chunks に区間ごとのメッシュ）
// =====================================================================
export function buildTrackMeshes(track, style = {}) {
  const group = new THREE.Group(); group.name = 'track';
  const ds = track.ds, n = track.n;
  const CH = Math.max(20, Math.round((style.chunk || 300) / ds));
  const heightFn = style.heightFn || ((x, z) => { const r = track.nearest(x, z, 200); return r ? track.py[r.i] - 0.3 : 0; });
  const roadMat = style.road || MAT.asphalt();
  const roadTex = style.roadTex || 6;
  const vergeMat = style.vergeMat || MAT.grass();
  const runoffMat = { grass: vergeMat, gravel: MAT.gravel(), asphalt: roadMat, sand: MAT.sand(), concrete: MAT.concrete(), dirt: MAT.sand(), ...(style.runoffMats || {}) };
  const segEnd = track.closed ? n : n - 1;
  const P = (i) => (track.closed ? (i % n + n) % n : clamp(i, 0, n - 1));
  // サンプル i の横 d の点
  const pt = (i, d, h = 0) => {
    const k = P(i);
    return [track.px[k] + track.rx[k] * d, track.py[k] - d * Math.tan(track.bank[k]) + h, track.pz[k] + track.rz[k] * d];
  };

  for (let c0 = 0; c0 < segEnd; c0 += CH) {
    const c1 = Math.min(segEnd, c0 + CH);
    const chunk = new THREE.Group(); chunk.name = 'chunk' + c0;
    const add = (geo, mat, { shadow = true, cast = false } = {}) => {
      if (!geo) return; const m = new THREE.Mesh(geo, mat); m.receiveShadow = shadow; m.castShadow = cast; m.matrixAutoUpdate = false; chunk.add(m); return m;
    };

    // ---- 舗装（横に 6 分割） ----
    {
      const cols = 6, B = new RibbonBuilder();
      for (let i = c0; i <= c1; i++) {
        const k = P(i), hL = track.half[k], hR = track.half[k], s = i * ds;
        const row = [];
        for (let c = 0; c <= cols; c++) {
          const d = -hL + (hL + hR) * c / cols;
          row.push({ p: pt(i, d), uv: [d / roadTex, s / roadTex] });
        }
        B.row(row);
      }
      add(B.build(), roadMat);
    }
    // ---- 縁石・ランオフ・草地（左右） ----
    for (const side of [-1, 1]) {
      const e = track.edges[side];
      const kerbB = new RibbonBuilder(), runB = {}, vergeB = new RibbonBuilder();
      let kerbOpen = false;
      const runOpen = {};
      for (let i = c0; i <= c1; i++) {
        const k = P(i), s = i * ds, half = track.half[k];
        const kw = e.kerb[k], rw = e.runoffW[k], rt = RUNOFF_TYPES[e.runoffT[k]];
        // 縁石（盛り上がった形）
        if (kw > 0.05) {
          const prof = [[0, 0.0], [0.12, 0.035], [kw - 0.12, 0.05], [kw, 0.0]];
          kerbB.row(prof.map(([o, h], j) => ({ p: pt(i, side * (half + o), h * (style.kerbHeight ?? 1)), uv: [j / 3, s / 3.8] })));
          kerbOpen = true;
        } else if (kerbOpen) { kerbB.cut(); kerbOpen = false; }
        // ランオフ（草以外）
        const inner = half + kw, outer = inner + rw;
        for (const t of RUNOFF_TYPES) {
          if (t === 'grass') continue;
          if (rt === t && rw > 0.3) {
            const b = runB[t] || (runB[t] = new RibbonBuilder());
            b.row([0, 0.5, 1].map((f) => { const d = side * (inner + rw * f); const p = pt(i, d, -0.02 - f * 0.04); return { p, uv: [p[0] / 8, p[2] / 8] }; }));
            runOpen[t] = true;
          } else if (runOpen[t]) { runB[t].cut(); runOpen[t] = false; }
        }
        // 草地：ランオフ（草以外）の外側 or 舗装の端から、壁の外 verge m まで。外側の端は地面の高さに合わせる
        const gIn = rt === 'grass' ? inner : outer;
        const gOut = Math.max(gIn + 1, e.barrierD[k] + e.verge[k]);
        const row = [];
        const N = 5;
        for (let j = 0; j <= N; j++) {
          const f = j / N, d = side * (gIn + (gOut - gIn) * f);
          const p = pt(i, d, -0.03);
          const gy = heightFn(p[0], p[2]);
          const w = smooth(0.25, 1, f);
          p[1] = p[1] * (1 - w) + gy * w;
          row.push({ p, uv: [p[0] / 8, p[2] / 8] });
        }
        // 外側に少しだけ地面へもぐるすそ（地面との継ぎ目を隠す）
        const pe = pt(i, side * (gOut + 2), 0); pe[1] = heightFn(pe[0], pe[2]) - 0.45;
        row.push({ p: pe, uv: [pe[0] / 8, pe[2] / 8] });
        vergeB.row(side > 0 ? row : row.slice().reverse());
      }
      add(kerbB.build(side < 0), style.kerbMat || MAT.kerb());
      for (const t in runB) add(runB[t].build(side < 0), runoffMat[t]);
      add(vergeB.build(), vergeMat);
    }
    // ---- 白線 ----
    const marks = style.markings ?? [{ edge: -1, inset: 0.3, w: 0.15 }, { edge: 1, inset: 0.3, w: 0.15 }];
    const byColor = {};
    for (const m of marks) {
      const b = byColor[m.color || 'white'] || (byColor[m.color || 'white'] = new RibbonBuilder());
      let open = false;
      for (let i = c0; i <= c1; i++) {
        const k = P(i), s = i * ds;
        let on = (m.from == null || s >= m.from) && (m.to == null || s <= m.to);
        if (on && m.dash) { const per = m.dash[0] + m.dash[1]; on = ((s + (m.phase || 0)) % per + per) % per < m.dash[0]; }
        if (!on) { if (open) { b.cut(); open = false; } continue; }
        const half = track.half[k];
        const dc = m.edge ? m.edge * (half - (m.inset || 0.3) - m.w / 2) : (m.d || 0);
        b.row([dc - m.w / 2, dc + m.w / 2].map((d, j) => ({ p: pt(i, d, 0.012), uv: [j, s] })));
        open = true;
      }
    }
    for (const col in byColor) add(byColor[col].build(), col === 'yellow' ? MAT.lineYellow() : MAT.line());
    // ---- 壁 ----
    if (style.barriers !== false) for (const side of [-1, 1]) buildBarriers(track, side, c0, c1, add, pt);
    chunk.updateMatrixWorld(true);
    group.add(chunk);
  }
  return group;
}

// 道の脇の地面の高さ（buildTrackMeshes の草地の帯と同じ式）。景色の物を地面に置くときに使う
export function groundHeight(track, heightFn, s, d) {
  const side = d >= 0 ? 1 : -1, a = Math.abs(d), e = track.edgeAt(s, side), half = track.halfWidth(s, side);
  const inner = half + e.kerb, rt = e.runoff;
  const gIn = rt === 'grass' ? inner : inner + e.runoffW;
  const gOut = Math.max(gIn + 1, e.barrierD + e.verge);
  const roadY = track.heightAt(s, d);
  if (a <= gIn) return roadY - (a > half ? 0.03 : 0);
  if (a >= gOut) { const p = track.toWorld(s, d, 0, _v1); return heightFn(p.x, p.z); }
  const f = (a - gIn) / (gOut - gIn), w = smooth(0.25, 1, f);
  const p = track.toWorld(s, d, 0, _v1);
  return (roadY - 0.03) * (1 - w) + heightFn(p.x, p.z) * w;
}

// 壁（ガードレール・タイヤバリア・コンクリート壁・金網）。種類ごとに区間をまとめて押し出す
function buildBarriers(track, side, c0, c1, add, pt) {
  const e = track.edges[side], n = track.n, ds = track.ds;
  const P = (i) => (track.closed ? (i % n + n) % n : clamp(i, 0, n - 1));
  // 断面: [横(外向き +), 高さ]
  const PROF = {
    // 角は同じ点を 2 回並べて、陰影がなめらかにつながらないようにする
    armco: [[0, 0.42], [-0.07, 0.51], [0, 0.61], [-0.07, 0.71], [0, 0.8], [0, 0.8], [0.03, 0.8], [0.03, 0.8], [0.03, 0.42]],
    tires: [[-0.1, 0], [-0.1, 0.95], [-0.1, 0.95], [0.75, 0.95], [0.75, 0.95], [0.75, 0]],
    wall: [[-0.25, 0], [-0.12, 0.25], [-0.08, 0.95], [-0.08, 0.95], [0.25, 0.95], [0.25, 0.95], [0.25, 0]],
    fence: [[-0.15, 0], [-0.15, 1.0], [-0.15, 1.0], [0.15, 1.0], [0.15, 1.0], [0.15, 0]],
  };
  const runs = {};
  for (let i = c0; i <= c1; i++) {
    const k = P(i), t = BARRIER_TYPES[e.barrierT[k]];
    for (const name in PROF) {
      const on = t === name;
      const r = runs[name] || (runs[name] = { b: new RibbonBuilder(), open: false, posts: [] });
      if (on) {
        const D = e.barrierD[k], s = i * ds, prof = PROF[name];
        // 断面の点を外向きに並べる（右側は + 方向、左側は - 方向）
        const maxH = prof.reduce((m, q) => Math.max(m, q[1]), 0);
        const row = prof.map(([o, h]) => ({ p: pt(i, side * (D + o), h), uv: [s / 4, h / maxH] }));
        r.b.row(side > 0 ? row : row.slice().reverse());
        r.open = true;
        if ((name === 'armco' && i % Math.round(2 / ds) === 0) || (name === 'fence' && i % Math.round(3 / ds) === 0)) r.posts.push([i, D]);
      } else if (r.open) { r.b.cut(); r.open = false; }
    }
  }
  for (const name in runs) {
    const r = runs[name];
    const geo = r.b.build();
    if (!geo) continue;
    if (name === 'armco') add(geo, MAT.armco(), { cast: true });
    else if (name === 'tires') { add(geo, MAT.tires(), { cast: true }); }
    else if (name === 'wall') add(geo, MAT.concrete(), { cast: true });
    else if (name === 'fence') add(geo, MAT.concrete(), { cast: true });
    // 支柱（ガードレール）・金網（フェンス）
    if (r.posts.length && (name === 'armco' || name === 'fence')) {
      const geos = [];
      for (const [i, D] of r.posts) {
        const k = P(i);
        const h = name === 'armco' ? 0.8 : 4.2, w = name === 'armco' ? 0.1 : 0.08;
        const g = new THREE.BoxGeometry(w, h, w);
        const p = pt(i, side * (D + (name === 'armco' ? 0.09 : 0)), h / 2);
        g.rotateY(-track.heading[k]); g.translate(p[0], p[1], p[2]);
        geos.push(g);
      }
      add(mergeGeometries(geos), name === 'armco' ? MAT.darkSteel() : MAT.steel(), { cast: true });
      if (name === 'fence') {
        // 金網（壁の上 1.0〜4.0 m）
        const fb = new RibbonBuilder(); let last = -9;
        for (let i = c0; i <= c1; i++) {
          const k = P(i); if (BARRIER_TYPES[e.barrierT[k]] !== 'fence') { if (last >= 0) fb.cut(); last = -9; continue; }
          const D = e.barrierD[k], s = i * ds;
          fb.row([[1.0, 0], [4.0, 1]].map(([h, v]) => ({ p: pt(i, side * D, h), uv: [s / 3, v * 1.5] })));
          last = i;
        }
        const fg = fb.build(); if (fg) add(fg, MAT.fence(), { cast: false, shadow: false });
      }
    }
  }
}

// =====================================================================
// 帯（リボン）状のメッシュを行ごとに積んで作る道具。row([{p:[x,y,z], uv:[u,v]}, ...]) を同じ列数で積む。cut() で切れ目
// =====================================================================
export class RibbonBuilder {
  constructor() { this.parts = []; this.cur = []; }
  row(r) { if (this.cur.length && this.cur[0].length !== r.length) this.cut(); this.cur.push(r); }
  cut() { if (this.cur.length > 1) this.parts.push(this.cur); this.cur = []; }
  build(flip = false) {
    this.cut();
    if (!this.parts.length) return null;
    const pos = [], uv = [], idx = [];
    for (const rows of this.parts) {
      const cols = rows[0].length, base = pos.length / 3;
      for (const r of rows) for (const v of r) { pos.push(v.p[0], v.p[1], v.p[2]); uv.push(v.uv[0], v.uv[1]); }
      for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols - 1; j++) {
        const a = base + i * cols + j, b = a + 1, c = a + cols, d = c + 1;
        // 進行方向に積んだ行と、左→右に並んだ列で、上向きの面になる並び
        if (!flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}
