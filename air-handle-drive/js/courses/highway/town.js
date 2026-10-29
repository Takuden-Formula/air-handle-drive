// 町と遠景：高架のまわりの町（ビル・家・道・街灯）、高架の下の道、川（夕焼けを映す水面）、料金所のまわりの田んぼ、
// 送電線の鉄塔、遠くの高層ビル群（航空障害灯が点滅）、電波塔、山の林。
import * as THREE from 'three';
import { MAT, mulberry32 } from '../../engine/textures.js';
import { Forest } from '../../engine/props.js';
import { Batch, box } from './structures.js';
import { HMAT, glowRGB } from './tex.js';
import { panel as panelUV } from './signs.js';
import { SEC, wallL, oppEdges, BASE } from './layout.js';
import { VALLEY_S, VALLEY_FLOOR } from './ground.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 水面（川・田んぼ）：空を映す。少し揺らぐ法線（シェーダの時間）
let waterMat = null;
export function waterMaterial() {
  if (waterMat) return waterMat;
  const m = new THREE.MeshStandardMaterial({ name: 'hw-water', color: 0x2a3c46, roughness: 0.035, metalness: 0.0, envMapIntensity: 1.7, vertexColors: true });
  m.userData.time = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = m.userData.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform float uTime;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec2 p = vWPos.xz;
    float a = sin(p.x * 0.9 + uTime * 1.3) * 0.5 + sin(p.y * 1.3 - uTime * 1.1) * 0.5 + sin((p.x + p.y) * 2.7 + uTime * 2.1) * 0.25;
    float b = cos(p.x * 1.1 - uTime * 0.9) * 0.5 + cos(p.y * 0.8 + uTime * 1.6) * 0.5 + cos((p.x - p.y) * 3.1 - uTime * 1.7) * 0.25;
    normal = normalize(normal + (viewMatrix * vec4(a * 0.035, 0.0, b * 0.035, 0.0)).xyz); }`);
  };
  m.customProgramCacheKey = () => 'hw-water';
  waterMat = m;
  return m;
}

export function buildTown(ctx, G, extra = {}) {
  const { track, mb, group } = ctx;
  const rnd = mulberry32(4711);
  const v = new THREE.Vector3();
  const flyPts = ctx.flyover || [];
  const nearFly = (x, z, r) => { for (let i = 0; i < flyPts.length; i += 2) { const p = flyPts[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true; } return false; };
  const riverD = (x, z) => { const R = G.river; return Math.abs((x - R.x) * R.tz - (z - R.z) * R.tx + Math.sin(((x - R.x) * R.tx + (z - R.z) * R.tz) / 160) * 22); };
  const surf = extra.surfaceY || ((x, z) => null);
  const groundY = (x, z, nr) => { const s = surf(x, z, nr); return s ?? G.height(x, z, nr); };

  // ================= 町（高架のまわり） =================
  const sC = 720, pc = track.toWorld(sC, 0, 0), ang = track.headingAt(sC);
  const ux = Math.sin(ang), uz = -Math.cos(ang), rx = Math.cos(ang), rz = Math.sin(ang);   // 町の格子の向き（道路の向きにそろえる）
  const BLK = 52, ST = 9;                                    // 区画の大きさと道の幅
  const styles = [0, 1, 2, 3, 4, 5];
  const bld = styles.map(() => new Batch());
  const roofs = new Batch(), roofCols = [];
  const houses = new Batch();
  const streets = [], lampsPos = [];
  const winGlow = [];
  const signs = [];
  const aviation = [];
  const ctxForestExtra = [];   // 農家のまわりの木
  // ビル 1 棟：UV は「横 3.2 m × 8 区画、縦 3.4 m × 8 階」で 1 枚
  const addBuilding = (x, z, w, d, h, yaw, style, gy) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = n.getX(i), ny = n.getY(i);
      const along = Math.abs(nx) > 0.5 ? p.getZ(i) : p.getX(i);
      if (Math.abs(ny) > 0.5) uv.setXY(i, 0.97, 0.97);
      else uv.setXY(i, (along + 50) / (3.2 * 8), (p.getY(i) + h / 2) / (3.4 * 8));
    }
    g.translate(0, h / 2, 0);
    const m = new THREE.Matrix4().compose(v.set(x, gy - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    bld[style].add(g, m);
    // 屋上（設備・へり）
    const roofC = [[0.42, 0.43, 0.45], [0.5, 0.48, 0.45], [0.35, 0.37, 0.4]][Math.floor(rnd() * 3)];
    roofs.add(box(w + 0.3, 0.6, d + 0.3, 0, h, 0), m, roofC);
    if (h > 14 && rnd() < 0.7) roofs.add(box(w * (0.25 + rnd() * 0.2), 2.4, d * (0.25 + rnd() * 0.2), (rnd() - 0.5) * w * 0.3, h + 0.6, (rnd() - 0.5) * d * 0.3), m, [0.55, 0.56, 0.58]);
    // 航空障害灯（高いビル）
    if (h > 45) aviation.push(new THREE.Vector3(x, gy + h + 1, z));
    return m;
  };
  const addHouse = (x, z, yaw, gy) => {
    const w = 7 + rnd() * 3, d = 8 + rnd() * 3, h = 5.6 + rnd() * 0.8;
    const m = new THREE.Matrix4().compose(v.set(x, gy - 0.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    const wall = [[0.86, 0.83, 0.76], [0.78, 0.74, 0.66], [0.9, 0.9, 0.88], [0.66, 0.6, 0.52], [0.74, 0.78, 0.8]][Math.floor(rnd() * 5)];
    houses.add(box(w, h, d), m, wall);
    // 切妻屋根（三角柱）
    const roof = new THREE.BufferGeometry();
    const hw = w / 2 + 0.4, hd = d / 2 + 0.4, rh = 2.2;
    const P = [-hw, h, -hd, hw, h, -hd, 0, h + rh, -hd, -hw, h, hd, 0, h + rh, hd, hw, h, hd];
    const I = [0, 2, 1, 3, 5, 4, 0, 3, 4, 0, 4, 2, 1, 2, 4, 1, 4, 5];
    roof.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); roof.setIndex(I); roof.computeVertexNormals();
    const rc = [[0.18, 0.2, 0.24], [0.32, 0.18, 0.12], [0.16, 0.24, 0.34], [0.28, 0.28, 0.3]][Math.floor(rnd() * 4)];
    houses.add(roof.toNonIndexed(), m, rc);
    // 窓の明かり（夕方：半分くらいの家）
    if (rnd() < 0.55) winGlow.push([m, w, d, h]);
  };
  const S0 = SEC.embank0 - 30, S1 = SEC.bridge1 + 60;
  for (let gi = -12; gi <= 12; gi++) for (let gj = -10; gj <= 10; gj++) {
    const cx = pc.x + ux * gi * BLK + rx * gj * BLK, cz = pc.z + uz * gi * BLK + rz * gj * BLK;
    const nr = track.nearest(cx, cz, 520);
    if (!nr) continue;
    if (nr.s < S0 || nr.s > S1) continue;
    const ad = Math.abs(nr.d);
    if (ad < 34 || ad > 430) continue;
    if (riverD(cx, cz) < 38) continue;
    if (Math.abs(G.height(cx, cz, nr) - BASE) > 4) continue;   // 平らな所だけ（山・谷にはビルを建てない）
    // この区画の道（区画の 2 辺）
    streets.push([cx - ux * BLK / 2 - rx * BLK / 2, cz - uz * BLK / 2 - rz * BLK / 2, 'u'], [cx - ux * BLK / 2 - rx * BLK / 2, cz - uz * BLK / 2 - rz * BLK / 2, 'r']);
    const inner = BLK - ST;
    const far = ad > 230 || rnd() < 0.18;
    if (far) {
      // 住宅地：家を 2 × 3 軒
      for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) {
        if (rnd() < 0.15) continue;
        const hx = cx + ux * (a - 0.5) * inner * 0.5 + rx * (b - 1) * inner * 0.32, hz = cz + uz * (a - 0.5) * inner * 0.5 + rz * (b - 1) * inner * 0.32;
        if (nearFly(hx, hz, 16) || riverD(hx, hz) < 30) continue;
        addHouse(hx, hz, -ang + (rnd() < 0.5 ? 0 : Math.PI / 2), G.height(hx, hz));
      }
      continue;
    }
    // ビル街：区画を 1〜4 つに分ける
    const n = rnd() < 0.3 ? 1 : rnd() < 0.6 ? 2 : 4;
    for (let k = 0; k < n; k++) {
      const ox = n === 4 ? (k % 2 - 0.5) * inner * 0.5 : n === 2 ? (k - 0.5) * inner * 0.5 : 0;
      const oz = n === 4 ? (Math.floor(k / 2) - 0.5) * inner * 0.5 : 0;
      const bx = cx + ux * ox + rx * oz, bz = cz + uz * ox + rz * oz;
      if (nearFly(bx, bz, 20) || riverD(bx, bz) < 34) continue;
      const w = (n === 1 ? inner * 0.8 : inner * 0.42) * (0.75 + rnd() * 0.25), dd = (n === 4 ? inner * 0.42 : inner * 0.8) * (0.7 + rnd() * 0.3);
      // 高さ：道路のすぐ近くは低め、少し離れると高いビルも
      const tallK = clamp((ad - 60) / 120, 0, 1);
      let floors = 3 + Math.floor(rnd() * (4 + 10 * tallK));
      if (rnd() < 0.08 * tallK) floors += 10 + Math.floor(rnd() * 12);
      const h = floors * 3.4;
      const gy = G.height(bx, bz);
      const m = addBuilding(bx, bz, w, dd, h, -ang, styles[Math.floor(rnd() * styles.length)], gy);
      // 屋上の光る看板（高架から見えるように、道路の方を向ける）
      if (h > 20 && h < 60 && rnd() < 0.22 && signs.length < 8) signs.push({ m, w, dd, h, side: nr.d < 0 ? 1 : -1 });
    }
  }
  for (let i = 0; i < 6; i++) { const g = bld[i].build(); if (g) mb.add(g, HMAT.facade(i)); }
  { const g = roofs.build(); if (g) mb.add(g, props_vc()); }
  { const g = houses.build(); if (g) mb.add(g, props_vc()); }
  // 家の窓の明かり（光る小さな四角）
  for (const [m, w, d, h] of winGlow) {
    const c = rnd() < 0.8 ? glowRGB(0xffc27a, 2.2) : glowRGB(0xcfe3ff, 1.6);
    for (const y of [1.4, 4.0]) if (rnd() < 0.7) ctx.glow.add(new THREE.PlaneGeometry(1.4, 1.0).translate((rnd() - 0.5) * w * 0.5, y, d / 2 + 0.02), m, c);
  }
  // 屋上の看板
  const signTexts = [['拓殖大学', '#0f2f6b', '#ffffff'], ['TAKUDEN', '#c62828', '#ffffff'], ['電気自動車同好会', '#111418', '#ffd54f'], ['EV POWER', '#0f4fb4', '#ffffff'], ['学生フォーミュラ', '#1b5e20', '#ffffff'], ['ZERO EMISSION', '#111418', '#4fc3f7']];
  signs.forEach((sg, i) => {
    const [txt, bg, fg] = signTexts[i % signTexts.length];
    const uv = ctx.neon.atlas.add(500, 125, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = fg; g.font = `900 ${Math.round(h * 0.56)}px ${'"Meiryo","Yu Gothic UI",sans-serif'}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2, w * 0.9); });
    const sw = Math.min(sg.w * 0.9, 18);
    const e = sg.m.elements, yaw = Math.atan2(sg.side * rx, sg.side * rz);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(e[12], e[13] + sg.h + 3.4, e[14]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    ctx.neon.faces.add(panelUV(sw, sw / 4, uv), m);
    roofs.add(box(sw, sw / 4 + 0.3, 0.3, 0, -sw / 8 - 0.15, -0.2), m, [0.18, 0.18, 0.2]);
    roofs.add(box(0.15, 3.4, 0.15, -sw * 0.35, -3.4 - sw / 8, -0.3), m, [0.3, 0.3, 0.32]); roofs.add(box(0.15, 3.4, 0.15, sw * 0.35, -3.4 - sw / 8, -0.3), m, [0.3, 0.3, 0.32]);
  });
  { const g = roofs.build(); if (g) mb.add(g, props_vc()); }

  // 町の道（格子）と街灯
  {
    const asphalt = MAT.asphalt();
    const sb = new Batch();
    const seen = new Set();
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (const [x, z, dir] of streets) {
      const key = Math.round(x) + ',' + Math.round(z) + dir; if (seen.has(key)) continue; seen.add(key);
      const dx = dir === 'u' ? ux : rx, dz = dir === 'u' ? uz : rz;
      const mx = x + dx * BLK / 2, mz = z + dz * BLK / 2;
      const nr = track.nearest(mx, mz, 520);
      if (!nr || Math.abs(nr.d) < 30 || riverD(mx, mz) < 24) continue;
      const gy = G.height(mx, mz) + 0.06;
      const yaw = Math.atan2(dx, dz);
      const m = new THREE.Matrix4().compose(v.set(mx, gy, mz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(ST, 1, BLK + ST));
      sb.add(quad, m);
      if (rnd() < 0.8) lampsPos.push([x + dx * BLK * 0.25 + dz * ST * 0.55, z + dz * BLK * 0.25 - dx * ST * 0.55]);
    }
    const g = sb.build(); if (g) { const uvA = g.attributes.uv, pA = g.attributes.position; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, pA.getX(i) / 6, pA.getZ(i) / 6); mb.add(g, asphalt, null, { shadow: false }); }
  }
  // 高架の下の道（橋脚の間）と、その街灯
  {
    const sb = new Batch(), quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let s = SEC.bridge0 + 10; s < SEC.bridge1 - 10; s += 4) {
      const e = oppEdges(s), d0 = 1.6, d1 = e.lanesIn + 0.2 - 1.6, dc = (d0 + d1) / 2;
      track.toWorld(s, dc, 0, v);
      const gy = G.height(v.x, v.z) + 0.05;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(v.x, gy, v.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -track.headingAt(s)), new THREE.Vector3(d1 - d0, 1, 4.2));
      sb.add(quad, m);
      if (Math.round(s) % 32 === 0) lampsPos.push([v.x, v.z]);
    }
    const g = sb.build(); if (g) { const uvA = g.attributes.uv, pA = g.attributes.position; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, pA.getX(i) / 6, pA.getZ(i) / 6); mb.add(g, MAT.asphalt(), null, { shadow: false }); }
  }
  {
    const poles = new Batch(), poleG = new THREE.CylinderGeometry(0.06, 0.09, 6, 6).translate(0, 3, 0), headG = new THREE.OctahedronGeometry(0.24).translate(0, 6.1, 0);
    const lc = glowRGB(0xffc46b, 5);
    for (const [x, z] of lampsPos) {
      const gy = G.height(x, z);
      const m = new THREE.Matrix4().makeTranslation(x, gy, z);
      poles.add(poleG, m); ctx.glow.add(headG, m, lc);
    }
    const g = poles.build(); if (g) mb.add(g, MAT.color(0x5b6168, { rough: 0.5, metal: 0.6 }), null, { shadow: false });
    // 街灯の下の光だまり
    const pm = new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffa04a, transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pb = new Batch(), q = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2);
    for (const [x, z] of lampsPos) pb.add(q, new THREE.Matrix4().makeTranslation(x, G.height(x, z) + 0.12, z));
    const pg = pb.build(); if (pg) { const pmesh = new THREE.Mesh(pg, pm); pmesh.renderOrder = 2; pmesh.matrixAutoUpdate = false; pmesh.name = 'hw-townpools'; group.add(pmesh); }
  }

  // ================= 川（夕焼けを映す水面） =================
  {
    const R = G.river, wpos = [], wcol = [], widx = [];
    const N = 120, span = 1400, half = R.w + 4;
    for (let i = 0; i <= N; i++) {
      const a = -span / 2 + span * i / N, off = Math.sin(a / 160) * 22;
      // 川の中心線：perp の式の off を打ち消す位置
      // riverD() が 0 になる所（川の中心）。n = (tz, -tx) が川の横向き
      const cx = R.x + R.tx * a - R.tz * off, cz = R.z + R.tz * a + R.tx * off;
      for (const sd of [-1, 1]) {
        const x = cx + R.tz * sd * half, z = cz - R.tx * sd * half;
        wpos.push(x, BASE - R.depth + 0.9, z); wcol.push(1, 1, 1);
      }
      if (i > 0) { const b = (i - 1) * 2; widx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
    g.setIndex(widx); g.computeVertexNormals();
    // 法線が下向きになっていたら面を裏返す
    if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMaterial()); m.name = 'hw-river'; m.receiveShadow = true; m.matrixAutoUpdate = false;
    group.add(m);
  }

  // ================= 谷の小川 =================
  {
    const pos = [], col = [], idx = [];
    let n = 0;
    for (let d = -460; d <= 460; d += 10) {
      for (const side of [-1, 1]) { track.toWorld(VALLEY_S + side * 6.5, d, 0, v); pos.push(v.x, VALLEY_FLOOR - 1.6, v.z); col.push(0.75, 0.85, 0.8); }
      if (n > 0) { const b = (n - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMaterial()); m.name = 'hw-creek'; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m);
  }

  // ================= 料金所のまわりの田んぼ（水を張った田。空を映す） =================
  {
    const wb = new Batch(), dikes = new Batch();
    const cell = 26;
    for (let s = 30; s < SEC.embank0 - 10; s += cell + 2) for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
      const d = side * (wallL(s) + 26 + k * (cell + 2) + (side > 0 ? oppEdges(s).wall - wallL(s) : 0));
      if (rnd() < 0.18) continue;
      track.toWorld(s, d, 0, v);
      if (s < 90 && Math.abs(d) < 70) continue;   // 料金所の事務所
      const gy = G.height(v.x, v.z);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(v.x, gy + 0.08, v.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -track.headingAt(s)), new THREE.Vector3(1, 1, 1));
      const tint = 0.7 + rnd() * 0.3;
      wb.add(new THREE.PlaneGeometry(cell, cell).rotateX(-Math.PI / 2), m, [tint * 0.9, tint, tint * 0.85]);
      dikes.add(box(cell + 1.6, 0.3, 0.9, 0, 0, cell / 2 + 0.5), m, [0.36, 0.33, 0.24]);
      dikes.add(box(0.9, 0.3, cell + 1.6, cell / 2 + 0.5, 0, 0), m, [0.36, 0.33, 0.24]);
    }
    const g = wb.build(); if (g) { const mesh = new THREE.Mesh(g, waterMaterial()); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.name = 'hw-paddies'; group.add(mesh); }
    const dg = dikes.build(); if (dg) mb.add(dg, props_vc(), null, { shadow: false });
  }

  // ================= 料金所のまわりの物流倉庫・農家 =================
  {
    const wh = new Batch(), whWin = [];
    const logos = [['拓殖運輸 物流センター', '#0f4fb4'], ['TAKUDEN LOGISTICS', '#1b5e20'], ['EV パーツ倉庫', '#c62828']];
    let li = 0;
    for (const [s, d] of [[150, -120], [250, 135], [330, -170], [90, 190]]) {
      track.toWorld(s, d, 0, v);
      const nr = track.nearest(v.x, v.z, 600), gy = G.height(v.x, v.z, nr);
      const W = 70 + rnd() * 30, D = 34 + rnd() * 14, H = 13 + rnd() * 5;
      const yaw = -track.headingAt(s) + (d < 0 ? 0 : Math.PI);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(v.x, gy - 0.2, v.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2), new THREE.Vector3(1, 1, 1));
      wh.add(box(W, H, D), m, [0.78, 0.79, 0.8]);
      wh.add(box(W + 1, 0.8, D + 1, 0, H, 0), m, [0.46, 0.5, 0.55]);
      for (let k = 0; k < 6; k++) wh.add(box(4.2, 4.6, 0.3, -W / 2 + 8 + k * (W - 16) / 5, 0, D / 2 + 0.1), m, [0.35, 0.37, 0.4]);   // 搬入口のシャッター
      wh.add(box(W - 6, 1.4, 0.2, 0, H - 4, D / 2 + 0.12), m, [0.2, 0.25, 0.3]);                  // 窓の帯
      // 屋根の下の看板（道路の方へ向ける面 = +Z）
      const [txt, bg] = logos[li++ % logos.length];
      const uv = ctx.atlas.add(960, 120, (g, w, h) => { g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h); g.fillStyle = bg; g.font = `900 ${Math.round(h * 0.6)}px "Meiryo","Yu Gothic UI",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2, w * 0.92); });
      ctx.signFaces.add(panelUV(W * 0.6, W * 0.6 / 8, uv).translate(0, H - 1.6, D / 2 + 0.25), m);
      for (let k = 0; k < 6; k++) whWin.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(-W / 2 + 8 + k * (W - 16) / 5, 5.2, D / 2 + 0.4)));
    }
    mb.add(wh.build(), props_vc());
    for (const m of whWin) ctx.glow.add(new THREE.OctahedronGeometry(0.28), m, glowRGB(0xffd29a, 5));
    // 農家（屋敷林のある家）
    for (let i = 0; i < 14; i++) {
      const s = 40 + rnd() * 300, side = rnd() < 0.5 ? -1 : 1, d = side * (90 + rnd() * 260);
      track.toWorld(s, d, 0, v);
      if (riverD(v.x, v.z) < 40) continue;
      const nr = track.nearest(v.x, v.z, 600), gy = G.height(v.x, v.z, nr);
      addHouse(v.x, v.z, -track.headingAt(s) + rnd(), gy);
      for (let k = 0; k < 5; k++) { const a = rnd() * 6.28, r = 9 + rnd() * 6; ctxForestExtra.push([v.x + Math.cos(a) * r, gy, v.z + Math.sin(a) * r]); }
    }
    const hg = houses.build(); if (hg) mb.add(hg, props_vc());
  }

  // ================= 送電線の鉄塔と電線 =================
  {
    const steelLattice = MAT.color(0x9aa3ab, { rough: 0.5, metal: 0.7 });
    const towers = new Batch();
    const a0 = track.toWorld(150, -420, 0), a1 = track.toWorld(1500, 520, 0);
    const N = 9, H = 52;
    const tops = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = a0.x + (a1.x - a0.x) * t, z = a0.z + (a1.z - a0.z) * t;
      const nr = track.nearest(x, z, 60);
      if (nr && Math.abs(nr.d) < 40) { tops.push(null); continue; }
      const gy = groundY(x, z, track.nearest(x, z, 600));
      const yaw = Math.atan2(a1.x - a0.x, a1.z - a0.z);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, gy, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
      // 4 本の脚（上に向かって細くなる）・腕（3 段）
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lg = new THREE.CylinderGeometry(0.12, 0.2, H, 4);
        const tilt = Math.atan2(3.2, H);
        lg.rotateX(sz * tilt).rotateZ(-sx * tilt).translate(sx * 1.9, H / 2, sz * 1.9);
        towers.add(lg, m);
      }
      for (let k = 0; k < 8; k++) { const y = 6 + k * 5.6, w = 7.4 - k * 0.6; towers.add(box(w, 0.14, 0.14, 0, y, w / 2 * 0), m); towers.add(box(0.14, 0.14, w, 0, y, 0), m); }
      for (const [y, w] of [[H - 16, 13], [H - 9, 15], [H - 2, 12]]) towers.add(box(w, 0.5, 0.5, 0, y, 0), m);
      towers.add(new THREE.ConeGeometry(0.8, 4, 4).translate(0, H + 2, 0), m);
      tops.push({ m, x, z, gy });
    }
    mb.add(towers.build(), steelLattice);
    // 電線：となりの鉄塔の腕の先どうしを、たるんだ線で結ぶ
    const pts = [];
    for (let i = 0; i < tops.length - 1; i++) {
      const A = tops[i], B = tops[i + 1]; if (!A || !B) continue;
      for (const [y, w] of [[H - 16, 13], [H - 9, 15], [H - 2, 12]]) for (const sd of [-1, 1]) {
        const pa = new THREE.Vector3(sd * w / 2, y - 0.6, 0).applyMatrix4(A.m), pb = new THREE.Vector3(sd * w / 2, y - 0.6, 0).applyMatrix4(B.m);
        let prev = pa;
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, p = pa.clone().lerp(pb, t); p.y -= Math.sin(t * Math.PI) * 6;
          pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p;
        }
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2b2a2e, transparent: true, opacity: 0.75 }));
    lines.name = 'hw-wires'; lines.matrixAutoUpdate = false; group.add(lines);
  }

  // ================= 遠くの高層ビル群・電波塔 =================
  {
    const base = track.toWorld(760, 0, 0), h = track.headingAt(760);
    const rX = Math.cos(h), rZ = Math.sin(h), fX = Math.sin(h), fZ = -Math.cos(h);
    const far = [new Batch(), new Batch()];
    for (let i = 0; i < 70; i++) {
      const along = (rnd() - 0.4) * 900, side = 950 + rnd() * 650;
      const x = base.x + rX * side + fX * along, z = base.z + rZ * side + fZ * along;
      const hh = 50 + Math.pow(rnd(), 1.6) * 190, w = 22 + rnd() * 26, d = 22 + rnd() * 26;
      const gy = Math.min(G.base(x, z), BASE - 2) - 1;   // 遠景のビルは遠くの平地（地面のメッシュの外）に立てる
      const g = new THREE.BoxGeometry(w, hh, d);
      const uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
      for (let k = 0; k < uv.count; k++) { const along2 = Math.abs(n.getX(k)) > 0.5 ? p.getZ(k) : p.getX(k); if (Math.abs(n.getY(k)) > 0.5) uv.setXY(k, 0.97, 0.97); else uv.setXY(k, (along2 + 50) / 25.6, (p.getY(k) + hh / 2) / 27.2); }
      g.translate(0, hh / 2, 0);
      far[i % 2].add(g, new THREE.Matrix4().compose(new THREE.Vector3(x, gy, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h + (rnd() - 0.5) * 0.3), new THREE.Vector3(1, 1, 1)));
      if (hh > 90) aviation.push(new THREE.Vector3(x, gy + hh + 1.5, z));
    }
    const g0 = far[0].build(), g1 = far[1].build();
    if (g0) mb.add(g0, HMAT.facade(5), null, { shadow: false });
    if (g1) mb.add(g1, HMAT.facade(2), null, { shadow: false });
    // 電波塔（634 m の塔の縮小版。遠くの目印）
    const tx = base.x + rX * 1700 + fX * 500, tz = base.z + rZ * 1700 + fZ * 500, ty = G.base(tx, tz) - 2;
    const tower = new Batch();
    tower.add(new THREE.CylinderGeometry(3, 22, 340, 3, 1).translate(0, 170, 0), new THREE.Matrix4().makeTranslation(tx, ty, tz));
    tower.add(new THREE.CylinderGeometry(10, 10, 14, 16).translate(0, 250, 0), new THREE.Matrix4().makeTranslation(tx, ty, tz));
    tower.add(new THREE.CylinderGeometry(7, 7, 10, 16).translate(0, 300, 0), new THREE.Matrix4().makeTranslation(tx, ty, tz));
    tower.add(new THREE.CylinderGeometry(0.8, 2.5, 90, 8).translate(0, 385, 0), new THREE.Matrix4().makeTranslation(tx, ty, tz));
    mb.add(tower.build(), MAT.color(0xc9d1d8, { rough: 0.5, metal: 0.6 }), null, { shadow: false });
    for (const y of [250, 300]) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; ctx.glow.add(new THREE.PlaneGeometry(2.5, 1.2).translate(0, 0, 0.1).rotateY(a), new THREE.Matrix4().makeTranslation(tx + Math.sin(a) * (y === 250 ? 10.1 : 7.1), ty + y, tz + Math.cos(a) * (y === 250 ? 10.1 : 7.1)), glowRGB(0x9fd8ff, 3)); }
    aviation.push(new THREE.Vector3(tx, ty + 431, tz), new THREE.Vector3(tx, ty + 258, tz + 10.5));
  }
  // 航空障害灯（赤く点滅）
  const avMat = new THREE.MeshBasicMaterial({ color: 0xff2010, fog: false, name: 'hw-aviation' });
  let avMesh = null;
  {
    const b = new Batch(), sph = new THREE.OctahedronGeometry(1.6);
    for (const p of aviation) b.add(sph, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    const g = b.build(); if (g) { avMesh = new THREE.Mesh(g, avMat); avMesh.name = 'hw-aviation'; avMesh.matrixAutoUpdate = false; avMesh.frustumCulled = false; group.add(avMesh); }
  }

  // ================= 林（山・谷・町はずれ） =================
  // 道の近く（影を落とす）と遠く（影なし）で分ける：木の InstancedMesh は全体で 1 つの塊なので、
  // 影の描画で全部の木を描かないように
  const forestNear = new Forest(), forestFar = new Forest();
  {
    const b = track.bounds, margin = 520, N = 6000;
    let placed = 0;
    for (let i = 0; i < N && placed < 2300; i++) {
      const x = b.x0 - margin + rnd() * (b.x1 - b.x0 + 2 * margin), z = b.z0 - margin + rnd() * (b.z1 - b.z0 + 2 * margin);
      const nr = track.nearest(x, z, 600);
      if (!nr) continue;
      const s = nr.s, ad = Math.abs(nr.d);
      // 道路のすぐ近くは置かない（法面・防音壁の外 6 m まで）
      const clear = nr.d < 0 ? wallL(s) + 10 : oppEdges(s).wall + 10;
      if (ad < clear) continue;
      // 町・田んぼ・川の上は置かない（町はずれにだけ少し）
      const townZone = s > SEC.embank0 - 80 && s < SEC.bridge1 + 40 && ad < 440;
      if (townZone && rnd() < 0.92) continue;
      if (s < SEC.embank0 - 40 && ad < 260 && rnd() < 0.85) continue;
      if (riverD(x, z) < 30) continue;
      if (nearFly(x, z, 14)) continue;
      const y = groundY(x, z, nr);
      if (Math.abs(s - VALLEY_S) < 12 && ad < 470) continue;   // 小川の上
      const r = rnd(), kind = y > BASE + 12 ? (r < 0.6 ? 'conifer' : 'broadleaf') : (r < 0.3 ? 'conifer' : r < 0.9 ? 'broadleaf' : 'bush');
      (ad < 70 ? forestNear : forestFar).add(kind, x, y - 0.2, z, 0.85 + rnd() * 0.6, rnd() * 6.28, (rnd() - 0.5) * 0.18);
      placed++;
    }
    for (const [x, y, z] of ctxForestExtra) forestFar.add(rnd() < 0.6 ? 'broadleaf' : 'conifer', x, y - 0.2, z, 0.9 + rnd() * 0.5, rnd() * 6.28);
    forestNear.build(group, { shadows: true });
    forestFar.build(group, { shadows: false });
  }

  return {
    update(dt, time) {
      waterMaterial().userData.time.value = time;
      // 航空障害灯：1.5 秒ごとに点滅
      const on = (time % 1.5) < 0.75;
      avMat.color.setRGB(on ? 6 : 0.25, on ? 0.6 : 0.02, on ? 0.3 : 0.01);
    },
  };
}
let _vc = null;
function props_vc() { if (!_vc) _vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, name: 'hw-vc' }); return _vc; }
let _pool = null;
function poolTexture() {
  if (_pool) return _pool;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _pool = new THREE.CanvasTexture(c); _pool.colorSpace = THREE.SRGBColorSpace; return _pool;
}
