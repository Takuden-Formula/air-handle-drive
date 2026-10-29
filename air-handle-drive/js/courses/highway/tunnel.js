// トンネル：内側（照明を焼き込んだ光らない材質）・オレンジの照明・路面・ジェットファン・非常設備、
// 坑口（突き出したフード・坑門の壁・反対車線の坑口）、法面（法枠の切土）、トンネルの上の山。
import * as THREE from 'three';
import { MAT, textTexture } from '../../engine/textures.js';
import { HMAT, glowRGB } from './tex.js';
import { addGroundColor } from './ground.js';
import { sweep, Batch, box, at } from './structures.js';
import { SEC, wallL, wallR, oppEdges } from './layout.js';

const T0 = SEC.tunnel0, T1 = SEC.tunnel1, HOOD = 7;
const SPRING = 2.0, ARCH_B = 5.6;      // 側壁の高さ・アーチの高さ（天井 = 7.6 m）

// 自分のトンネルの断面（左の床 → 天井 → 右の床。外から見て時計回り）。off = 外へ広げる量（フードの外側）
export function boreProfile(s, off = 0, nArc = 18) {
  const dl = -wallL(s), dr = wallR(s), c = (dl + dr) / 2, a = (dr - dl) / 2 + off, b = ARCH_B + off;
  const P = [[dl - off, -0.05], [dl - off, SPRING]];
  for (let i = 1; i < nArc; i++) { const t = Math.PI - Math.PI * i / nArc; P.push([c + a * Math.cos(t), SPRING + b * Math.sin(t)]); }
  P.push([dr + off, SPRING], [dr + off, -0.05]);
  return P;
}
// 反対車線のトンネルの断面
function oppBoreProfile(s, off = 0, nArc = 18) {
  const e = oppEdges(s), dl = e.inner - 0.3, dr = e.wall, c = (dl + dr) / 2, a = (dr - dl) / 2 + off, b = ARCH_B + off;
  const P = [[dl - off, -0.05], [dl - off, SPRING]];
  for (let i = 1; i < nArc; i++) { const t = Math.PI - Math.PI * i / nArc; P.push([c + a * Math.cos(t), SPRING + b * Math.sin(t)]); }
  P.push([dr + off, SPRING], [dr + off, -0.05]);
  return P;
}
const perim = (P) => P.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0), 0);

export function buildTunnel(ctx, G) {
  const { track, mb, group } = ctx;
  const R = (s) => track.heightAt(s, 0);
  // ---- トンネルの上の山（地面の高さ）と法面 ----
  const mid = (s) => (oppEdges(s).inner + oppEdges(s).wall) / 2 - 7;   // 2 本のトンネルの真ん中あたり
  // 法面の始まり（道路の外の端）と、法面の高さ（1:0.5 で上り、7 m ごとに 1.5 m の小段）
  const slopeO0 = (s, side) => (side < 0 ? wallL(s) + 0.3 + 1.0 : oppEdges(s).wall + 0.3 + 1.0);
  const stairs = (q) => { if (q <= 0) return -0.25; const k = Math.floor(q / 5), r = q - k * 5; return 7 * k + Math.min(7, 2 * r) - 0.25; };
  // 坑門の壁の左右の端（法面が坑門の高さに届く所）
  const FACE_H = 11.5;
  const faceL = (s) => -(wallL(s) + 1.3 + 7.6), faceR = (s) => oppEdges(s).wall + 1.3 + 7.6;
  const coverY = (s, d, x, z) => {
    const B = G.base(x, z);
    const ridge = R(s) + FACE_H - Math.max(0, Math.abs(d - mid(s)) - 26) * 0.6;
    const nat = Math.max(B + 0.35, ridge);
    // 坑口の近くは坑門の高さから山へ向かって上る（坑門の上に山がかぶさらないように）
    const u = Math.max(0, Math.min(s - T0, T1 - s));
    const q = Math.max(-d - slopeO0(s, -1), d - slopeO0(s, 1));   // 法面の始まりからの横の距離
    return Math.min(nat, R(s) + Math.max(FACE_H, stairs(q) + 0.05) + u * 0.9);
  };
  // 山（トンネルの上）を覆う帯
  {
    const D0 = -150, D1 = 190, step = 3.5, cols = Math.round((D1 - D0) / step);
    const pos = [], uv = [], col = [], idx = [];
    const v = new THREE.Vector3();
    let rows = 0;
    for (let s = T0; s <= T1 + 0.01; s += 4) {
      const ss = Math.min(s, T1);
      for (let j = 0; j <= cols; j++) {
        const d = D0 + j * step;
        track.toWorld(ss, d, 0, v);
        let y = coverY(ss, d, v.x, v.z);
        const edge = Math.min(j, cols - j);
        if (edge < 2) y = G.base(v.x, v.z) - 2.5 + edge * 1.2;
        pos.push(v.x, y, v.z); uv.push(v.x / 8, v.z / 8);
        const n = G.noise(v.x / 37, v.z / 37, 2), k = 0.78 + n * 0.25;
        col.push(0.74 * k, 0.86 * k, 0.66 * k);
      }
      if (rows > 0) { const b = (rows - 1) * (cols + 1), c = rows * (cols + 1); for (let j = 0; j < cols; j++) idx.push(b + j, b + j + 1, c + j, b + j + 1, c + j + 1, c + j); }
      rows++;
      if (ss >= T1) break;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, ctx.groundMat); m.receiveShadow = true; m.castShadow = false; m.name = 'hw-tunnel-hill'; m.matrixAutoUpdate = false;
    group.add(m);
  }
  // 法面（坑口の手前・出口の先の切土。法枠＋小段）と、その外の山の地面（細かい帯）。
  //   どちらも同じ横の位置で点を並べる。法面は山の地面に着いたら地面の帯の下にもぐり、地面の帯は法面の少し下を通る
  const slopeMat = HMAT.slopeFrame();
  const QS = []; for (let q = 0; q < 1.01; q += 0.5) QS.push(q); for (let q = 2.5; q <= 36.1; q += 1.65) QS.push(q); for (const q of [38, 41, 45, 50, 56, 63, 71, 80, 90, 101, 113]) QS.push(q);
  const slopeRows = (s, side) => {
    const o0 = slopeO0(s, side), v = new THREE.Vector3(), sl = [], gr = [];
    for (let j = 0; j < QS.length; j++) {
      const q = QS[j], o = o0 + q;
      track.toWorld(s, side * o, 0, v);
      const top = G.base(v.x, v.z) - R(s), h = stairs(q);
      sl.push([o, h < top ? h : top - 0.8]);
      gr.push([o, j >= QS.length - 2 ? top - 2.5 : Math.min(h - 0.3, top + 0.03)]);
    }
    return { sl, gr };
  };
  const cache = new Map();
  const rowsAt = (s, side) => { const k = s.toFixed(2) + side; if (!cache.has(k)) cache.set(k, slopeRows(s, side)); return cache.get(k); };
  // 切土の深さ（法面の始まりから 12 m 外の地面と道路の差）。浅い所は法面を作らない
  const cutDepth = (s, side) => { const v = new THREE.Vector3(); track.toWorld(s, side * (slopeO0(s, side) + 12), 0, v); return G.base(v.x, v.z) - R(s); };
  const zones = [[SEC.bridge1 + 4, T0], [T1, SEC.valley0 - 6], [SEC.valley1 + 6, track.length]];
  for (const [sa, sb] of zones) {
    for (const side of [-1, 1]) {
      const on = (s) => (s <= T0 + 0.1 && s >= T0 - 0.1) || (s >= T1 - 0.1 && s <= T1 + 0.1) || cutDepth(s, side) > 1.5;
      for (const g of sweep(track, { s0: sa, s1: sb, step: 3, side, on, prof: (s) => rowsAt(s, side).sl, uLen: 2.5, vLen: 2.5, chunk: 150 })) mb.add(g, slopeMat);
      for (const g of sweep(track, { s0: sa, s1: sb, step: 3, side, on, prof: (s) => rowsAt(s, side).gr, uLen: 8, vLen: 8, chunk: 150 })) { addGroundColor(g, G); mb.add(g, ctx.groundMat, null, { shadow: false }); }
    }
  }

  // ---- 自分のトンネルの内側 ----
  const prof0 = boreProfile(T0), per = perim(prof0);
  const lining = sweep(track, { s0: T0 - HOOD, s1: T1 + HOOD, step: 2, prof: (s) => boreProfile(s), uLen: 8, vLen: per, chunk: 120 });
  for (const g of lining) { const m = new THREE.Mesh(g, HMAT.tunnelLining()); m.castShadow = true; m.receiveShadow = false; m.matrixAutoUpdate = false; m.name = 'hw-lining'; group.add(m); }
  // 路面（照明で照らされた色を焼き込んだ光らない材質）
  const wl = wallL(T0), wr = wallR(T0);
  const road = sweep(track, { s0: T0 - HOOD + 0.5, s1: T1 + HOOD - 0.5, step: 2, prof: (s) => [-wallL(s), -wallL(s) / 2, 0, wallR(s) / 2, wallR(s)].map((d) => [d, 0.035]), uLen: 20, vLen: wl + wr, swap: true, chunk: 120 });
  for (const g of road) { const m = new THREE.Mesh(g, HMAT.tunnelRoad(wl, wr)); m.receiveShadow = false; m.matrixAutoUpdate = false; m.renderOrder = 1; m.name = 'hw-troad'; group.add(m); }
  // 照明（両側の肩、入口の 70 m は 2 m ごと、その先は 4 m ごと）。光る箱を 1 つにまとめる
  const lampG = box(1.25, 0.16, 0.3, 0, -0.08, 0), lampC = glowRGB(0xff9a3c, 7);
  const sideLamp = (s, sideK) => {
    const dl = -wallL(s), dr = wallR(s), c = (dl + dr) / 2, a = (dr - dl) / 2;
    const th = sideK < 0 ? Math.PI - 0.72 : 0.72;
    const d = c + (a - 0.18) * Math.cos(th), h = SPRING + (ARCH_B - 0.18) * Math.sin(th);
    return at(track, s, d, h);
  };
  for (let s = T0 + 1; s < T1 - 1;) {
    for (const k of [-1, 1]) ctx.glow.add(lampG, sideLamp(s, k), lampC);
    s += (s < T0 + 70 || s > T1 - 40) ? 2 : 4;
  }
  // ジェットファン（天井に 2 台ずつ）・非常設備（光らない材質で、トンネルの照明の色）
  const fanMat = new THREE.MeshBasicMaterial({ color: 0x4a3a2a, name: 'hw-fan' }), fan = new Batch();
  const fanG = new THREE.CylinderGeometry(0.62, 0.62, 4.2, 14, 1, true).rotateX(Math.PI / 2), ringG = new THREE.TorusGeometry(0.62, 0.08, 6, 16);
  const hangG = box(0.12, 0.6, 0.12);
  for (let s = T0 + 60; s < T1 - 30; s += 85) {
    for (const d of [-3.3, 1.8]) {
      const m = at(track, s, d, SPRING + ARCH_B - 1.6);
      fan.add(fanG, m); fan.add(ringG, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 2.1))); fan.add(ringG, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -2.1)));
      fan.add(hangG, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.55, 0)));
    }
  }
  const fm = new THREE.Mesh(fan.build(), fanMat); fm.matrixAutoUpdate = false; fm.name = 'hw-fans'; group.add(fm);
  // 非常電話・消火器（左の壁。赤い表示灯）・非常口（緑の表示）
  const green = new Batch(), boxes = new Batch(), redG = new THREE.OctahedronGeometry(0.17).translate(0, 2.35, 0), redC = glowRGB(0xff2a1a, 6);
  for (let s = T0 + 25; s < T1 - 10; s += 50) {
    const d = -wallL(s) + 0.06;
    boxes.add(box(0.06, 1.3, 1.1, 0, 0.7, 0), at(track, s, d, 0));
    ctx.glow.add(redG, at(track, s, d + 0.05, 0), redC);
  }
  for (let s = T0 + 50; s < T1 - 20; s += 100) {
    const m = at(track, s, -wallL(s) + 0.04, 0, Math.PI / 2);
    green.add(new THREE.PlaneGeometry(1.6, 0.55).translate(0, 2.9, 0), m);
  }
  const bm = new THREE.Mesh(boxes.build(), new THREE.MeshBasicMaterial({ color: 0x9c8064, name: 'hw-tbox' })); bm.matrixAutoUpdate = false; group.add(bm);
  const exitTex = textTexture({ w: 256, h: 88, bg: '#13a04a', lines: [{ text: '非常口 ⇨', size: 0.6, color: '#ffffff' }] });
  const gm = new THREE.Mesh(green.build(), new THREE.MeshBasicMaterial({ map: exitTex, color: 0xffffff, name: 'hw-exit', side: THREE.DoubleSide })); gm.matrixAutoUpdate = false; group.add(gm);

  // ---- 坑口（入口・出口）：フード・坑門の壁・反対車線の坑口 ----
  const conc = MAT.concrete();
  for (const [sp, dir] of [[T0, -1], [T1, 1]]) {
    const sFront = sp + dir * HOOD;
    // フードの外側（アーチの外面）
    for (const g of sweep(track, { s0: Math.min(sp, sFront), s1: Math.max(sp, sFront), step: 1, prof: (s) => boreProfile(s, 0.8), uLen: 4, vLen: 4 })) mb.add(g, conc);
    // フードの前の縁（輪）と、坑門の壁（穴あき）。坑口の面の行列：入口は -s を向く（近づく車の方）、出口は +s を向く
    const toLocal = (P) => P.map(([d, h]) => new THREE.Vector2(dir < 0 ? d : -d, h));
    {
      const outer = boreProfile(sFront, 0.8), inner = boreProfile(sFront, 0);
      const shape = new THREE.Shape(toLocal([...outer, [outer[0][0], -0.05]]));
      shape.holes.push(new THREE.Path(toLocal([...inner, [inner[0][0], -0.05]]).reverse()));
      const g = new THREE.ShapeGeometry(shape, 4);
      mb.add(g, conc, at(track, sFront, 0, 0, dir < 0 ? 0 : Math.PI));
    }
    // 坑門の壁（法面の間をふさぐ）。上の端は山の帯の高さ
    {
      const v = new THREE.Vector3();
      // 左右は、山の帯が元の地面の高さに戻る所まで
      const nat = (d) => { track.toWorld(sp, d, 0, v); return G.base(v.x, v.z) + 0.35; };
      const cov = (d) => { track.toWorld(sp, d, 0, v); return coverY(sp, d, v.x, v.z); };
      let left = faceL(sp), right = faceR(sp);
      while (left > -140 && cov(left) < nat(left) - 0.05) left -= 1;
      while (right < 180 && cov(right) < nat(right) - 0.05) right += 1;
      left -= 2; right += 2;
      const top = [];
      for (let d = left; d <= right + 0.01; d += 1) { track.toWorld(sp, d, 0, v); top.push([d, coverY(sp, d, v.x, v.z) - R(sp) + 0.05]); }
      const outline = [[left, -3], ...top, [right, -3]];
      const shape = new THREE.Shape(toLocal(outline));
      const ours = boreProfile(sp, 0.8), opp = oppBoreProfile(sp, 0.8);
      shape.holes.push(new THREE.Path(toLocal([...ours, [ours[0][0], -0.05]])));
      shape.holes.push(new THREE.Path(toLocal([...opp, [opp[0][0], -0.05]])));
      const g = new THREE.ShapeGeometry(shape, 6);
      const uvA = g.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / 4, uvA.getY(i) / 4);
      mb.add(g, conc, at(track, sp, 0, 0, dir < 0 ? 0 : Math.PI));
    }
    // 銘板（トンネルの名前）
    const name = textTexture({ w: 1024, h: 200, bg: '#e8e2d2', border: '#5a5248', lines: [{ text: dir < 0 ? '拓 殖 ト ン ネ ル' : 'TAKUSHOKU  TUNNEL', size: 0.5, color: '#2a2622' }] });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.25), new THREE.MeshStandardMaterial({ map: name, roughness: 0.6 }));
    plate.matrixAutoUpdate = false; plate.matrix.copy(at(track, sFront - dir * 0.05, -0.75, SPRING + ARCH_B + 1.7, dir < 0 ? 0 : Math.PI)); plate.matrixWorldNeedsUpdate = true;
    group.add(plate);
    // 反対車線の坑口：短いトンネルの内側＋奥を暗くする板
    const oppPer = perim(oppBoreProfile(sp));
    const sIn = sp - dir * 45;
    for (const g of sweep(track, { s0: Math.min(sp, sIn), s1: Math.max(sp, sIn), step: 3, prof: (s) => oppBoreProfile(s), uLen: 8, vLen: oppPer })) { const m = new THREE.Mesh(g, HMAT.tunnelLining()); m.matrixAutoUpdate = false; group.add(m); }
    {
      const P = oppBoreProfile(sIn, 0.2);
      const shape = new THREE.Shape(toLocal([...P, [P[0][0], -0.3]]));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 4), new THREE.MeshBasicMaterial({ color: 0x1a120a, name: 'hw-dark' }));
      m.matrixAutoUpdate = false; m.matrix.copy(at(track, sIn, 0, 0, dir < 0 ? 0 : Math.PI)); m.matrixWorldNeedsUpdate = true; group.add(m);
    }
    // 反対車線のフード
    for (const g of sweep(track, { s0: Math.min(sp, sFront), s1: Math.max(sp, sFront), step: 1, prof: (s) => oppBoreProfile(s, 0.8), uLen: 4, vLen: 4 })) mb.add(g, conc);
    {
      const outer = oppBoreProfile(sFront, 0.8), inner = oppBoreProfile(sFront, 0);
      const shape = new THREE.Shape(toLocal([...outer, [outer[0][0], -0.05]]));
      shape.holes.push(new THREE.Path(toLocal([...inner, [inner[0][0], -0.05]]).reverse()));
      mb.add(new THREE.ShapeGeometry(shape, 4), conc, at(track, sFront, 0, 0, dir < 0 ? 0 : Math.PI));
    }
    for (const g of sweep(track, { s0: Math.min(sp, sFront), s1: Math.max(sp, sFront), step: 1, prof: (s) => oppBoreProfile(s), uLen: 8, vLen: oppPer })) { const m = new THREE.Mesh(g, HMAT.tunnelLining()); m.matrixAutoUpdate = false; group.add(m); }
  }
  // 見える地面の高さ（木を置くとき）：トンネルの上は山の帯
  const surfaceY = (x, z, nr) => {
    if (nr && nr.s > T0 && nr.s < T1 && nr.d > -148 && nr.d < 188) return coverY(nr.s, nr.d, x, z);
    return null;
  };
  return { surfaceY, coverY };
}

// トンネルの中の度合い（0 = 外、1 = 奥）。入口・出口の 25 m でなめらかに変わる
export function tunnelFactor(s) {
  const a = Math.min(1, Math.max(0, (s - (T0 - 8)) / 30)), b = Math.min(1, Math.max(0, ((T1 + 6) - s) / 26));
  return Math.min(a, b);
}
