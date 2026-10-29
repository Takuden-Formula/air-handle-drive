// 料金所（本線料金所）：大屋根・ブース・アイランド・ETC の開閉バー・スタートのシグナル（レースのランプと連動）・
// 料金所の事務所・照明。反対車線の料金所も同じ屋根の下にある。
import * as THREE from 'three';
import { MAT, textTexture } from '../../engine/textures.js';
import { roadDecal, lightTower } from '../../engine/props.js';
import { Batch, box, at } from './structures.js';
import { glowRGB, FONT } from './tex.js';
import { panel } from './signs.js';

// アトラスに文字の看板を描く（textTexture と同じ書き方）
function lines(bg, L) {
  return (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of L) { g.fillStyle = l.color || '#fff'; g.font = `900 ${Math.round(l.size * h)}px ${FONT}`; g.fillText(l.text, w * (l.x ?? 0.5), h * (l.y ?? 0.5), w * 0.94); } };
}
import { BOOTH, PLAZA_HALF, LINE_S, oppEdges, wallL } from './layout.js';

const ROOF_Y = 6.4;
export function buildPlaza(ctx, G) {
  const { track, mb, group } = ctx;
  const S0 = BOOTH.s0, S1 = BOOTH.s1;          // アイランドの範囲
  const R0 = 14, R1 = 44;                       // 屋根の範囲
  const e = oppEdges(30);
  const dL = -(PLAZA_HALF + 2.5), dR = e.outer + 1.5;   // 屋根の左右の端
  // レーンの中心と島の中心（自分の側：d = 0, ±4.5, ±9, ±13.5 / 反対側も同じ間隔）
  const myLanes = [], myIslands = [], oppLanes = [], oppIslands = [];
  for (let k = -3; k <= 3; k++) myLanes.push(k * BOOTH.pitch);
  for (let k = -3; k < 3; k++) myIslands.push((k + 0.5) * BOOTH.pitch);
  const oMid = (e.lanesIn + e.lanesOut) / 2;
  for (let k = -3; k <= 3; k++) oppLanes.push(oMid + k * BOOTH.pitch);
  for (let k = -3; k < 3; k++) oppIslands.push(oMid + (k + 0.5) * BOOTH.pitch);
  const edgeIsl = [-(PLAZA_HALF + 0.7), PLAZA_HALF + 0.7, e.lanesIn - 0.7, e.lanesOut + 0.7];   // 広場の両端の細い島
  const islands = [...myIslands, ...oppIslands, ...edgeIsl];

  const conc = MAT.concrete(), white = MAT.color(0xe9ecee, { rough: 0.5, metal: 0.2 }), steel = MAT.color(0x9aa2aa, { rough: 0.35, metal: 0.8 });
  const black = MAT.color(0x1a1c1f, { rough: 0.6 });
  // ---- アイランド（縁石の島）と先端の黄黒の縞 ----
  const isl = new Batch();
  const islW = (d) => (edgeIsl.includes(d) ? 0.8 : BOOTH.islandW);
  for (const d of islands) isl.add(box(islW(d), 0.28, S1 - S0, 0, 0, 0), at(track, (S0 + S1) / 2, d, 0));
  mb.add(isl.build(), conc);
  // 縞模様の板（アイランドの先端）
  const uvZ = ctx.atlas.add(64, 128, (g, w, h) => { g.fillStyle = '#f2c21b'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181b'; for (let i = -4; i < 10; i++) { g.beginPath(); g.moveTo(0, i * 20); g.lineTo(w, i * 20 + 30); g.lineTo(w, i * 20 + 40); g.lineTo(0, i * 20 + 10); g.fill(); } });
  const zb = ctx.signFaces;
  // 島の先端の縞の板（入口側は -s、出口側は +s を向く。板は島の端に立てる）
  for (const d of islands) for (const [sEnd, yaw] of [[S0 - 0.02, 0], [S1 + 0.02, Math.PI]]) {
    zb.add(panel(islW(d) * 0.95, 0.95, uvZ).translate(0, 0.28 + 0.48, 0), at(track, sEnd, d, 0, yaw));
    isl.add(box(islW(d) * 0.95, 0.95, 0.1, 0, 0.28, 0), at(track, sEnd + (yaw ? -0.06 : 0.06), d, 0, yaw));
  }
  mb.add(isl.build(), black);

  // ---- ブース（ETC 以外のレーンの横）と ETC のアンテナ ----
  const booth = new Batch(), boothGlass = new Batch();
  for (const d of [...myIslands, ...oppIslands]) {
    if (Math.abs(d) < 5 || Math.abs(d - oMid) < 5) continue;   // まん中の 2 本の島は ETC 専用レーンの間（ブースなし）
    const m = at(track, (S0 + S1) / 2 - 3, d, 0.28);
    booth.add(box(1.25, 2.5, 3.2), m);
    boothGlass.add(box(1.3, 1.0, 2.6, 0, 1.15, 0), m);
    booth.add(box(1.5, 0.15, 3.6, 0, 2.5, 0), m);
  }
  mb.add(booth.build(), white);
  mb.add(boothGlass.build(), MAT.color(0x2a3a48, { rough: 0.1, metal: 0.8 }));

  // ---- 大屋根 ----
  {
    const w = dR - dL, cx = (dL + dR) / 2, L = R1 - R0;
    const roof = new Batch();
    roof.add(box(w, 0.9, L, cx, ROOF_Y, 0), at(track, (R0 + R1) / 2, 0, 0));
    mb.add(roof.build(), MAT.color(0xd5d9dd, { rough: 0.55, metal: 0.4 }));
    // 柱（アイランドの上）
    const cols = new Batch();
    for (const d of islands) for (const s of [R0 + 4, R1 - 4]) cols.add(new THREE.CylinderGeometry(0.32, 0.36, ROOF_Y, 12).translate(0, ROOF_Y / 2 + 0.28, 0), at(track, s, d, 0));
    mb.add(cols.build(), steel);
    // 屋根の下の照明（光る板）
    const lightG = new THREE.PlaneGeometry(1.6, 0.5).rotateX(Math.PI / 2), lc = glowRGB(0xfff0d8, 3.2);
    for (const d of [...myLanes, ...oppLanes]) for (let s = R0 + 3; s < R1 - 2; s += 6) ctx.glow.add(lightG, at(track, s, d, ROOF_Y - 0.02), lc);
    // 前と後ろの看板の帯
    const uvB = ctx.atlas.add(1900, 96, lines('#0d4a2f', [{ text: '拓殖料金所     TAKUDEN  TOLL  GATE     拓殖料金所', size: 0.6 }]));
    const bandG = ctx.signFaces;
    // 入口側は -s を向く（yaw 0：ローカルの +Z が -s）。出口側は +s を向く（yaw π：左右が逆になるので中心は -cx）
    bandG.add(panel(w * 0.98, 0.86, uvB).translate(cx, 0, 0), at(track, R0 - 0.01, 0, ROOF_Y + 0.45, 0));
    bandG.add(panel(w * 0.98, 0.86, uvB).translate(-cx, 0, 0), at(track, R1 + 0.01, 0, ROOF_Y + 0.45, Math.PI));
  }

  // ---- レーンの表示（屋根の入口側：ETC 専用の紫の看板と緑の矢印） ----
  {
    const uvE = ctx.atlas.add(192, 96, lines('#7a34a8', [{ text: 'ETC', size: 0.5, y: 0.4 }, { text: '専用', size: 0.24, y: 0.8 }]));
    const uvG = ctx.atlas.add(192, 96, lines('#1b6e2a', [{ text: '一般', size: 0.5, y: 0.4 }, { text: 'ETC', size: 0.24, y: 0.8, color: '#e1bee7' }]));
    for (const d of [...myLanes, ...oppLanes]) {
      const isEtc = Math.abs(d) < 5 || Math.abs(d - oMid) < 5;
      // 自分の側は入口（s = R0）で -s 向き（yaw 0）、反対側は出口（R1）で +s 向き（yaw π。反対車線の車から見える向き）
      const mine = d < PLAZA_HALF + 2;
      const m = mine ? at(track, R0 - 0.05, d, ROOF_Y - 0.55, 0) : at(track, R1 + 0.05, d, ROOF_Y - 0.55, Math.PI);
      ctx.signFaces.add(panel(1.5, 0.75, isEtc ? uvE : uvG), m);
    }
  }

  // ---- スタートのシグナル（屋根の出口側、自分の ETC レーンの上。車の方 = -s を向く）----
  const sig = new THREE.Group(); sig.name = 'hw-start-signal'; sig.matrixAutoUpdate = false;
  sig.matrix.copy(at(track, R1 - 0.6, 0, ROOF_Y - 1.75, 0)); sig.matrixWorldNeedsUpdate = true;   // ローカルの +Z が -s（車の方）
  // 箱と吊り金具は動かないので、まとめる。「START」の文字は看板のアトラスに
  {
    const sm = at(track, R1 - 0.6, 0, ROOF_Y - 1.75, 0), hb = new Batch();
    hb.add(new THREE.BoxGeometry(5.2, 1.5, 0.35).translate(0, 0, 0.05), sm);
    hb.add(new THREE.BoxGeometry(5.2, 0.42, 0.3).translate(0, 1.0, 0), sm);
    for (const x of [-2.0, 2.0]) hb.add(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(x, 1.25, 0), sm);
    mb.add(hb.build(), MAT.color(0x121418, { rough: 0.5, metal: 0.4 }));
    const uvS = ctx.atlas.add(512, 48, lines('#111418', [{ text: 'S  T  A  R  T', size: 0.66, color: '#ffd54f' }]));
    ctx.signFaces.add(panel(5.0, 0.42, uvS).translate(0, 1.0, 0.16), sm);
  }
  const lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.24, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }), 10);
  const col = [];
  let k = 0;
  for (let i = 0; i < 5; i++) for (let r = 0; r < 2; r++) {
    lamps.setMatrixAt(k++, new THREE.Matrix4().makeTranslation((i - 2) * 0.98, 0.33 - r * 0.62, 0.235)); col.push(i);
  }
  sig.add(lamps);
  group.add(sig);
  const off = new THREE.Color(0x2a0505), on = new THREE.Color();
  const setLights = (n, color = 0xff1010) => {
    on.setHex(color).multiplyScalar(14);
    col.forEach((c, i) => lamps.setColorAt(i, c < n ? on : off));
    lamps.instanceColor.needsUpdate = true;
  };
  setLights(0);

  // ---- ETC の開閉バー（自分のレーン：アニメーション。ほかのレーンは開いたまま／閉じたまま）----
  const barGeo = new THREE.BoxGeometry(2.7, 0.09, 0.09).translate(1.35, 0, 0);
  const barTex = textTexture({ w: 256, h: 16, bg: '#ffffff', draw: (g, w, h) => { g.fillStyle = '#d32f2f'; for (let i = 0; i < 8; i += 2) g.fillRect(i * w / 8, 0, w / 8, h); } });
  const barMat = new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.4 });
  const bars = [];
  const post = new Batch(), fixedBars = new Batch();
  for (const d of [...myLanes, ...oppLanes]) {
    const mine = d < PLAZA_HALF + 2;
    const s = mine ? LINE_S : BOOTH.s0 + 3;
    // 運転する人から見て左の島の端（反対車線の人の左は +d 側）
    const pd = mine ? d - BOOTH.pitch / 2 + BOOTH.islandW / 2 + 0.1 : d + BOOTH.pitch / 2 - BOOTH.islandW / 2 - 0.1;
    const m = at(track, s, pd, 0.28, mine ? 0 : Math.PI);
    post.add(box(0.3, 1.0, 0.3), m);
    const base = m.clone().multiply(new THREE.Matrix4().makeTranslation(0.15, 0.92, 0));
    if (mine && Math.abs(d) < 0.1) {
      // 自分のレーンのバーだけ動く
      const pivot = new THREE.Group(); pivot.matrixAutoUpdate = false;
      const mesh = new THREE.Mesh(barGeo, barMat); mesh.castShadow = true; pivot.add(mesh);
      bars.push({ pivot, base, open: 1, target: 1, mine: true }); group.add(pivot);
    } else {
      const open = (Math.round(Math.abs(d - oMid) * 7 + d) % 3) === 0 ? 0 : 1;
      fixedBars.add(barGeo, base.clone().multiply(new THREE.Matrix4().makeRotationZ(open * Math.PI * 0.47)));
    }
  }
  mb.add(post.build(), MAT.color(0xf2c21b, { rough: 0.5 }));
  mb.add(fixedBars.build(), barMat);
  const _r = new THREE.Matrix4();
  const applyBars = () => { for (const b of bars) { b.pivot.matrix.copy(b.base).multiply(_r.makeRotationZ(b.open * Math.PI * 0.47)); b.pivot.matrixWorldNeedsUpdate = true; } };
  applyBars();

  // ---- 路面の表示：レーンの区切りの白線（島の先）・ETC の文字 ----
  for (const d of [...myIslands]) ctx.lines.add(roadDecal(track, S1 + 0.8, 26, d - 0.075, d + 0.075, MAT.line(), { lift: 0.02, steps: 6 }).geometry);
  const etcRoad = textTexture({ w: 256, h: 512, bg: 'rgba(0,0,0,0)', draw: (g, w, h) => { g.fillStyle = '#8e4fbf'; g.font = '900 150px sans-serif'; g.textAlign = 'center'; g.save(); g.translate(w / 2, h / 2); g.scale(1, 2.4); g.fillText('ETC', 0, 50); g.restore(); } });
  const etcMat = new THREE.MeshStandardMaterial({ map: etcRoad, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const d of myLanes) if (Math.abs(d) < 5) { const dm = roadDecal(track, 1, 7, d - 1.2, d + 1.2, etcMat, { lift: 0.02, steps: 2 }); dm.renderOrder = 2; group.add(dm); }

  // ---- 料金所の事務所（左の外）と駐車場・照明塔 ----
  {
    const s = 60, d = -(wallL(s) + 26);
    const p = track.toWorld(s, d, 0), gy = G.height(p.x, p.z);
    const m = track.placeMatrix(s, d, 0, { yaw: -Math.PI / 2 }); m.elements[13] = gy;
    const office = new Batch();
    office.add(box(30, 7.5, 14), m);
    mb.add(office.build(), MAT.color(0xdedbd2, { rough: 0.7 }));
    const win = new Batch();
    for (const y of [1.2, 4.6]) win.add(box(27, 1.6, 14.1, 0, y, 0), m);
    mb.add(win.build(), MAT.color(0xffd9a0, { rough: 0.3, emissive: 0xffc070, emissiveIntensity: 1.6 }));
    const uvO = ctx.atlas.add(900, 140, lines('#0d4a2f', [{ text: '拓殖料金所 管理事務所', size: 0.55 }]));
    ctx.signFaces.add(panel(14, 2.2, uvO).translate(0, 8.6, 7.06), m);
    mb.add(box(32, 0.9, 16, 0, 7.5, 0), MAT.color(0x5c646c, { rough: 0.5, metal: 0.4 }), m);
  }
  for (const [s, d] of [[20, -(PLAZA_HALF + 9)], [70, -(PLAZA_HALF + 6)], [70, e.outer + 6], [20, e.outer + 9]]) {
    const p = track.toWorld(s, d, 0);
    const m = track.placeMatrix(s, d, 0, { yaw: d < 0 ? -Math.PI / 2 : Math.PI / 2 }); m.elements[13] = G.height(p.x, p.z);
    lightTower(mb, m, { height: 24 });
  }

  // ---- 毎フレーム：自分のレーンのバー（ランプが点いている間は閉じ、消えたら開く）----
  return {
    setStartLights(n, color) { setLights(n, color); },
    update(dt, info) {
      const st = info && info.state;
      for (const b of bars) {
        if (!b.mine) continue;
        b.target = st === 'lights' ? 0 : 1;
        if (st === 'select') b.target = 0;
        const sp = b.target > b.open ? 1.6 : 3;
        b.open += Math.max(-sp * dt, Math.min(sp * dt, b.target - b.open));
      }
      applyBars();
    },
  };
}
