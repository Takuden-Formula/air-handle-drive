// サーキット専用の景色の部品（メインスタンド・ピットビル・コントロールタワー・アーチ橋・旗・トラック…）。
// 部品のローカル座標は props.js と同じ：+Z が正面（コース側）、+Y が上、原点は地面。
// 動かない物は mb（MergeBuilder）に足す。単色の材質（MAT.color）は頂点カラーで自動的にまとまるので、
// 色を増やしても描画の呼び出しは増えない。粗さ・金属感の組み合わせは C の数種類だけ使う（まとまりやすくする）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT } from '../../engine/textures.js';
import { slotPlane } from './atlas.js';

// 底面が y の箱
export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
// 2 点を結ぶ円柱（支柱・斜めの材）
export function rod(a, b, r = 0.08, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// 色の材質（まとまりやすいように粗さ・金属感は数種類に固定）
export const C = {
  paint: (hex) => MAT.color(hex, { rough: 0.6 }),          // 塗装・コンクリートの色違い
  matte: (hex) => MAT.color(hex, { rough: 0.8 }),          // 布・地面・ゴム
  metal: (hex) => MAT.color(hex, { rough: 0.4, metal: 0.75 }),
  glass: (hex = 0x1f3a52) => MAT.color(hex, { rough: 0.1, metal: 1 }),   // 空が映るガラス（環境マップ）
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

// 足もとの土台（斜面に置いても浮かないよう、地面の下まで伸ばす）
function plinth(mb, m, w, d, depth = 3, color = 0x9ea3a8) { mb.add(box(w, depth, d, 0, -depth, 0), C.paint(color), m); }

// =====================================================================
// メイングランドスタンド：2 層の客席・通路・VIP 席（ガラス）・片持ちの大屋根（トラス）・屋根の看板・前の壁の広告
//   length: 長さ [m]、rows: 1 層目の段数。正面（+Z）がコース。原点は前の壁の足もと
// =====================================================================
export function mainGrandstand(mb, m, A, { length = 120, rows = 16, rows2 = 9, aisle = 16, roofColor = 0xe9edf1, seat = 0x1565c0 } = {}) {
  const stepH = 0.48, stepD = 0.82, base = 2.6;
  const D1 = rows * stepD, H1 = rows * stepH;
  const crowdGeo = [], seatGeo = [];
  // 客席（段の立ち上がりに観客のテクスチャ、通路は灰色の階段）
  const tier = (z0, y0, n, x0, x1) => {
    const P = [], U = [], I = [];
    for (let r = 0; r < n; r++) {
      const z = z0 - r * stepD, y = y0 + r * stepH, b = P.length / 3;
      P.push(x0, y, z, x1, y, z, x0, y + stepH, z, x1, y + stepH, z);
      P.push(x0, y + stepH, z, x1, y + stepH, z, x0, y + stepH, z - stepD, x1, y + stepH, z - stepD);
      const u0 = x0 / 12, u1 = x1 / 12, v0 = ((r * 7) % 4) / 4, v1 = v0 + 0.25;
      U.push(u0, v0, u1, v0, u0, v1, u1, v1, u0, v0 + 0.06, u1, v0 + 0.06, u0, v1 - 0.03, u1, v1 - 0.03);   // 座面にも観客の絵（上から見ても空席にならない）
      I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 4, b + 5, b + 6, b + 5, b + 7, b + 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
    crowdGeo.push(g);
  };
  const stairs = (z0, y0, n, x) => {   // 通路の階段（段ごとの箱）
    for (let r = 0; r < n; r++) seatGeo.push(box(1.4, stepH, stepD, x, y0 + r * stepH, z0 - r * stepD - stepD / 2));
  };
  const blocks = Math.max(1, Math.round(length / aisle)), bw = length / blocks;
  for (let b = 0; b < blocks; b++) {
    const x0 = -length / 2 + b * bw + 0.7, x1 = x0 + bw - 1.4;
    tier(0, base, rows, x0, x1);
    stairs(0, base, rows, x0 - 0.7);
  }
  stairs(0, base, rows, length / 2);
  // 2 層目（VIP 席の上）
  const z2 = -D1 - 3.2, y2 = base + H1 + 3.6;
  for (let b = 0; b < blocks; b++) { const x0 = -length / 2 + b * bw + 0.7, x1 = x0 + bw - 1.4; tier(z2, y2, rows2, x0, x1); stairs(z2, y2, rows2, x0 - 0.7); }
  stairs(z2, y2, rows2, length / 2);
  const D2 = rows2 * stepD, H2 = rows2 * stepH, back = z2 - D2;
  mb.add(mergeGeometries(crowdGeo.map((g) => g.toNonIndexed())), MAT.crowd(), m);
  mb.add(mergeGeometries(seatGeo.map((g) => g.toNonIndexed())), C.paint(0xb9bec4), m);
  // 骨組み：前の壁（広告）、1 層目の下の壁、VIP 席（ガラス）、2 層目の下、裏の壁、両側の壁
  const conc = C.paint(0xc9ccce), dark = C.paint(0x3a3f46);
  mb.add(box(length, base, 0.4, 0, 0, 0.2), conc, m);
  mb.add(box(length, 1.1, 0.12, 0, base, 0.1), C.metal(0x9aa3ab), m);   // 手すり
  // 前の壁の広告（アトラス）
  const adNames = ['ad-takuden', 'ad-univ', 'ad-ev', 'ad-sf', 'ad-zero', 'ad-race', 'ad-charge', 'ad-gp'];
  const adW = 8 * 1.1, nAd = Math.floor(length / (adW + 0.4));
  for (let i = 0; i < nAd; i++) {
    const x = -length / 2 + (length - nAd * (adW + 0.4)) / 2 + (i + 0.5) * (adW + 0.4);
    mb.add(slotPlane(A.get(adNames[i % adNames.length]), adW, 1.1).translate(x, 1.25, 0.41), A.material(), m, { shadow: false });
  }
  // VIP 席（1 層目と 2 層目の間）：ガラス張りの箱
  const yV = base + H1, zV0 = -D1 + 0.2;
  mb.add(box(length, 0.5, 4.2, 0, yV, zV0 - 1.6), dark, m);
  mb.add(box(length - 0.4, 2.8, 0.1, 0, yV + 0.5, zV0 - 0.1), C.glass(0x26445e), m);
  for (let x = -length / 2; x <= length / 2 + 0.01; x += 6) mb.add(box(0.2, 2.8, 0.25, x, yV + 0.5, zV0 - 0.1), dark, m);
  mb.add(box(length, 0.35, 4.2, 0, yV + 3.3, zV0 - 1.6), conc, m);
  // 裏の壁と下の壁（観客席の下の空間を隠す）
  const topY = y2 + H2;
  mb.add(box(length, topY + 1.2, 0.5, 0, 0, back - 0.25), conc, m);
  // 両側の壁（台形）
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(0.4, 0); sh.lineTo(0.4, base + 1.1); sh.lineTo(-D1, base + H1 + 1.1); sh.lineTo(z2, y2 + 1.1); sh.lineTo(back, topY + 1.2); sh.lineTo(back, 0); sh.lineTo(0.4, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false });
    // 形の x → 奥行き（z）、y → 高さ。押し出しは +z → 回して -x 方向へ
    g.rotateY(-Math.PI / 2); g.translate(sx * (length / 2 + 0.25) + 0.25, 0, 0);
    mb.add(g, conc, m);
  }
  // ---- 大屋根（片持ち：裏の柱から前へ張り出す。下にトラス）----
  const roofY = topY + 4.2, roofFront = 2.2, roofBack = back - 1.0;
  const rl = roofFront - roofBack;
  const roof = new THREE.BoxGeometry(length + 4, 0.35, rl);
  roof.rotateX(-0.06); roof.translate(0, roofY, (roofFront + roofBack) / 2);
  mb.add(roof, C.paint(roofColor), m);
  // 屋根の裏（下から見える面）。下向きの面は地面の照り返し（緑）だけで照らされて緑っぽく見えるので、少し赤紫に寄せた灰色で打ち消す
  const under = new THREE.BoxGeometry(length + 3.8, 0.05, rl - 0.2); under.rotateX(-0.06); under.translate(0, roofY - 0.2, (roofFront + roofBack) / 2);
  mb.add(under, C.paint(0xb3a6bf), m);
  // 屋根の前の看板（長い帯。アトラスの 16:1 を並べる）
  const fw = Math.min(length, 60), nf = Math.max(1, Math.round(length / 62));
  for (let i = 0; i < nf; i++) {
    const x = -length / 2 + length * (i + 0.5) / nf;
    mb.add(slotPlane(A.get('fascia-main'), fw * 0.98, fw * 0.98 / 16).translate(x, roofY - 0.2 - fw / 32 + 0.6, roofFront + 0.35), A.material(), m, { shadow: false });
  }
  mb.add(box(length + 4, 2.2, 0.3, 0, roofY - 1.8, roofFront + 0.12), C.paint(0x0a3070), m);
  // 柱とトラス（12 m ごと）
  for (let x = -length / 2; x <= length / 2 + 0.01; x += 12) {
    mb.add(box(0.7, roofY + 1.2, 0.7, x, 0, back - 0.6), C.metal(0xdfe4e8), m);
    // 屋根の下のトラス（上弦・下弦・斜材）
    const yb = roofY - 2.4;
    const geos = [rod([x, roofY - 0.2, back - 0.6], [x, roofY + (roofFront - back) * 0.06 - 0.2, roofFront], 0.12), rod([x, yb, back - 0.6], [x, roofY - 1.6, roofFront - 1], 0.1)];
    for (let k = 0; k < 6; k++) {
      const f0 = k / 6, f1 = (k + 1) / 6;
      const zA = back - 0.6 + (roofFront - back) * f0, zB = back - 0.6 + (roofFront - back) * f1;
      geos.push(rod([x, yb + (roofY - 1.6 - yb) * f0, zA], [x, roofY - 0.25, zB], 0.06));
    }
    mb.add(mergeGeometries(geos.map((g) => g.toNonIndexed())), C.metal(0xdfe4e8), m);
  }
  // 屋根の上の旗竿の位置（旗はアニメーションするので戻り値で返す）
  const flags = [];
  for (let x = -length / 2 + 6; x < length / 2; x += 12) flags.push(new THREE.Vector3(x, roofY + 0.2, back + 0.5).applyMatrix4(m));
  return { flags, roofY, depth: -back + 2 };
}

// =====================================================================
// ピットビル：1 階はガレージ（開いた所は中が見える）、2 階はガラスのホスピタリティ（バルコニー）、屋上テラス、
//   ガレージの上にチーム名。正面（+Z）がピットレーン。原点は正面の真ん中の足もと。length の方向は +X
// =====================================================================
export function pitBuilding(mb, m, A, { length = 160, depth = 18, garages = 16, open = null } = {}) {
  const H1 = 5.2, H2 = 4.2, gw = length / garages;
  const wall = C.paint(0xeef0f2), dark = C.paint(0x2d3339), trim = C.paint(0x0a3070);
  // 本体：1 階はガレージの奥（z < -9.8）だけ、2 階から上は奥行きいっぱい（ガレージの中が見えるように）
  mb.add(box(length, H1, depth - 9.8, 0, 0, -9.8 - (depth - 9.8) / 2), wall, m);
  mb.add(box(length, H2 + 0.6, depth - 0.6, 0, H1, -0.6 - (depth - 0.6) / 2), wall, m);
  plinth(mb, m, length + 2, depth + 2, 3);
  // ガレージの前のコンクリートの床（ピットレーンの作業エリアとの継ぎ目）
  mb.add(box(length + 1, 0.06, 3.0, 0, -0.03, 1.2), MAT.concrete(), m);
  // 1 階：ガレージ
  const rnd = mulberry(5);
  for (let i = 0; i < garages; i++) {
    const x = -length / 2 + gw * (i + 0.5);
    const isOpen = open ? open(i) : rnd() < 0.7;
    const team = i % 12, col = new THREE.Color(A.teamColors[team]).getHex();
    // 柱とガレージの間の壁
    mb.add(box(0.8, H1, 1.2, x - gw / 2 + 0.4, 0, -0.6), wall, m);
    mb.add(box(0.4, H1, 9.0, x - gw / 2 + 0.4, 0, -5.3), wall, m);
    if (isOpen) {
      // 中（奥の壁はチームの色、床は灰色、天井の照明は光る帯）
      mb.add(box(gw - 0.8, H1 - 0.6, 0.2, x, 0, -9.5), C.paint(col), m);
      mb.add(box(gw - 0.8, 0.05, 9.6, x, 0.01, -4.8), C.paint(0x8c9196), m);
      mb.add(box(gw - 0.8, 0.2, 9.6, x, H1 - 0.6, -4.8), C.paint(0xd7dadd), m);
      for (const zz of [-2.5, -6]) mb.add(box(gw - 2.4, 0.06, 0.3, x, H1 - 0.68, zz), MAT.glow(0xf4f7ff, 1.8), m, { shadow: false });
      // 工具箱・タイヤの山・作業台
      mb.add(box(1.6, 1.0, 0.7, x - gw / 2 + 1.8, 0, -8.8), C.paint(0xc62828), m);
      mb.add(box(1.2, 1.3, 0.6, x + gw / 2 - 1.6, 0, -8.9), C.paint(col), m);
      for (let t = 0; t < 4; t++) mb.add(new THREE.CylinderGeometry(0.29, 0.29, 0.24, 14).translate(x + gw / 2 - 1.4, 0.12 + t * 0.25, -6.6), C.matte(0x141414), m);
      // 作業中の車のシルエット（低い箱）とメカニック
      if (rnd() < 0.7) {
        mb.add(box(1.3, 0.55, 2.8, x - 0.4, 0.1, -4.4), C.paint(col), m);
        mb.add(box(1.5, 0.2, 0.5, x - 0.4, 0.15, -2.95), C.matte(0x111111), m);
        for (let k = 0; k < 2; k++) { const px = x + (k ? 1.6 : -2.2), pz = -3.4 - k * 2; mb.add(box(0.45, 1.05, 0.3, px, 0.8, pz), C.matte(col), m); mb.add(box(0.4, 0.8, 0.28, px, 0, pz), C.matte(0x222222), m); mb.add(new THREE.SphereGeometry(0.14, 8, 6).translate(px, 1.98, pz), C.matte(0xe0b48a), m); }
      }
      // ガレージの前の看板（チーム名）
    } else {
      // シャッター
      mb.add(box(gw - 0.8, H1 - 0.6, 0.15, x, 0, -0.3), C.metal(0xa7adb3), m);
      for (let k = 1; k < 9; k++) mb.add(box(gw - 0.8, 0.04, 0.05, x, k * (H1 - 0.6) / 9, -0.2), C.metal(0x7d848b), m);
    }
    // ガレージの上の梁とチーム名
    mb.add(box(gw - 0.8, 0.6, 1.0, x, H1 - 0.6, -0.5), trim, m);
    mb.add(slotPlane(A.get('team' + team), 3.2, 0.8).translate(x, H1 - 0.3 + 0.5 + 0.0, 0.05), A.material(), m, { shadow: false });
  }
  mb.add(box(0.8, H1, 1.2, length / 2 - 0.4, 0, -0.6), wall, m);
  mb.add(box(0.4, H1, 9.0, length / 2 - 0.4, 0, -5.3), wall, m);
  // 2 階：ガラスとバルコニー（張り出し・手すり）
  mb.add(box(length, 0.4, 3.2, 0, H1, 1.0), C.paint(0xd9dde1), m);
  mb.add(box(length - 0.6, H2 - 0.6, 0.12, 0, H1 + 0.4, -0.6), C.glass(0x26445e), m);
  for (let x = -length / 2; x <= length / 2 + 0.01; x += 5) mb.add(box(0.25, H2 - 0.4, 0.3, x, H1 + 0.4, -0.6), dark, m);
  mb.add(box(length, 1.0, 0.06, 0, H1 + 0.4, 2.55), C.glass(0x5f7f99), m);   // ガラスの手すり
  // バルコニーの観客（2 階）
  {
    const g = new THREE.PlaneGeometry(length - 4, 1.4); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length - 4) / 12, 0.5 + uv.getY(i) * 0.25);
    g.translate(0, H1 + 0.4 + 0.7, 1.4); mb.add(g, MAT.crowd(), m, { shadow: false });
  }
  // 屋根・屋上テラス（ひさし・パラソル）
  const roofY = H1 + H2 + 0.6;
  mb.add(box(length + 1, 0.5, depth + 2.4, 0, roofY - 0.5, -depth / 2 + 1.0), C.paint(0xd0d5da), m);
  mb.add(box(length + 1, 1.2, 0.2, 0, roofY, 2.1), C.metal(0xc0c7ce), m);
  // 正面の上の看板（長い帯）
  const nf = Math.max(1, Math.round(length / 60)), fw = length / nf;
  for (let i = 0; i < nf; i++) mb.add(slotPlane(A.get('fascia-pit'), fw * 0.96, fw * 0.96 / 16).translate(-length / 2 + fw * (i + 0.5), roofY - 0.5 - fw * 0.96 / 32 + 0.2, 2.22), A.material(), m, { shadow: false });
  for (let x = -length / 2 + 8; x < length / 2 - 4; x += 14) {
    const c = [0xe53935, 0xfafafa, 0x1e88e5, 0xffc928][Math.abs(Math.round(x)) % 4];
    mb.add(new THREE.ConeGeometry(1.8, 0.7, 10).translate(x, roofY + 2.5, -3), C.matte(c), m);
    mb.add(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 5).translate(x, roofY + 1.25, -3), C.metal(0x9aa3ab), m);
  }
  // 屋上の人（観客の帯）
  { const g = new THREE.PlaneGeometry(length - 10, 1.2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length - 10) / 12, 0.25 + uv.getY(i) * 0.25); g.translate(0, roofY + 0.6, 0.6); mb.add(g, MAT.crowd(), m, { shadow: false }); }
  // 屋上の手すり
  mb.add(box(length, 1.1, 0.06, 0, roofY, 1.9), C.glass(0x5f7f99), m);
  return { roofY };
}

// =====================================================================
// 観客の土手のひな壇（屋根なし・低い）。コーナーの外に並べる。length: 長さ [m]、rows: 段数
// =====================================================================
export function bleacher(mb, m, { length = 15, rows = 5, rnd = Math.random, A = null } = {}) {
  const stepH = 0.42, stepD = 0.8, base = 0.6, D = rows * stepD;
  const P = [], U = [], I = [];
  const x0 = -length / 2, x1 = length / 2;
  for (let r = 0; r < rows; r++) {
    const z = D / 2 - r * stepD, y = base + r * stepH, b = P.length / 3;
    P.push(x0, y, z, x1, y, z, x0, y + stepH, z, x1, y + stepH, z);
    P.push(x0, y + stepH, z, x1, y + stepH, z, x0, y + stepH, z - stepD, x1, y + stepH, z - stepD);
    const off = Math.floor(rnd() * 12), u0 = off + x0 / 12, u1 = off + x1 / 12, v0 = ((r * 3 + off) % 4) / 4, v1 = v0 + 0.25;
    U.push(u0, v0, u1, v0, u0, v1, u1, v1, u0, v0 + 0.06, u1, v0 + 0.06, u0, v1 - 0.03, u1, v1 - 0.03);   // 座面にも観客の絵（上から見ても空席にならない）
    I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 4, b + 5, b + 6, b + 5, b + 7, b + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
  mb.add(g, MAT.crowd(), m);
  const conc = C.paint(0x9fa4a9), H = base + rows * stepH;   // 白すぎると遠くから箱に見えるので少し暗く
  mb.add(box(length, base, D + 0.2, 0, 0, 0), conc, m);
  mb.add(box(length, H + 2.4, 0.3, 0, -2, -D / 2 - 0.15), conc, m);
  for (const sx of [-1, 1]) mb.add(box(0.3, H + 2.4, D + 0.3, sx * (length / 2 + 0.15), -2, 0), conc, m);
  mb.add(box(length, 0.9, 0.06, 0, base, D / 2 + 0.05), C.metal(0x9aa3ab), m);
  // 裏の壁の広告
  if (A) mb.add(slotPlane(A.get(['ad-takuden', 'ad-univ2', 'ad-race', 'ad-ev'][Math.floor(rnd() * 4)]), Math.min(9, length * 0.7), Math.min(9, length * 0.7) / 8).rotateY(Math.PI).translate(0, H * 0.55, -D / 2 - 0.32), A.material(), m, { shadow: false });
  // パラソル（ところどころ）
  if (rnd() < 0.6) { const x = (rnd() - 0.5) * length * 0.7; mb.add(new THREE.ConeGeometry(1.3, 0.5, 8).translate(x, H + 2.0, -D / 2 + 0.8), C.matte([0xe53935, 0xfafafa, 0x1e88e5, 0xffc928][Math.floor(rnd() * 4)]), m); mb.add(new THREE.CylinderGeometry(0.03, 0.03, 2.0, 4).translate(x, H + 0.9, -D / 2 + 0.8), C.metal(0x9aa3ab), m); }
}

// 衝撃吸収のクッション（ピットウォールの先端など。黄と黒のしま）。+X の向きに len [m] 伸びる
export function crashCushion(mb, m, { len = 3.2, w = 0.9, h = 1.0 } = {}) {
  const n = 6;
  for (let i = 0; i < n; i++) mb.add(box(len / n - 0.02, h, w, len * (i + 0.5) / n, 0, 0), C.paint(i % 2 ? 0x161616 : 0xffc928), m);
  mb.add(new THREE.CylinderGeometry(w / 2, w / 2, h, 12, 1, false, 0, Math.PI).rotateY(Math.PI / 2).translate(len, h / 2, 0), C.paint(0xffc928), m);
}

// ピットウォールのチームの台（屋根つき・モニター・椅子）。原点はピットウォールの裏の地面、+Z がピットレーン側
export function pitWallStand(mb, m, color) {
  mb.add(box(4.2, 0.9, 1.6, 0, 0, 0.8), C.paint(0x30363d), m);
  for (let i = 0; i < 4; i++) {
    mb.add(box(0.5, 0.5, 0.5, -1.5 + i, 0.9, 1.0), C.matte(0x1b1f24), m);
    mb.add(box(0.45, 0.34, 0.05, -1.5 + i, 1.65, 0.25), C.glass(0x0e1a24), m);
  }
  mb.add(box(4.4, 0.12, 2.2, 0, 2.8, 0.8), C.paint(color), m);
  for (const x of [-2, 2]) mb.add(box(0.1, 1.9, 0.1, x, 0.9, 1.6), C.metal(0x9aa3ab), m);
}

// =====================================================================
// コントロールタワー：5 階建て。最上階はガラス張りのレースコントロール（張り出し屋根）、名前の看板と時計、アンテナ
// =====================================================================
export function controlTower(mb, m, A, { w = 14, d = 12, floors = 5 } = {}) {
  const fh = 3.6, H = floors * fh;
  const wall = C.paint(0xf1f3f5), dark = C.paint(0x2d3339);
  plinth(mb, m, w + 1, d + 1, 3);
  mb.add(box(w, H, d), wall, m);
  // 各階のガラスの帯（4 面）
  for (let f = 1; f < floors; f++) {
    const y = f * fh + 0.6;
    mb.add(box(w + 0.1, 2.2, d + 0.1, 0, y, 0), C.glass(0x26445e), m);
    mb.add(box(w + 0.3, 0.25, d + 0.3, 0, y - 0.6, 0), C.paint(0xd9dde1), m);
  }
  // 最上階：前に傾いたガラス（下を見下ろす）と張り出し屋根
  const top = H, cw = w + 3, cd = d + 3;
  mb.add(box(cw, 0.6, cd, 0, top, 0), C.paint(0xd9dde1), m);
  const glass = new THREE.CylinderGeometry(cw * 0.62, cw * 0.56, 3.4, 8, 1, false); glass.rotateY(Math.PI / 8); glass.scale(1, 1, cd / cw); glass.translate(0, top + 0.6 + 1.7, 0);
  mb.add(glass, C.glass(0x1d3a55), m);
  const roof = new THREE.CylinderGeometry(cw * 0.7, cw * 0.66, 0.6, 8); roof.rotateY(Math.PI / 8); roof.scale(1, 1, cd / cw); roof.translate(0, top + 4.0, 0);
  mb.add(roof, C.paint(0x0a3070), m);
  mb.add(box(4, 1.6, 4, 0, top + 4.3, 0), dark, m);
  mb.add(new THREE.CylinderGeometry(0.08, 0.14, 9, 6).translate(1.0, top + 4.3 + 4.5, 0.5), C.metal(0xc0c7ce), m);
  mb.add(new THREE.CylinderGeometry(0.06, 0.1, 6, 6).translate(-1.2, top + 4.3 + 3, -0.6), C.metal(0xc0c7ce), m);
  mb.add(new THREE.SphereGeometry(0.25, 8, 6).translate(1.0, top + 13.4, 0.5), MAT.glow(0xff3030, 3), m, { shadow: false });
  // 名前の看板（正面）と時計
  mb.add(slotPlane(A.get('tower-name'), w * 0.9, w * 0.9 / 8).translate(0, H - 1.2, d / 2 + 0.08), A.material(), m, { shadow: false });
  mb.add(slotPlane(A.get('clock'), 2.6, 2.6).translate(0, 1.8 + fh, d / 2 + 0.2), A.material(), m, { shadow: false });
  // 入口のひさし
  mb.add(box(6, 0.3, 3, 0, 3.2, d / 2 + 1.5), C.paint(0x0a3070), m);
  return { height: top + 4.6 };
}

// =====================================================================
// アーチ橋（大きなタイヤの形の橋。鈴鹿のダンロップ橋のような名物）。span: 柱の間隔 [m]。+X 方向にコースを横切る
// =====================================================================
export function archBridge(mb, m, A, { span = 34, height = 9 } = {}) {
  const R = span / 2;
  // タイヤの形（半円のトーラス）：黒いゴム＋側面の黄色い文字の帯
  const tire = new THREE.TorusGeometry(R, 1.5, 10, 40, Math.PI);
  tire.scale(1, height / R, 1.25);
  mb.add(tire, C.matte(0x161616), m);
  const rim = new THREE.TorusGeometry(R - 1.0, 0.35, 6, 40, Math.PI); rim.scale(1, height / R * (R - 1) / (R - 1), 1); rim.scale(1, height / R, 1);
  for (const z of [-1.0, 1.0]) mb.add(rim.clone().translate(0, 0, z * 1.62), C.paint(0xffc928), m);
  // 文字の看板（両面）
  const lw = span * 0.62, lh = lw / 4;
  for (const sz of [1, -1]) {
    const g = slotPlane(A.get('arch-logo'), lw, lh);
    if (sz < 0) g.rotateY(Math.PI);
    g.translate(0, height * 0.96 - lh * 0.6, sz * 2.0);
    mb.add(g, A.material(), m, { shadow: false });
  }
  // 看板の枠
  mb.add(box(lw + 0.4, lh + 0.4, 3.8, 0, height * 0.96 - lh * 1.1 - 0.2, 0), C.paint(0x0a3070), m);
  // 足もと（コンクリートの台）
  for (const sx of [-1, 1]) mb.add(box(3.6, 1.2, 4.4, sx * R, -0.6, 0), C.paint(0xb5b9bd), m);
}

// =====================================================================
// 看板（足つき・両面ではない）。slotName の絵、幅 w × 高さ h、地面から legH の高さ
// =====================================================================
export function sign(mb, m, A, slotName, w, h, legH = 1, { frame = 0x2d3339, legs = 2 } = {}) {
  mb.add(slotPlane(A.get(slotName), w, h).translate(0, legH + h / 2, 0.07), A.material(), m, { shadow: false });
  mb.add(box(w + 0.16, h + 0.16, 0.1, 0, legH - 0.08, 0), C.paint(frame), m);
  if (legH > 0) {
    if (legs === 1) mb.add(box(0.12, legH, 0.12, 0, 0, -0.04), C.metal(0x6f767d), m);
    else for (const x of [-w * 0.36, w * 0.36]) mb.add(box(0.12, legH, 0.12, x, 0, -0.04), C.metal(0x6f767d), m);
  }
}

// マーシャルポスト（小屋＋旗を持った係員＋番号）
export function marshalPost(mb, m, A, num) {
  mb.add(box(2.6, 0.25, 2.2, 0, 0, 0), C.paint(0x9ea3a8), m);
  mb.add(box(2.4, 2.4, 2.0, 0, 0.25, 0), C.paint(0xf1f3f5), m);
  mb.add(box(2.8, 0.25, 2.4, 0, 2.65, 0), C.paint(0xf57c00), m);
  mb.add(box(1.8, 0.8, 0.05, 0, 1.3, 1.01), C.glass(0x26445e), m);
  if (A.get('post' + num)) mb.add(slotPlane(A.get('post' + num), 1.2, 0.6).translate(0, 3.3, 0.5), A.material(), m, { shadow: false });
  mb.add(box(0.12, 0.6, 0.12, 0, 2.9, 0.5), C.metal(0x6f767d), m);
  // 係員（オレンジの服）と旗
  for (const [x, flag] of [[1.9, 0xffd600], [-1.9, 0x1565c0]]) {
    mb.add(box(0.45, 0.9, 0.3, x, 0.85, 0.7), C.matte(0xff6d00), m);
    mb.add(box(0.4, 0.85, 0.28, x, 0, 0.7), C.matte(0x263238), m);
    mb.add(new THREE.SphereGeometry(0.15, 8, 6).translate(x, 1.92, 0.7), C.matte(0xf1c9a5), m);
    mb.add(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4).rotateZ(-Math.sign(x) * 0.5).translate(x + Math.sign(x) * 0.4, 1.95, 0.7), C.metal(0x6f767d), m);
    mb.add(new THREE.PlaneGeometry(0.7, 0.5).translate(x + Math.sign(x) * 1.0, 2.45, 0.7), C.matte(flag), m, { shadow: false });
  }
}

// テレビカメラの台（足場＋カメラマン）
export function cameraTower(mb, m) {
  const h = 4.5, s = 1.6;
  const geos = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) geos.push(new THREE.CylinderGeometry(0.05, 0.05, h, 5).translate(x * s / 2, h / 2, z * s / 2));
  for (let y = 1; y < h; y += 1.5) for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) geos.push(rod([a[0] * s / 2, y, a[1] * s / 2], [b[0] * s / 2, y + 1.2, b[1] * s / 2], 0.03, 4));
  mb.add(mergeGeometries(geos.map((g) => g.toNonIndexed())), C.metal(0xb0b6bc), m);
  mb.add(box(s + 0.4, 0.12, s + 0.4, 0, h, 0), C.paint(0x5d646b), m);
  mb.add(box(0.5, 0.35, 0.8, 0.2, h + 1.2, 0.2), C.paint(0x1b1f24), m);
  mb.add(box(0.45, 0.9, 0.3, -0.4, h + 0.9, 0), C.matte(0x37474f), m);
  mb.add(new THREE.SphereGeometry(0.14, 8, 6).translate(-0.4, h + 2.0, 0), C.matte(0xe0b48a), m);
  mb.add(box(0.4, 0.8, 0.28, -0.4, h + 0.12, 0), C.matte(0x222222), m);
  mb.add(new THREE.ConeGeometry(1.2, 0.6, 8).translate(0, h + 2.6, 0), C.matte(0x1565c0), m);
  mb.add(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 4).translate(0, h + 1.2, 0), C.metal(0xb0b6bc), m);
}

// 照明塔（4 灯×2 段）。光る面はブルームで光る
export function floodlight(mb, m, { height = 26 } = {}) {
  mb.add(new THREE.CylinderGeometry(0.28, 0.5, height, 8).translate(0, height / 2, 0), C.metal(0xb0b6bc), m);
  mb.add(box(5, 2.6, 0.5, 0, height, -0.1), C.paint(0x3a3f46), m);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    mb.add(new THREE.CircleGeometry(0.48, 12).translate(-1.8 + c * 1.2, height + 0.7 + r * 1.2, 0.17), MAT.glow(0xfff6e0, 1.4), m, { shadow: false });
  }
}

// トランスポーター（チームのトラック）：運転席＋荷台（チームの色の帯）
export function transporter(mb, m, color) {
  mb.add(box(2.5, 2.6, 2.2, 0, 0.6, 7.2), C.paint(0xeceff1), m);
  mb.add(box(2.45, 1.2, 0.05, 0, 2.0, 8.31), C.glass(0x1a2a38), m);
  mb.add(box(2.55, 3.6, 13, 0, 0.9, -0.6), C.paint(0xf4f6f8), m);
  mb.add(box(2.58, 1.0, 13.02, 0, 2.2, -0.6), C.paint(color), m);
  for (const z of [6.8, -3, -4.4, -5.8]) for (const x of [-1.1, 1.1]) mb.add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2).translate(x, 0.5, z), C.matte(0x141414), m);
}
// モーターホーム（バス型）
export function motorhome(mb, m, color) {
  mb.add(box(2.5, 3.2, 12, 0, 0.4, 0), C.paint(0xf4f6f8), m);
  mb.add(box(2.52, 0.9, 12.02, 0, 1.2, 0), C.glass(0x1a2a38), m);
  mb.add(box(2.53, 0.25, 12.03, 0, 2.3, 0), C.paint(color), m);
  mb.add(box(3.6, 0.1, 6, -2.9, 2.8, 0), C.matte(color), m);
  for (const z of [4.2, -3.6]) for (const x of [-1.1, 1.1]) mb.add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2).translate(x, 0.5, z), C.matte(0x141414), m);
}

// 順位表示の塔（光る）
export function positionPylon(mb, m, A) {
  mb.add(box(2.6, 12, 1.0, 0, 0, 0), C.paint(0x11161d), m);
  mb.add(slotPlane(A.get('pylon'), 2.2, 8.8).translate(0, 2.6 + 4.4, 0.51), A.material('glow'), m, { shadow: false });
  mb.add(slotPlane(A.get('pylon'), 2.2, 8.8, { flipU: false }).rotateY(Math.PI).translate(0, 2.6 + 4.4, -0.51), A.material('glow'), m, { shadow: false });
  mb.add(box(3.2, 0.5, 1.6, 0, 12, 0), C.paint(0xe53935), m);
}

// 大きな画面（光る）。w: 幅 [m]。脚つき
export function bigScreen(mb, m, A, { w = 16, leg = 8 } = {}) {
  const h = w * 9 / 16;
  mb.add(slotPlane(A.get('screen'), w, h).translate(0, leg + h / 2 + 0.4, 0.31), A.material('glow'), m, { shadow: false });
  mb.add(box(w + 0.8, h + 0.8, 0.6, 0, leg, 0), C.paint(0x15191e), m);
  mb.add(box(w + 0.8, 0.9, 0.62, 0, leg - 0.9, 0), C.paint(0x0a3070), m);
  for (const x of [-w * 0.3, w * 0.3]) mb.add(box(0.7, leg, 0.7, x, 0, -0.4), C.metal(0x9aa3ab), m);
}

// 小さな建物（売店・救護所など）。屋根の色 roof
export function kiosk(mb, m, { w = 8, d = 6, h = 3.2, color = 0xf1f3f5, roof = 0xc62828 } = {}) {
  plinth(mb, m, w, d, 2);
  mb.add(box(w, h, d), C.paint(color), m);
  mb.add(box(w + 1.2, 0.3, d + 1.2, 0, h, 0), C.paint(roof), m);
  mb.add(box(w * 0.7, 1.2, 0.08, 0, 1.0, d / 2 + 0.01), C.glass(0x26445e), m);
}

// ---------- 旗（風になびく。インスタンスで描き、頂点シェーダで揺らす）----------
// positions: 旗竿の根もとのワールド座標の配列。戻り値 { group, update(dt) }
export function flagField(positions, { height = 7, w = 1.8, h = 1.1, colors = null, windYaw = 0.6 } = {}) {
  const group = new THREE.Group(); group.name = 'flags';
  const n = positions.length; if (!n) return { group, update() {} };
  // 竿（1 つの形にまとめる）
  const poles = mergeGeometries(positions.map((p) => new THREE.CylinderGeometry(0.04, 0.06, height, 5).translate(p.x, p.y + height / 2, p.z).toNonIndexed()));
  const pm = new THREE.Mesh(poles, C.metal(0xc0c7ce)); pm.castShadow = true; pm.matrixAutoUpdate = false; group.add(pm);
  // 旗（細かく分けた板。左端が竿）
  const geo = new THREE.PlaneGeometry(w, h, 10, 2).translate(w / 2, -h / 2, 0);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, name: 'flag' });
  const uni = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        float k = position.x / ${w.toFixed(2)};
        transformed.z += sin(position.x * 2.6 - uTime * 7.0 + ph) * 0.22 * k + sin(position.x * 5.1 - uTime * 11.0 + ph) * 0.05 * k;
        transformed.y += sin(position.x * 1.7 - uTime * 5.0 + ph) * 0.06 * k; }`);
  };
  mat.customProgramCacheKey = () => 'circuit-flag';
  const flags = new THREE.InstancedMesh(geo, mat, n);
  const col = new THREE.Color(), pal = colors || [0xe53935, 0xfafafa, 0x1565c0, 0xffc928, 0x2e7d32, 0x0a3070];
  positions.forEach((p, i) => {
    _m.compose(_p.set(p.x, p.y + height - 0.05, p.z), _q.setFromEuler(_e.set(0, windYaw + (i % 3) * 0.05, 0)), _s.set(1, 1, 1));
    flags.setMatrixAt(i, _m); flags.setColorAt(i, col.setHex(pal[i % pal.length]));
  });
  flags.castShadow = true; flags.computeBoundingSphere();
  group.add(flags);
  return { group, update(dt) { uni.uTime.value += dt; } };
}

// ---------- 駐車場の車（インスタンス。色違い）----------
export function parkedCars(spots) {
  const body = mergeGeometries([box(1.75, 0.75, 4.3, 0, 0.3, 0), box(1.6, 0.6, 2.3, 0, 1.05, -0.2)].map((g) => g.toNonIndexed()));
  const glass = box(1.62, 0.5, 2.0, 0, 1.08, -0.25);
  const n = spots.length;
  const bm = new THREE.InstancedMesh(body, MAT.color(0xffffff, { rough: 0.35, metal: 0.5 }), n);
  const gm = new THREE.InstancedMesh(glass, C.glass(0x182634), n);
  const pal = [0xfafafa, 0x111111, 0x9e9e9e, 0xc62828, 0x1565c0, 0x37474f, 0xd7ccc8, 0x2e7d32, 0xfafafa, 0x607d8b];
  const col = new THREE.Color();
  spots.forEach(([x, y, z, yaw], i) => {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(1, 1, 1));
    bm.setMatrixAt(i, _m); gm.setMatrixAt(i, _m); bm.setColorAt(i, col.setHex(pal[(i * 7) % pal.length]));
  });
  for (const x of [bm, gm]) { x.castShadow = true; x.receiveShadow = true; x.computeBoundingSphere(); }
  const g = new THREE.Group(); g.name = 'parked-cars'; g.add(bm, gm);
  return g;
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 空を飛ぶ物（飛行船・中継のヘリ）。group は直接シーンへ、update(dt) で動かす ----------
// 飛行船：白い船体に TAKUDEN の帯。center のまわりを半径 R、高さ H でゆっくり回る
export function blimp(A, center, { R = 320, H = 140, speed = 0.018 } = {}) {
  const g = new THREE.Group(); g.name = 'blimp';
  const body = new THREE.Group(); g.add(body);
  const hull = new THREE.SphereGeometry(1, 24, 14).scale(26, 7, 7).rotateY(Math.PI / 2);   // 長さ 52 m（-Z が前）
  const fins = [];
  for (let k = 0; k < 4; k++) { const f = new THREE.BoxGeometry(0.4, 6, 6).translate(0, 5, 0); f.rotateX(Math.PI / 4).rotateZ(k * Math.PI / 2); f.translate(0, 0, 21); fins.push(f.toNonIndexed()); }
  const gondola = box(2.4, 2, 7, 0, -8.4, -2);
  const white = MAT.color(0xf4f6f8, { rough: 0.5 }), blue = MAT.color(0x0d47a1, { rough: 0.5 });
  const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); body.add(m); return m; };
  mesh(hull, white); mesh(mergeGeometries(fins), blue); mesh(gondola, blue);
  // 側面のロゴ（両側）
  for (const sx of [1, -1]) {
    const p = slotPlane(A.get('arch-logo'), 30, 7.4); p.rotateY(sx * Math.PI / 2); p.translate(sx * 6.95, 0.3, 0);
    // 船体のふくらみに少し沿わせる（板の縦方向を曲げる）
    const pos = p.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) - 0.3, z = pos.getZ(i); pos.setX(i, sx * Math.sqrt(Math.max(0, 1 - (y / 7.2) ** 2 - (z / 26.5) ** 2)) * 7.05); }
    p.computeVertexNormals();
    mesh(p, A.material());
  }
  let t = Math.random() * 6;
  const api = {
    group: g,
    update(dt) {
      t += dt * speed;
      const x = center.x + Math.cos(t) * R, z = center.z + Math.sin(t) * R * 0.8;
      g.position.set(x, H + Math.sin(t * 3) * 3, z);
      // 進む向き（円の接線）に船首を向ける
      const vx = -Math.sin(t) * R, vz = Math.cos(t) * R * 0.8;
      g.rotation.y = Math.atan2(-vx, -vz);
      body.rotation.z = Math.sin(t * 5) * 0.02;
    },
  };
  api.update(0);
  return api;
}

// 中継のヘリ：コースの上を大きく 8 の字に飛ぶ。ローターは回る
export function helicopter(center, { R = 220, H = 90, speed = 0.07 } = {}) {
  const g = new THREE.Group(); g.name = 'helicopter';
  const red = MAT.color(0xc62828, { rough: 0.4, metal: 0.3 }), dark = MAT.color(0x22272d, { rough: 0.5, metal: 0.4 });
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
  add(new THREE.SphereGeometry(1, 14, 10).scale(1.3, 1.2, 2.4), red);
  add(new THREE.CylinderGeometry(0.25, 0.4, 5, 8).rotateX(Math.PI / 2).translate(0, 0.4, 3.6), red);
  add(new THREE.SphereGeometry(1, 10, 8).scale(0.9, 0.7, 1.0).translate(0, 0.2, -1.6), C.glass(0x1a2a38));
  add(box(0.1, 1.4, 0.8, 0, 0, 6), red);
  for (const sx of [-0.8, 0.8]) add(box(0.1, 0.1, 3.2, sx, -1.55, 0), dark);
  const rotor = add(mergeGeometries([box(11, 0.05, 0.35), box(0.35, 0.05, 11)].map((q) => q.toNonIndexed())), dark); rotor.position.y = 1.35;
  const tail = add(box(0.06, 1.8, 0.25), dark); tail.position.set(0.3, 0.6, 6.1);
  let t = Math.random() * 6;
  const api = {
    group: g,
    update(dt) {
      t += dt * speed;
      const x = center.x + Math.sin(t) * R, z = center.z + Math.sin(t * 2) * R * 0.45;
      const vx = Math.cos(t) * R, vz = Math.cos(t * 2) * 2 * R * 0.45;
      g.position.set(x, H + Math.sin(t * 1.7) * 6, z);
      g.rotation.set(0, Math.atan2(-vx, -vz), 0);
      g.rotateX(-0.12); g.rotateZ(-Math.sin(t) * 0.12);
      rotor.rotation.y += dt * 40; tail.rotation.x += dt * 60;
    },
  };
  api.update(0);
  return api;
}

// 池（空が映る水面と砂の岸）。地面の起伏の上に平らな水面を置く。center: {x, z}、r: 半径、y: 水面の高さ
let waterMat = null;
export function pond(mb, group, center, r, y) {
  if (!waterMat) waterMat = new THREE.MeshStandardMaterial({ name: 'water', color: 0x2c4b57, roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2 });
  // 少しいびつな円
  const shape = new THREE.Shape(), N = 40;
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2, rr = r * (1 + 0.12 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 5)); const px = Math.cos(a) * rr, pz = Math.sin(a) * rr; if (i) shape.lineTo(px, pz); else shape.moveTo(px, pz); }
  const water = new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);   // +Z 向きの面 → 上向き
  water.translate(center.x, y, center.z);
  const wm = new THREE.Mesh(water, waterMat); wm.receiveShadow = true; wm.matrixAutoUpdate = false; group.add(wm);
  // 岸（砂の輪：水面から外へ下がる）
  const bank = new THREE.RingGeometry(r * 0.92, r * 1.35, 40, 2).rotateX(-Math.PI / 2);
  const pos = bank.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z), a = Math.atan2(z, x), rr = r * (1 + 0.12 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 5)); const k = (d / r - 0.92) / 0.43; pos.setXYZ(i, Math.cos(a) * d * rr / r, -0.02 - k * 1.2, Math.sin(a) * d * rr / r); }
  bank.computeVertexNormals(); bank.translate(center.x, y, center.z);
  mb.add(bank, MAT.sand());
}
