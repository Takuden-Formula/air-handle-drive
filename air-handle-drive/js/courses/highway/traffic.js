// 一般車：自分の車線を走る車（追い越す相手。当たるとコーンと同じ +1 秒）・反対車線・立体交差のランプの車。
// 車の形は手続きで作り、種類ごとに 1 つの InstancedMesh にまとめる（ボディの色はインスタンスの色、ランプは自前の属性で光らせる）。
//
// 当たり判定のしくみ：物理（physics.js の Sim）はコーン（{ s, d, r }）との当たりを見ているので、
// 一般車ごとに「身代わりのコーン」を作り、毎フレーム「車の中でプレイヤーにいちばん近い所」に動かして sim.cones の後ろに足す。
// （stage.cones には入れないので、コーンの見た目（effects.js）には出ない。当たると Sim が +1 秒・減速・イベントを出す）
import * as THREE from 'three';
import { LANES, TRAFFIC_V, SEC, oppEdges } from './layout.js';
import { tunnelFactor } from './tunnel.js';

// ---------------------------------------------------------------------
// 車の形を作る道具（三角形ごとに 位置・法線・色・UV・塗装の割合・ランプの種類・粗さ/金属感）
// ---------------------------------------------------------------------
class VB {
  constructor() { this.P = []; this.N = []; this.C = []; this.U = []; this.paint = []; this.lamp = []; this.rm = []; }
  tri(a, b, c, o) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      this.P.push(p[0], p[1], p[2]); this.N.push(nx, ny, nz); this.C.push(o.c[0], o.c[1], o.c[2]);
      this.U.push(0.98, 0.98);
      this.paint.push(o.paint ? 1 : 0); this.lamp.push(o.lamp || 0); this.rm.push(o.rough ?? 0.5, o.metal ?? 0);
    }
  }
  quad(a, b, c, d, o) { this.tri(a, b, c, o); this.tri(a, c, d, o); }
  // 箱（下の面の中心 (x, y, z)、幅 w・高さ h・長さ l）。top: 上の面の縮み { w, l, dz }（ボンネットの傾き・ガラスの傾き）
  box(x, y, z, w, h, l, o, top = null) {
    const tw = top ? top.w : w, tl = top ? top.l : l, tz = top ? (top.dz || 0) : 0;
    const b = [[x - w / 2, y, z - l / 2], [x + w / 2, y, z - l / 2], [x + w / 2, y, z + l / 2], [x - w / 2, y, z + l / 2]];
    const t = [[x - tw / 2, y + h, z + tz - tl / 2], [x + tw / 2, y + h, z + tz - tl / 2], [x + tw / 2, y + h, z + tz + tl / 2], [x - tw / 2, y + h, z + tz + tl / 2]];
    const f = o.faces || {};
    if (f.top !== false) this.quad(t[0], t[3], t[2], t[1], f.topO || o);
    if (f.bottom) this.quad(b[0], b[1], b[2], b[3], o);
    this.quad(b[0], t[0], t[1], b[1], f.frontO || o);     // 前（-Z）
    this.quad(b[2], t[2], t[3], b[3], f.backO || o);      // 後ろ（+Z）
    this.quad(b[3], t[3], t[0], b[0], f.sideO || o);      // 左
    this.quad(b[1], t[1], t[2], b[2], f.sideO || o);      // 右
  }
  // タイヤ（X 軸まわりの円柱）
  wheel(x, y, z, r, w, o, hub) {
    const n = 12, side = Math.sign(x) || 1;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      const p0 = [y + Math.cos(a0) * r, z + Math.sin(a0) * r], p1 = [y + Math.cos(a1) * r, z + Math.sin(a1) * r];
      const xi = x - side * w / 2, xo = x + side * w / 2;
      if (side > 0) this.quad([xi, p0[0], p0[1]], [xi, p1[0], p1[1]], [xo, p1[0], p1[1]], [xo, p0[0], p0[1]], o);
      else this.quad([xo, p0[0], p0[1]], [xo, p1[0], p1[1]], [xi, p1[0], p1[1]], [xi, p0[0], p0[1]], o);
      // 外側の面（ホイール）
      const c = [xo, y, z], hr = r * 0.62;
      const q0 = [xo + side * 0.005, y + Math.cos(a0) * hr, z + Math.sin(a0) * hr], q1 = [xo + side * 0.005, y + Math.cos(a1) * hr, z + Math.sin(a1) * hr];
      const r0 = [xo, p0[0], p0[1]], r1 = [xo, p1[0], p1[1]];
      if (side > 0) { this.tri(c, q0, q1, hub); this.quad(q1, q0, r0, r1, o); } else { this.tri(c, q1, q0, hub); this.quad(q0, q1, r1, r0, o); }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('aPaint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.setAttribute('aLamp', new THREE.Float32BufferAttribute(this.lamp, 1));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.rm, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// 材質の種類
const M = {
  body: { c: [1, 1, 1], paint: true, rough: 0.28, metal: 0.55 },
  glass: { c: [0.04, 0.05, 0.06], rough: 0.12, metal: 0.0 },
  dark: { c: [0.06, 0.06, 0.065], rough: 0.7, metal: 0.1 },
  grey: { c: [0.28, 0.29, 0.3], rough: 0.6, metal: 0.2 },
  chrome: { c: [0.8, 0.8, 0.82], rough: 0.2, metal: 1.0 },
  tire: { c: [0.035, 0.035, 0.04], rough: 0.9, metal: 0 },
  hub: { c: [0.6, 0.62, 0.65], rough: 0.35, metal: 0.9 },
  tail: { c: [1.0, 0.04, 0.02], rough: 0.3, metal: 0, lamp: 1 },
  head: { c: [1.0, 0.95, 0.82], rough: 0.2, metal: 0, lamp: 2 },
  amber: { c: [1.0, 0.45, 0.02], rough: 0.3, metal: 0, lamp: 3 },
  marker: { c: [1.0, 0.55, 0.08], rough: 0.3, metal: 0, lamp: 4 },
  cargo: { c: [0.86, 0.87, 0.88], rough: 0.4, metal: 0.45 },
  white: { c: [0.9, 0.9, 0.88], rough: 0.45, metal: 0.1 },
  plate: { c: [0.92, 0.92, 0.85], rough: 0.5, metal: 0 },
  room: { c: [1.0, 0.8, 0.55], rough: 0.2, metal: 0, lamp: 4 },
};
const withFaces = (o, faces) => ({ ...o, faces });

// 乗用車（セダン）。-Z が前、原点は前後の真ん中の地面
function sedan(vb, { L = 4.65, W = 1.78, H = 1.43, clear = 0.3, hood = 1.25, trunk = 0.95 } = {}) {
  const zf = -L / 2, zr = L / 2;
  vb.box(0, clear, 0, W, 0.55, L, M.body, { w: W - 0.06, l: L - 0.1 });
  // ボンネットとトランクの上面は少し丸める（低い箱）
  vb.box(0, clear + 0.55, zf + hood / 2 + 0.05, W - 0.08, 0.06, hood, M.body, { w: W - 0.2, l: hood - 0.1 });
  vb.box(0, clear + 0.55, zr - trunk / 2 - 0.05, W - 0.08, 0.1, trunk, M.body, { w: W - 0.2, l: trunk - 0.1 });
  // キャビン（ガラス）と屋根
  const cl = L - hood - trunk - 0.1, cz = zf + hood + cl / 2 + 0.05;
  vb.box(0, clear + 0.55, cz, W - 0.12, H - clear - 0.6, cl, withFaces(M.glass, { top: false }), { w: W - 0.36, l: cl - 0.95, dz: 0.12 });
  vb.box(0, H - 0.06, cz + 0.12, W - 0.36, 0.06, cl - 0.95, M.body, { w: W - 0.42, l: cl - 1.05 });
  lightsAndWheels(vb, { L, W, clear, tailY: clear + 0.42, headY: clear + 0.36, r: 0.33, wb: L * 0.6 });
}
function kei(vb) {
  const L = 3.39, W = 1.47, H = 1.75, clear = 0.22;
  vb.box(0, clear, 0, W, 0.62, L, M.body, { w: W - 0.04, l: L - 0.12 });
  vb.box(0, clear + 0.62, -L / 2 + 0.36, W - 0.08, 0.08, 0.66, M.body, { w: W - 0.16, l: 0.58 });
  vb.box(0, clear + 0.62, 0.36, W - 0.06, H - clear - 0.68, L - 0.82, withFaces(M.glass, { top: false }), { w: W - 0.2, l: L - 1.05, dz: 0.1 });
  vb.box(0, H - 0.06, 0.46, W - 0.2, 0.06, L - 1.05, M.body);
  lightsAndWheels(vb, { L, W, clear, tailY: clear + 0.62, headY: clear + 0.45, r: 0.28, wb: 2.45, tailTall: true });
}
function minivan(vb, { L = 4.7, W = 1.82, H = 1.86, clear = 0.25 } = {}) {
  vb.box(0, clear, 0, W, 0.65, L, M.body, { w: W - 0.05, l: L - 0.15 });
  vb.box(0, clear + 0.65, -L / 2 + 0.5, W - 0.08, 0.08, 0.95, M.body, { w: W - 0.18, l: 0.85 });
  vb.box(0, clear + 0.65, 0.42, W - 0.08, H - clear - 0.72, L - 1.0, withFaces(M.glass, { top: false }), { w: W - 0.22, l: L - 1.45, dz: 0.18 });
  vb.box(0, H - 0.07, 0.6, W - 0.22, 0.07, L - 1.45, M.body);
  lightsAndWheels(vb, { L, W, clear, tailY: clear + 0.75, headY: clear + 0.48, r: 0.33, wb: 2.85, tailTall: true });
}
function suv(vb) {
  const L = 4.65, W = 1.86, H = 1.72, clear = 0.42;
  vb.box(0, clear, 0, W, 0.6, L, M.body, { w: W - 0.05, l: L - 0.14 });
  vb.box(0, clear + 0.6, -L / 2 + 0.6, W - 0.08, 0.08, 1.15, M.body, { w: W - 0.2, l: 1.05 });
  vb.box(0, clear + 0.6, 0.45, W - 0.1, H - clear - 0.68, L - 1.3, withFaces(M.glass, { top: false }), { w: W - 0.3, l: L - 1.9, dz: 0.2 });
  vb.box(0, H - 0.08, 0.62, W - 0.3, 0.08, L - 1.9, M.body);
  vb.box(0, 0.05, 0, W - 0.3, clear - 0.05, L - 1.6, M.dark);
  lightsAndWheels(vb, { L, W, clear, tailY: clear + 0.42, headY: clear + 0.38, r: 0.37, wb: 2.7 });
}
// 商用バン（ハイエース風）
function van(vb) {
  const L = 4.7, W = 1.7, H = 1.98, clear = 0.2;
  vb.box(0, clear, 0, W, 0.75, L, M.body, { w: W - 0.03, l: L - 0.08 });
  vb.box(0, clear + 0.75, 0.15, W - 0.04, H - clear - 0.8, L - 0.35, withFaces(M.body, { frontO: M.glass }), { w: W - 0.1, l: L - 0.75, dz: 0.2 });
  // 横の窓
  vb.box(0, clear + 0.95, 0.4, W + 0.01, 0.6, L - 1.8, withFaces(M.glass, { top: false }));
  vb.box(0, H - 0.05, 0.35, W - 0.1, 0.05, L - 0.8, M.body);
  lightsAndWheels(vb, { L, W, clear, tailY: clear + 0.6, headY: clear + 0.55, r: 0.31, wb: 2.57, tailTall: true });
}
// ランプ・バンパー・ナンバー・タイヤ（乗用車共通）
function lightsAndWheels(vb, { L, W, clear, tailY, headY, r, wb, tailTall = false }) {
  const zf = -L / 2, zr = L / 2;
  vb.box(0, clear - 0.05, zf + 0.08, W + 0.02, 0.24, 0.2, M.grey);                 // 前のバンパー
  vb.box(0, clear - 0.05, zr - 0.08, W + 0.02, 0.24, 0.2, M.grey);                 // 後ろのバンパー
  vb.box(0, clear + 0.06, zr + 0.025, 0.33, 0.16, 0.02, M.plate);                  // ナンバー
  vb.box(0, clear + 0.08, zf - 0.025, 0.33, 0.16, 0.02, M.plate);
  vb.box(0, clear + 0.22, zf - 0.02, W * 0.42, 0.14, 0.03, M.dark);                // グリル
  for (const sx of [-1, 1]) {
    vb.box(sx * (W / 2 - 0.22), headY, zf - 0.015, 0.34, 0.12, 0.04, M.head);
    if (tailTall) vb.box(sx * (W / 2 - 0.1), tailY - 0.25, zr + 0.015, 0.16, 0.42, 0.04, M.tail);
    else vb.box(sx * (W / 2 - 0.25), tailY, zr + 0.015, 0.42, 0.13, 0.04, M.tail);
    vb.box(sx * (W / 2 - 0.12), headY - 0.12, zf - 0.02, 0.12, 0.06, 0.04, M.amber);
    vb.box(sx * (W / 2 + 0.05), clear + 0.7, zf + 1.0, 0.1, 0.1, 0.18, M.dark);    // ドアミラー
    for (const sz of [-1, 1]) vb.wheel(sx * (W / 2 - 0.13), r, sz * wb / 2, r, 0.22, M.tire, M.hub);
  }
  vb.box(0, 0.08, 0, W - 0.3, clear - 0.06, L - 0.8, M.dark);                      // 床下
}
// 大型トラック（アルミのウイング車）。cab の色は塗装（インスタンスの色）
function truck(vb) {
  const L = 11.6, W = 2.49, H = 3.7, zf = -L / 2;
  const cabL = 2.25, cabH = 3.15;
  // キャブ
  vb.box(0, 0.9, zf + cabL / 2, W, cabH - 0.9, cabL, withFaces(M.body, { frontO: M.body }), { w: W - 0.08, l: cabL - 0.25, dz: 0.12 });
  vb.box(0, 1.85, zf - 0.005, W - 0.22, 1.05, 0.04, M.glass, { w: W - 0.3, l: 0.04, dz: 0.1 });     // フロントガラス
  vb.box(0, cabH, zf + cabL / 2 + 0.12, W - 0.08, 0.32, cabL - 0.3, M.body, { w: W - 0.3, l: cabL - 0.6 });   // 屋根のエアデフレクタ
  vb.box(0, 0.45, zf + 0.12, W, 0.5, 0.25, M.grey);                                                  // バンパー
  for (const sx of [-1, 1]) {
    vb.box(sx * (W / 2 - 0.3), 0.7, zf - 0.01, 0.42, 0.16, 0.04, M.head);
    vb.box(sx * (W / 2 - 0.06), 1.95, zf + 0.5, 0.06, 0.65, 0.9, M.glass);                          // 横の窓
    vb.box(sx * (W / 2 + 0.25), 1.6, zf + 0.15, 0.06, 0.55, 0.2, M.dark);                           // ミラー
  }
  for (let i = 0; i < 5; i++) vb.box((i - 2) * 0.32, cabH + 0.32, zf + 0.3, 0.14, 0.08, 0.1, M.marker);   // 屋根の上のマーカー
  // 荷台（ウイング）
  const bz0 = zf + cabL + 0.15, bl = L - cabL - 0.2;
  vb.box(0, 1.2, bz0 + bl / 2, W, H - 1.2, bl, M.cargo);
  vb.box(0, 1.08, bz0 + bl / 2, W - 0.05, 0.12, bl, M.grey);
  // 横の看板（UV でロゴの所を使う）
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.008), y0 = 1.7, y1 = 3.2, z0 = bz0 + 0.6, z1 = bz0 + bl - 0.6;
    const a = [x, y0, z0], b = [x, y0, z1], c = [x, y1, z1], d = [x, y1, z0];
    const uvOf = (p) => [(p[2] - z0) / (z1 - z0), (p[1] - y0) / (y1 - y0)];
    logoQuad(vb, sx > 0 ? [b, a, d, c] : [a, b, c, d], uvOf, sx > 0);
  }
  // 車台・タイヤ
  vb.box(0, 0.45, 0, W - 0.7, 0.55, L - 1.0, M.dark);
  for (const sx of [-1, 1]) {
    vb.wheel(sx * (W / 2 - 0.2), 0.52, zf + 1.4, 0.52, 0.32, M.tire, M.hub);
    for (const z of [L / 2 - 3.2, L / 2 - 1.9]) vb.wheel(sx * (W / 2 - 0.2), 0.52, z, 0.52, 0.5, M.tire, M.hub);
    // 横のマーカーランプ（デコトラほどではないが、夕方に光る）
    for (let z = bz0 + 0.8; z < L / 2 - 0.5; z += 1.5) vb.box(sx * (W / 2 + 0.01), 0.98, z, 0.03, 0.08, 0.14, M.marker);
    // 後ろのランプ（3 連）
    for (let k = 0; k < 3; k++) vb.box(sx * (W / 2 - 0.25 - k * 0.24), 0.62, L / 2 + 0.02, 0.18, 0.14, 0.04, k === 2 ? M.amber : M.tail);
  }
  vb.box(0, 0.45, L / 2 - 0.05, W - 0.1, 0.12, 0.12, M.grey);                 // 突入防止のバー
  vb.box(0, 2.0, L / 2 + 0.01, W - 0.1, 1.5, 0.02, M.cargo);                  // 後ろの扉（縦のすじは省略）
}
// 看板の四角（UV 0〜1 をロゴの範囲に当てる）
function logoQuad(vb, [a, b, c, d], uvOf, flip) {
  const o = { c: [1, 1, 1], rough: 0.45, metal: 0.2 };
  const tri = (p, q, r) => {
    vb.tri(p, q, r, o);
    // tri() は UV を 0.98 にするので、ここで書き換える（ロゴの範囲：アトラスの左下 0〜0.75 × 0〜0.5）
    const n = vb.U.length;
    [p, q, r].forEach((pt, i) => { const [u, v] = uvOf(pt); vb.U[n - 6 + i * 2] = (flip ? 1 - u : u) * 0.75; vb.U[n - 6 + i * 2 + 1] = v * 0.5; });
  };
  tri(a, b, c); tri(a, c, d);
}
// 高速バス
function bus(vb) {
  const L = 12, W = 2.49, H = 3.55, zf = -L / 2;
  vb.box(0, 0.4, 0, W, H - 0.45, L, withFaces(M.body, {}), { w: W - 0.06, l: L - 0.2 });
  // 窓の帯（室内の明かり）・前のガラス
  for (const sx of [-1, 1]) vb.box(sx * 0.004, 1.95, 0.6, W + 0.01, 1.05, L - 2.2, withFaces(M.room, { top: false }));
  vb.box(0, 1.25, zf - 0.005, W - 0.2, 1.75, 0.04, M.glass, { w: W - 0.3, l: 0.04, dz: 0.12 });
  vb.box(0, 0.75, zf + 0.0, W - 0.1, 0.2, 0.03, M.dark);
  for (const sx of [-1, 1]) {
    vb.box(sx * (W / 2 - 0.3), 0.75, zf - 0.02, 0.38, 0.14, 0.04, M.head);
    vb.box(sx * (W / 2 - 0.15), 1.1, L / 2 + 0.02, 0.16, 0.5, 0.04, M.tail);
    vb.wheel(sx * (W / 2 - 0.2), 0.5, zf + 2.6, 0.5, 0.3, M.tire, M.hub);
    vb.wheel(sx * (W / 2 - 0.2), 0.5, L / 2 - 2.8, 0.5, 0.45, M.tire, M.hub);
  }
  vb.box(0, 0.4, L / 2 - 0.05, W - 0.1, 0.35, 0.12, M.grey);
  vb.box(0, H - 0.08, 0.5, W - 0.6, 0.18, 3.0, M.grey);   // 屋根のエアコン
}

export const TYPES = {
  sedan: { make: (vb) => sedan(vb), len: 4.65, half: 0.89, colors: ['white', 'silver', 'black', 'navy', 'red', 'grey', 'white', 'pearl', 'blue'] },
  kei: { make: kei, len: 3.4, half: 0.74, colors: ['white', 'pink', 'beige', 'silver', 'lightblue', 'black', 'yellow'] },
  minivan: { make: (vb) => minivan(vb), len: 4.7, half: 0.91, colors: ['white', 'black', 'silver', 'pearl', 'navy', 'grey'] },
  suv: { make: suv, len: 4.65, half: 0.93, colors: ['white', 'black', 'green', 'grey', 'red', 'silver'] },
  van: { make: van, len: 4.7, half: 0.85, colors: ['white', 'white', 'silver'] },
  truck: { make: truck, len: 11.6, half: 1.25, colors: ['white', 'green', 'blue', 'white', 'orange', 'grey'] },
  bus: { make: bus, len: 12, half: 1.25, colors: ['busA', 'busB'] },
};
const COLORS = {
  white: [0.86, 0.87, 0.88], pearl: [0.92, 0.9, 0.84], silver: [0.58, 0.6, 0.63], grey: [0.26, 0.27, 0.29], black: [0.025, 0.025, 0.03],
  navy: [0.03, 0.06, 0.16], red: [0.5, 0.03, 0.03], blue: [0.05, 0.14, 0.42], pink: [0.85, 0.6, 0.62], beige: [0.74, 0.66, 0.52],
  lightblue: [0.45, 0.62, 0.74], yellow: [0.86, 0.68, 0.12], green: [0.08, 0.3, 0.18], orange: [0.8, 0.32, 0.05],
  busA: [0.88, 0.88, 0.9], busB: [0.12, 0.34, 0.62],
};

// ---------------------------------------------------------------------
// 材質（ボディの色・ランプ・トンネルの中の暗さ）
// ---------------------------------------------------------------------
let atlas = null;
function logoAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 512);
  // 左下（UV 0〜0.75 × 0〜0.5 → キャンバスの 0〜768 × 256〜512）：トラックの荷台の看板
  const x0 = 0, y0 = 256, w = 768, h = 256;
  const gr = g.createLinearGradient(x0, 0, x0 + w, 0); gr.addColorStop(0, '#e9ecef'); gr.addColorStop(1, '#d5dade');
  g.fillStyle = gr; g.fillRect(x0, y0, w, h);
  g.fillStyle = '#0f4fb4'; g.fillRect(x0, y0 + h * 0.66, w, h * 0.12);
  g.fillStyle = '#e53935'; g.fillRect(x0, y0 + h * 0.8, w, h * 0.05);
  g.fillStyle = '#0f2f6b'; g.font = `900 ${h * 0.3}px "Meiryo","Yu Gothic UI",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('拓殖運輸', x0 + w * 0.36, y0 + h * 0.36);
  g.font = `700 ${h * 0.13}px "Meiryo","Yu Gothic UI",sans-serif`; g.fillStyle = '#334';
  g.fillText('TAKUDEN LOGISTICS ・ EV FREIGHT', x0 + w * 0.36, y0 + h * 0.56);
  g.fillStyle = '#ffc928'; g.beginPath(); g.arc(x0 + w * 0.83, y0 + h * 0.38, h * 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0f2f6b'; g.font = `900 ${h * 0.24}px sans-serif`; g.fillText('⚡', x0 + w * 0.83, y0 + h * 0.39);
  atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  return atlas;
}
let trafficMat = null;
export function trafficMaterial() {
  if (trafficMat) return trafficMat;
  const m = new THREE.MeshStandardMaterial({ name: 'hw-traffic', vertexColors: true, map: logoAtlas(), roughness: 0.5, metalness: 0.3, envMapIntensity: 1.1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPaint; attribute float aLamp; attribute vec2 aRM; attribute vec4 iLamp; attribute float iShade;
varying float vLamp; varying vec4 vILamp; varying vec2 vRM; varying float vShade;`)
      .replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aPaint );
#endif
  vLamp = aLamp; vILamp = iLamp; vRM = aRM; vShade = iShade;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vLamp; varying vec4 vILamp; varying vec2 vRM; varying float vShade;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float k = 0.0;
    if (vLamp > 0.5 && vLamp < 1.5) k = vILamp.x; else if (vLamp > 1.5 && vLamp < 2.5) k = vILamp.y;
    else if (vLamp > 2.5 && vLamp < 3.5) k = vILamp.z; else if (vLamp > 3.5) k = vILamp.w;
    totalEmissiveRadiance += vColor.rgb * k;
  }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.directDiffuse *= vShade; reflectedLight.directSpecular *= vShade;
  reflectedLight.indirectSpecular *= mix(0.15, 1.0, vShade);
  reflectedLight.indirectDiffuse *= mix(vec3(1.25, 0.72, 0.36), vec3(1.0), vShade);`);
  };
  m.customProgramCacheKey = () => 'hw-traffic-v1';
  trafficMat = m;
  return m;
}

// ---------------------------------------------------------------------
// 一般車の管理
// ---------------------------------------------------------------------
export function buildTraffic(ctx) {
  const { track, group, layout } = ctx;
  const L = track.length;
  const plan = layout.traffic || [];
  const rnd = ctx.rnd;
  const mat = trafficMaterial();
  // 反対車線・ランプの車（見た目だけ）
  const OPP_N = 18, FLY_N = 6;
  const pickType = (big) => (big ? (rnd() < 0.75 ? 'truck' : 'bus') : ['sedan', 'sedan', 'kei', 'minivan', 'suv', 'van'][Math.floor(rnd() * 6)]);
  const cars = [];
  const colorOf = (type, seed) => { const list = TYPES[type].colors; return COLORS[list[seed % list.length]]; };
  for (const p of plan) cars.push({ kind: 'lane', type: p.type, s0: p.s0, lane: p.lane, color: colorOf(p.type, p.seed), s: p.s0, d: LANES[p.lane], v: TRAFFIC_V, brake: 0, hitT: -1, proxy: null, sway: (p.seed % 100) / 100 * 6.28 });
  for (let i = 0; i < OPP_N; i++) { const type = pickType(rnd() < 0.3); cars.push({ kind: 'opp', type, color: colorOf(type, Math.floor(rnd() * 99)), s: 0, lane: rnd() < 0.55 ? 2 : rnd() < 0.7 ? 1 : 0, v: 20 + rnd() * 6, d: 0, init: false, sway: rnd() * 6.28 }); }
  for (let i = 0; i < FLY_N; i++) { const type = pickType(rnd() < 0.2); cars.push({ kind: 'fly', type, color: colorOf(type, Math.floor(rnd() * 99)), t: rnd(), dir: i % 2 ? 1 : -1, v: 17 + rnd() * 5 }); }
  // 種類ごとの InstancedMesh
  const meshes = {};
  for (const type of Object.keys(TYPES)) {
    const list = cars.filter((c) => c.type === type);
    if (!list.length) continue;
    const vb = new VB(); TYPES[type].make(vb);
    const geo = vb.build();
    const n = list.length;
    const iLamp = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iShade = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iLamp', iLamp); geo.setAttribute('iShade', iShade);
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.name = 'hw-traffic-' + type; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
    const col = new THREE.Color();
    list.forEach((c, i) => { c.mesh = im; c.idx = i; im.setColorAt(i, col.setRGB(...c.color)); });
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(im);
    meshes[type] = { im, iLamp, iShade };
  }
  // 身代わりのコーン（自分の車線の車だけ）
  const proxies = [];
  for (const c of cars) if (c.kind === 'lane') { c.proxy = { s: -1e6, d: c.d, r: TYPES[c.type].half, kind: 'obstacle', traffic: true, hit: false }; proxies.push(c.proxy); }

  const fly = ctx.flyover || null;
  let flyLen = 0; const flyCum = [];
  if (fly) { flyCum.push(0); for (let i = 1; i < fly.length; i++) { flyLen += Math.hypot(fly[i].x - fly[i - 1].x, fly[i].z - fly[i - 1].z); flyCum.push(flyLen); } }

  let clock = 0, lastState = '', lastDist = 0, myCones = null, time = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

  const reset = (tc) => {
    clock = tc;
    for (const c of cars) if (c.kind === 'lane') { c.s = c.s0 + TRAFFIC_V * tc; c.v = TRAFFIC_V; c.d = LANES[c.lane]; c.hitT = -1; c.brake = 0; c.proxy.hit = false; }
  };
  reset(0);

  // 反対車線の車を、ref（プレイヤーの位置）のまわりに並べ直す
  const placeOpp = (c, ref, ahead) => {
    const lo = Math.max(SEC.taperEnd + 10, ref - 220), hi = Math.min(L - 20, ref + 760);
    c.s = ahead ? hi - rnd() * 140 : lo + rnd() * (hi - lo);
  };

  function update(dt, info) {
    if (!info) return;
    time += dt;
    const sim = info.sim, state = info.state;
    // ---- 時計（スタートのランプから。待機中のデモは走り出しから）----
    if (state !== lastState) {
      if (state === 'lights') reset(-3.8);
      else if (state === 'idle' && lastState !== 'select') reset(0);
      lastState = state;
    }
    if (sim && state === 'idle' && sim.dist < lastDist - 30) reset(0);
    lastDist = sim ? sim.dist : 0;
    clock += dt;
    // ---- プレイヤーの位置 ----
    const pS = sim && sim.track === track ? sim.startS + sim.dist : -1e9, pD = sim ? sim.d : 0, pV = sim ? sim.speed : 0;
    // ---- 身代わりのコーンを sim.cones に足す ----
    if (sim && sim.track === track && proxies.length && sim.cones !== myCones) {
      const base = (sim.cones || []).filter((c) => !c.traffic);
      myCones = base.concat(proxies); sim.cones = myCones;
    }
    // ---- 自分の車線の車 ----
    for (const c of cars) {
      if (c.kind !== 'lane') continue;
      const T = TYPES[c.type];
      // 当たったら：ハザードをつけて少し減速（並びは変わるが、当たった車はもう追い越した後）
      if (c.proxy.hit && c.hitT < 0) c.hitT = time;
      let target = TRAFFIC_V;
      // プレイヤーのすぐ後ろ（追い越された後）で同じ車線なら、ぶつからないように合わせる
      const gap = pS - (c.s + T.len / 2) - 1.5;
      if (gap > -0.5 && gap < 22 && Math.abs(pD - c.d) < 2.2 && pV < TRAFFIC_V) target = Math.max(0, pV - 0.5);
      if (c.hitT >= 0) target = Math.min(target, TRAFFIC_V * 0.85);
      const acc = target < c.v ? -4.5 : 1.6;
      c.v = target < c.v ? Math.max(target, c.v + acc * dt) : Math.min(target, c.v + acc * dt);
      c.brake = target < TRAFFIC_V - 0.5 || acc < 0 && c.v > target + 0.2 ? 1 : Math.max(0, c.brake - dt * 2);
      c.s += c.v * dt;
      // 当たった後、プレイヤーが離れたらまた当たるようにする（同じ車に何度もぶつかれば何度も +1 秒）
      if (c.proxy.hit && (Math.abs(pS - c.s) > T.len / 2 + 4 || Math.abs(pD - c.d) > T.half + 1.6)) c.proxy.hit = false;
      // 身代わりのコーン：車の前後の範囲で、プレイヤーにいちばん近い所
      const vis = c.s > 52 && c.s < L - 12;
      c.proxy.s = vis ? Math.max(c.s - T.len / 2, Math.min(c.s + T.len / 2, pS)) : -1e6;
      c.proxy.d = c.d; c.proxy.r = T.half;
    }
    // ---- 反対車線 ----
    const ref = pS > -1e8 ? Math.max(pS, SEC.taperEnd) : SEC.taperEnd + 200;
    for (const c of cars) {
      if (c.kind !== 'opp') continue;
      if (!c.init) { placeOpp(c, ref, false); c.init = true; }
      c.s -= c.v * dt;
      if (c.s < ref - 240 || c.s < SEC.taperEnd + 5 || c.s > L - 15) placeOpp(c, ref, true);
      const e = oppEdges(c.s);
      c.d = e.lanesIn + 1.75 + 3.5 * c.lane;
    }
    // ---- 行列とランプ ----
    const blink = Math.sin(time * 9.4) > 0 ? 1 : 0;
    for (const c of cars) {
      const T = TYPES[c.type], ms = meshes[c.type];
      let shade = 1, vis = true;
      if (c.kind === 'fly') {
        if (!fly) { vis = false; }
        else {
          c.t = (c.t + c.dir * c.v * dt / flyLen + 1) % 1;
          const dist = c.t * flyLen;
          let i = 1; while (i < flyCum.length - 1 && flyCum[i] < dist) i++;
          const a = fly[i - 1], b = fly[i], u = (dist - flyCum[i - 1]) / Math.max(1e-6, flyCum[i] - flyCum[i - 1]);
          const ang = a.a + (b.a - a.a) * u, off = c.dir * 1.9;
          _p.set(a.x + (b.x - a.x) * u + Math.cos(ang) * off, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u + Math.sin(ang) * off);
          const slope = Math.atan2(b.y - a.y, flyCum[i] - flyCum[i - 1]);
          _q.setFromEuler(_e.set(c.dir > 0 ? slope : -slope, -ang + (c.dir > 0 ? 0 : Math.PI), 0, 'YXZ'));
          // 端（地面に下りた所）では隠す
          vis = c.t > 0.04 && c.t < 0.96;
        }
      } else {
        vis = c.kind === 'lane' ? c.s > 52 && c.s < L - 12 : true;
        if (vis) {
          const sway = Math.sin(time * 0.35 + c.sway) * 0.12;
          track.toWorld(c.s, c.d + sway, 0, _p);
          const yaw = -track.headingAt(c.s) + (c.kind === 'opp' ? Math.PI : 0);
          _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ'));
          shade = 1 - 0.88 * (c.kind === 'lane' ? tunnelFactor(c.s) : oppTunnel(c.s));
        }
      }
      if (vis) ms.im.setMatrixAt(c.idx, _m.compose(_p, _q, _s)); else ms.im.setMatrixAt(c.idx, _zero);
      const brake = c.brake || 0, haz = c.hitT >= 0 ? blink * 9 : 0;
      ms.iLamp.setXYZW(c.idx, 1.3 + brake * 6, 4.5, haz, c.type === 'bus' ? 1.3 : 3.0);
      ms.iShade.setX(c.idx, shade);
    }
    for (const k in meshes) { const ms = meshes[k]; ms.im.instanceMatrix.needsUpdate = true; ms.iLamp.needsUpdate = true; ms.iShade.needsUpdate = true; }
  }
  update(0, { state: 'idle', sim: null });   // 最初の位置（サムネイルを撮るときなど、まだ毎フレームの更新が来ていないとき用）
  return { update, cars, proxies, reset, get clock() { return clock; } };
}
// 反対車線のトンネル（自分と同じ区間）
const oppTunnel = (s) => tunnelFactor(s);
