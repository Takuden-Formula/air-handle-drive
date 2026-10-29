// 高架橋（町の上）・谷のアーチ橋・ジャンクションの立体交差（上を渡るランプ）
import * as THREE from 'three';
import { MAT } from '../../engine/textures.js';
import { sweep, Batch, box, at, crisp } from './structures.js';
import { glowRGB } from './tex.js';
import { SEC, wallL, oppEdges } from './layout.js';

// 橋桁の断面（右の端 → 下面 → 左の端。時計回り）。gd = 桁の深さ
function deckProfile(s, gd = 2.5) {
  const e = oppEdges(s);
  const dl = -(wallL(s) + 0.45), dr = e.wall + 0.45;
  const gL0 = -6.9, gL1 = 4.9, gR0 = e.lanesIn + 0.2, gR1 = e.lanesOut - 0.2;
  return crisp([
    [dr, 0.02], [dr, -1.15], [dr - 0.35, -1.15], [dr - 1.5, -0.55],
    [gR1, -0.55], [gR1 - 0.45, -gd], [gR0 + 0.45, -gd], [gR0, -0.55],
    [gL1, -0.55], [gL1 - 0.45, -gd], [gL0 + 0.45, -gd], [gL0, -0.55],
    [dl + 1.5, -0.55], [dl + 0.35, -1.15], [dl, -1.15], [dl, 0.02],
  ]);
}
const girderCenters = (s) => { const e = oppEdges(s); return [-1.0, (e.lanesIn + e.lanesOut) / 2]; };

export function buildBridges(ctx, G) {
  const { track, mb } = ctx;
  const R = (s) => track.heightAt(s, 0);
  const conc = MAT.concrete();
  const dark = MAT.color(0x5d6166, { rough: 0.8 });
  const v = new THREE.Vector3();
  const groundAt = (s, d) => { track.toWorld(s, d, 0, v); return G.height(v.x, v.z); };
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0);
  const cols = new Batch(), caps = new Batch(), small = new Batch();

  // ---------------- 町の高架橋 ----------------
  {
    const s0 = SEC.bridge0 - 14, s1 = SEC.bridge1 + 12;
    for (const g of sweep(track, { s0, s1, step: 4, prof: (s) => deckProfile(s), uLen: 4, vLen: 4, chunk: 400 })) mb.add(g, conc);
    // 橋台（両端。地面から桁の下まで）
    for (const sa of [SEC.bridge0 + 3, SEC.bridge1 - 3]) {
      const dl = -(wallL(sa) + 0.45), dr = oppEdges(sa).wall + 0.45, w = dr - dl;
      const yb = Math.min(groundAt(sa, dl), groundAt(sa, dr), groundAt(sa, (dl + dr) / 2)) - 1;
      const h = R(sa) - 2.5 - yb;
      if (h > 0.5) caps.add(box(w, h, 2.2, (dl + dr) / 2, -h - 2.5, 0), at(track, sa, 0, 0));
    }
    // 橋脚（門形：2 本の柱＋はり）。だいたい 34 m ごと
    for (let s = SEC.bridge0 + 32; s < SEC.bridge1 - 18; s += 34) {
      const [c0, c1] = girderCenters(s), e = oppEdges(s);
      const capTop = -2.5, capH = 1.9, capL = -6.9 - 0.8, capR = e.lanesOut - 0.2 + 0.8;
      caps.add(box(capR - capL, capH, 2.4, (capL + capR) / 2, capTop - capH, 0), at(track, s, 0, 0));
      for (const c of [c0, c1]) {
        const gy = groundAt(s, c) - 0.6, top = R(s) + capTop - capH;
        const h = top - gy; if (h < 0.5) continue;
        const m = at(track, s, c, 0); m.elements[13] = gy;
        cols.add(unitCyl, m.clone().multiply(new THREE.Matrix4().makeScale(2.2, h, 3.0)));
        // 支承（はりの上、桁の下）
        for (const k of [-1.6, 1.6]) small.add(box(0.8, 0.25, 0.8, c + k, capTop - 0.25, 0), at(track, s, 0, 0));
      }
    }
  }

  // ---------------- 谷のアーチ橋 ----------------
  {
    const s0 = SEC.valley0 - 12, s1 = SEC.valley1 + 12;
    for (const g of sweep(track, { s0, s1, step: 4, prof: (s) => deckProfile(s, 1.9), uLen: 4, vLen: 4, chunk: 120 })) mb.add(g, conc);
    const sa = SEC.valley0 + 20, sb = SEC.valley1 - 20, sm = (sa + sb) / 2, half = (sb - sa) / 2;
    const ribs = girderCenters(sm);
    // アーチのリブ：放物線。足元は谷の斜面の地面の高さ
    for (const c of ribs) {
      const ya = groundAt(sa, c) + 0.5, yb = groundAt(sb, c) + 0.5;
      const crown = R(sm) - 1.9 - 0.6;
      const archY = (s) => { const u = (s - sm) / half, base = ya + (yb - ya) * (s - sa) / (sb - sa); return base + (crown - (ya + yb) / 2) * (1 - u * u); };
      const prof = () => crisp([[c + 1.3, 0], [c + 1.3, -2.0], [c - 1.3, -2.0], [c - 1.3, 0]]).map(([d, h]) => [d, h]);
      // 断面の (d, h) を外向きの o として sweep するため side = 1・d をそのまま o に使う。上面も含めて閉じる
      const closed = (s) => { const P = prof(s); return [[c - 1.3, 0], ...P, [c - 1.3, 0]]; };
      for (const g of sweep(track, { s0: sa - 2, s1: sb + 2, step: 3, prof: closed, uLen: 4, vLen: 4, chunk: 200, yFn: (s, d, h) => archY(Math.min(sb, Math.max(sa, s))) + h })) mb.add(g, conc);
      // 足元の台座
      for (const [ss, y] of [[sa, ya], [sb, yb]]) { const m = at(track, ss, c, 0); m.elements[13] = y - 6; caps.add(box(5, 7, 7), m); }
      // 鉛直材（アーチと桁をつなぐ柱）
      for (let s = sa + 7; s < sb - 4; s += 7.5) {
        const y0 = archY(s), y1 = R(s) - 1.9;
        if (y1 - y0 < 0.6) continue;
        const m = at(track, s, c, 0); m.elements[13] = y0;
        caps.add(box(1.1, y1 - y0, 1.1), m);
      }
    }
    // アーチの外の短い橋脚
    for (const s of [SEC.valley0 + 6, sa - 8, sb + 8, SEC.valley1 - 6]) {
      for (const c of ribs) {
        const gy = groundAt(s, c) - 0.6, top = R(s) - 1.9;
        if (top - gy < 0.5) continue;
        const m = at(track, s, c, 0); m.elements[13] = gy;
        cols.add(unitCyl, m.clone().multiply(new THREE.Matrix4().makeScale(1.6, top - gy, 2.2)));
      }
    }
  }
  const cg = cols.build(); if (cg) mb.add(cg, conc);
  const kg = caps.build(); if (kg) mb.add(kg, conc);
  const sg = small.build(); if (sg) mb.add(sg, dark);

  // ---------------- ジャンクションの立体交差（上を渡るランプ） ----------------
  buildFlyover(ctx, G);
}

// 立体交差のランプ：自分の道路の上を斜めに横切る 2 車線の橋（緑色の鋼の箱桁）。両端は町の地面まで下りる
export function buildFlyover(ctx, G) {
  const { track, mb } = ctx;
  const sJ = SEC.jct, R0 = track.heightAt(sJ, 0);
  const C = track.toWorld(sJ, 6, 0), h0 = track.headingAt(sJ) + 0.95;
  const Rc = 420, L = 760, N = 190;
  const deckY = R0 + 14.5;
  // 中心線（円弧）
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = -L / 2 + L * i / N, a = h0 + t / Rc;
    // 円弧の点：C から接線方向に t 進んだ所（曲率 1/Rc）
    const x = C.x + Rc * (Math.cos(h0) - Math.cos(a));
    const z = C.z - Rc * (Math.sin(a) - Math.sin(h0));
    const tt = Math.abs(t);
    const gy = G.height(x, z);
    const k = Math.min(1, Math.max(0, (tt - 70) / 260));
    const y = deckY + (gy + 0.2 - deckY) * (k * k * (3 - 2 * k));
    pts.push({ x, z, y, a, t });
  }
  const W = 4.6;   // 半幅
  const ribbon = (offs, mat, { uS = 6, vS = 6, shadow = true, lines = false } = {}) => {
    const P = [], U = [], I = [];
    pts.forEach((p, i) => {
      const rx = Math.cos(p.a), rz = Math.sin(p.a);
      offs.forEach(([o, h], j) => { P.push(p.x + rx * o, p.y + h, p.z + rz * o); U.push(p.t / uS, j / vS); });
      if (i > 0) { const n = offs.length, b = (i - 1) * n, c = i * n; for (let j = 0; j < n - 1; j++) I.push(b + j, b + j + 1, c + j, b + j + 1, c + j + 1, c + j); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeVertexNormals();
    if (lines) ctx.lines.add(g); else mb.add(g, mat, null, { shadow });
  };
  // 路面・白線・高欄・桁
  ribbon([[-W, 0], [-W / 2, 0], [0, 0], [W / 2, 0], [W, 0]], MAT.asphalt());
  ribbon([[-0.08, 0.012], [0.08, 0.012]], MAT.line(), { lines: true });
  for (const sd of [-1, 1]) ribbon([[sd * (W - 0.4) - 0.07, 0.012], [sd * (W - 0.4) + 0.07, 0.012]], MAT.line(), { lines: true });
  const par = (sd) => crisp([[W - 0.05, 0], [W - 0.05, 1.05], [W + 0.3, 1.05], [W + 0.3, -1.4]]).map(([o, h]) => [sd * o, h]);
  ribbon(par(1), MAT.concrete());
  ribbon(par(-1).reverse(), MAT.concrete());
  const green = MAT.color(0x7fa596, { rough: 0.45, metal: 0.5 });
  ribbon(crisp([[W + 0.3, -1.4], [W - 0.6, -1.4], [W - 1.2, -2.6], [-W + 1.2, -2.6], [-W + 0.6, -1.4], [-W - 0.3, -1.4]]), green);
  // 橋脚：自分の道路と反対車線の上には立てない
  const cols = new Batch(), poles = new Batch();
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 18).translate(0, 0.5, 0);
  const lampHead = new THREE.PlaneGeometry(0.5, 0.25).rotateX(Math.PI / 2);
  for (let i = 4; i < pts.length - 4; i += 8) {
    const p = pts[i], gy = G.height(p.x, p.z) - 0.5, top = p.y - 2.6;
    if (top - gy < 1.5) continue;
    const nr = track.nearest(p.x, p.z, 60);
    if (nr && nr.d > -(wallL(nr.s) + 6) && nr.d < oppEdges(nr.s).wall + 6) continue;
    cols.add(unitCyl, new THREE.Matrix4().compose(new THREE.Vector3(p.x, gy, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.a), new THREE.Vector3(2.4, top - gy, 3.2)));
  }
  for (let i = 3; i < pts.length - 3; i += 7) {
    const p = pts[i], rx = Math.cos(p.a), rz = Math.sin(p.a);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x - rx * (W + 0.1), p.y + 1.05, p.z - rz * (W + 0.1)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.a), new THREE.Vector3(1, 1, 1));
    poles.add(box(0.14, 7, 0.14), m); poles.add(box(1.6, 0.12, 0.12, 0.8, 7, 0), m);
    ctx.glow.add(lampHead, m.clone().multiply(new THREE.Matrix4().makeTranslation(1.5, 6.92, 0)), glowRGB(0xffd9a0, 5));
  }
  const cg = cols.build(); if (cg) mb.add(cg, MAT.concrete());
  const pg = poles.build(); if (pg) mb.add(pg, MAT.color(0x8c949b, { rough: 0.4, metal: 0.8 }));
  ctx.flyover = pts;
}
