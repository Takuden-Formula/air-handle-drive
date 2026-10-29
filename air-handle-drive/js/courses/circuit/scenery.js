// サーキットの景色を組み立てる（course.decorate の中身）。
// ここでは「どこに何を置くか」だけを書き、部品の形は ./parts.js、看板の絵は ./atlas.js、
// 路面やコース脇の帯（ラバー・タイヤバリアの帯・金網の広告・ランオフの色）は ./trackside.js にある。
// 描画の呼び出しを減らすため、動かない物はすべて ctx.mb（MergeBuilder）へ。看板はアトラスの 1 つの材質。
import * as THREE from 'three';
import { startArea, finishArea } from '../common.js';
import { circuitAtlas, slotPlane } from './atlas.js';
import * as P from './parts.js';
import { roadPaint, rubberLine, tireBelts, fenceBanners, runoffBands, pitDebrisFence, runoffLogos } from './trackside.js';

export function decorateCircuit(ctx) {
  const { track, mb, forest, props, group, rnd, layout, deco } = ctx;
  const M = layout.marks, L = track.length, half = track.halfWidth(0);
  const place = ctx.place;
  const A = circuitAtlas();
  const sLine = layout.sLine;
  const blocked = [];   // 木を植えない場所（建物など）: { x, z, r }
  const block = (s, d, r) => { const p = track.toWorld(s, d, 0); blocked.push({ x: p.x, z: p.z, r }); };
  const W = (s, d) => track.toWorld(s, d, 0);
  const b0 = track.bounds;

  // ===================== スタート / ゴール =====================
  // ふつう（1 周）はメインストレートがゴール。みじかい・ながいは東ストレートにゴールのゲートを置く
  const lapFinish = Math.abs(ctx.raceLength - (L + 3)) < 1;
  const sa = startArea(ctx, sLine, { label: 'TAKUDEN GRAND PRIX', finishHere: lapFinish, grid: 0 });   // グリッドの枠は roadPaint で 1 つにまとめて描く
  if (!lapFinish) finishArea(ctx, track.wrap(ctx.startS + ctx.raceLength), { label: 'FINISH' });

  // ===================== メインストレート：グランドスタンド（左・西） =====================
  const fenceD = track.barrierD(90, -1);
  const gsLen = 150, gsS = 95;
  const gs = P.mainGrandstand(mb, place(gsS, -(fenceD + 4.2)), A, { length: gsLen, rows: 16, rows2: 9 });
  for (let s = gsS - gsLen / 2; s <= gsS + gsLen / 2; s += 25) block(s, -(fenceD + 4.2 + gs.depth / 2), gs.depth * 0.7 + 4);
  // スタンドの裏の売店
  [30, 70, 120, 160].forEach((s, i) => P.kiosk(mb, place(s, -(fenceD + 4.2 + gs.depth + 8)), { w: 9, d: 5, roof: [0xc62828, 0x1565c0, 0xffc928, 0x2e7d32][i] }));

  // ===================== ピット（右・東）：ピットレーン・ピットビル・ピットウォール =====================
  const pitFront = layout.pitD1 ?? (half + 15.5);
  const pitLen = 150, pitS = 96;
  roadPaint(ctx, sLine, { pitS, pitLen, garages: 15 });   // グリッドの枠と番号・ピットレーンの線
  P.pitBuilding(mb, place(pitS, pitFront + 0.2), A, { length: pitLen, depth: 18, garages: 15 });
  for (let s = pitS - pitLen / 2; s <= pitS + pitLen / 2; s += 25) block(s, pitFront + 10, 16);
  // ピットウォールのチームの台（ピットレーン側）
  const wallD = track.barrierD(90, 1);
  for (let i = 0; i < 7; i++) {
    const s = pitS - pitLen / 2 + 12 + i * 21;
    P.pitWallStand(mb, place(s, wallD + 0.3, { back: true }), new THREE.Color(A.teamColors[(i * 2) % 12]).getHex());
  }
  pitDebrisFence(ctx, -40, M.T1 - 8);
  // ピットウォールの先端（入口側）の衝撃吸収クッション。右側の部品は +X が進む向きの逆
  P.crashCushion(mb, place(L - 37, track.barrierD(L - 37, 1) + 0.05));
  // コントロールタワー（ピットビルの北の端）と大きな画面（ピットビルの屋上、スタンドに向けて）
  P.controlTower(mb, place(pitS + pitLen / 2 + 10, pitFront + 13), A, { floors: 5 });
  block(pitS + pitLen / 2 + 10, pitFront + 13, 14);
  P.bigScreen(mb, place(pitS - 20, pitFront + 13, { h: 10.4 }), A, { w: 17, leg: 2 });
  // ピットの出口・入口の標識と速度制限
  P.sign(mb, place(L - 50, half + 11, { yaw: -Math.PI / 2 }), A, 'pit-in', 3.2, 0.8, 1.6);
  P.sign(mb, place(M.T1 + 22, pitFront + 0.5, { yaw: -Math.PI / 2 }), A, 'pit-out', 3.2, 0.8, 1.6);
  P.sign(mb, place(L - 24, half + 12.8, { yaw: -Math.PI / 2 }), A, 'pit-limit', 1.2, 1.2, 1.6, { legs: 1 });

  // ===================== 歩道橋（メインストレートの終わり）と順位の塔 =====================
  {
    const s = 160, m = track.placeMatrix(s, 0, 0);   // 橋の +X がコースを横切る向き
    const span = track.barrierD(s, -1) + track.barrierD(s, 1) + 6;
    props.footBridge(mb, m, { span, height: 6.5, text: 'TAKUDEN FORMULA  ・  拓殖大学 電気自動車同好会' });
  }
  P.positionPylon(mb, place(M.T1 - 12, -(fenceD + 2.0)), A);

  // ===================== 観覧車（スタンドの裏・西）と駐車場 =====================
  {
    const s = 70, d = -128, p = W(s, d);
    const fw = props.ferrisWheel(props.mat4(p.x, ctx.heightFn(p.x, p.z), p.z, Math.PI / 2 - track.headingAt(s)), { radius: 30 });
    group.add(fw.group); ctx.addUpdate((dt) => fw.update(dt));
    block(s, d, 38);
  }
  {
    const spots = [];
    for (let row = 0; row < 6; row++) for (let i = 0; i < 40; i++) {
      if (rnd() < 0.2) continue;
      const s = 5 + i * 3.1, d = -(fenceD + 4.2 + gs.depth + 20 + row * 7 + (row % 2) * 0.6);
      if (Math.hypot(s - 70, d + 128) < 42) continue;
      const p = W(s, d);
      spots.push([p.x, ctx.heightFn(p.x, p.z), p.z, -track.headingAt(s) + (row % 2 ? 0 : Math.PI) + (rnd() - 0.5) * 0.1]);
    }
    group.add(P.parkedCars(spots));
    for (let s = 5; s <= 130; s += 25) block(s, -(fenceD + 4.2 + gs.depth + 37), 24);
  }

  // ===================== パドック（ピットビルの裏・東）：トランスポーター・モーターホーム・テント =====================
  for (let i = 0; i < 9; i++) {
    const s = pitS - pitLen / 2 + 10 + i * 16.5;
    const col = new THREE.Color(A.teamColors[i % 12]).getHex();
    P.transporter(mb, place(s, pitFront + 18 + 9, { yaw: Math.PI / 2 }), col);
    P.motorhome(mb, place(s + 4, pitFront + 18 + 26, { yaw: Math.PI / 2 }), col);
    props.tent(mb, place(s - 3, pitFront + 18 + 40), { w: 7, d: 6, color: col });
  }
  for (let s = pitS - pitLen / 2; s <= pitS + pitLen / 2; s += 25) block(s, pitFront + 45, 26);
  // 照明塔（パドックとスタンドの裏）
  for (const [s, d] of [[20, pitFront + 62], [170, pitFront + 62], [8, -(fenceD + 32)], [178, -(fenceD + 32)]]) P.floodlight(mb, place(s, d), { height: 26 });

  // ===================== 旗（スタンドの屋根の上・ピットビルの屋上・コントロールタワーの前） =====================
  const flagPos = [...gs.flags];
  for (let s = pitS - pitLen / 2 + 6; s < pitS + pitLen / 2; s += 15) { const p = W(s, pitFront + 1.5); p.y = ctx.groundAt(s, pitFront + 1.5) + 10.6; flagPos.push(p); }
  for (let i = 0; i < 5; i++) { const s = pitS + pitLen / 2 + 4 + i * 4, p = W(s, pitFront + 1); p.y = ctx.groundAt(s, pitFront + 1); flagPos.push(p); }
  const fl = P.flagField(flagPos, { height: 6, windYaw: -track.headingAt(90) + 0.4 });
  group.add(fl.group); ctx.addUpdate((dt) => fl.update(dt));

  // ===================== アーチ橋（S 字の頂上） =====================
  {
    const s = M.Sx + 4, m = track.placeMatrix(s, 0, 0);
    const span = Math.max(track.barrierD(s, -1), track.barrierD(s, 1)) * 2 + 6;
    P.archBridge(mb, m, A, { span, height: 10 });
  }

  // ===================== コース脇：タイヤバリアの帯・金網の広告・ランオフの色・ラバー =====================
  tireBelts(ctx, A);
  fenceBanners(ctx, A);
  runoffBands(ctx);
  rubberLine(ctx);
  runoffLogos(ctx, [{ s: M.T1 + 40, side: -1 }, { s: M.r130 + 35, side: -1 }, { s: M.dunlop + 45, side: -1 }, { s: M.final + 14, side: -1 }]);

  // ===================== コーナーの飾り：マーシャルポスト・カメラの台・矢印・観客 =====================
  const corners = findCorners(track);
  let post = 1;
  for (const k of corners) {
    const out = -k.dir, sMid = track.wrap((k.s0 + k.s1) / 2);
    if (inR(sMid, L - 45, M.T1 + 5)) continue;   // メインストレート（ピット・スタンド）
    // マーシャルポスト（内側の壁の後ろ）
    const din = -out * (track.barrierD(sMid, -out) + 3.5);
    P.marshalPost(mb, place(sMid, din), A, post++);
    block(sMid, din, 6);
    // テレビカメラの台（外側）
    if (k.s1 - k.s0 > 40) { const s = track.wrap(k.s0 + (k.s1 - k.s0) * 0.3); P.cameraTower(mb, place(s, out * (track.barrierD(s, out) + 4))); block(s, out * (track.barrierD(s, out) + 4), 4); }
    // 矢印看板（外側の壁の上。きついコーナーだけ）
    if (k.peak > 1 / 45) for (let s = k.s0 + 6; s < k.s1 - 4; s += 11) { const ss = track.wrap(s); P.sign(mb, place(ss, out * (track.barrierD(ss, out) + 1.2)), A, 'chev' + k.dir, 1.6, 1.0, 0.5); }
    // 観客（きついコーナーの外の土手）
    if (k.peak > 1 / 36) {
      for (let s = k.s0; s < k.s1; s += 17) {
        const ss = track.wrap(s), d = out * (track.barrierD(ss, out) + 9);
        P.bleacher(mb, place(ss, d), { length: 15, rows: 5, rnd, A });
        block(ss, d, 8);
      }
    }
  }
  // 距離看板（強いブレーキの手前。外側＝次のコーナーの外）
  for (const [sC, side] of [[M.chicane, -1], [M.T2, -1], [M.degner2 - 4, -1], [M.hairpin, 1]]) {
    for (const [d, lab] of [[150, '150'], [100, '100'], [50, '50']]) {
      const s = track.wrap(sC - d);
      P.sign(mb, place(s, side * (track.barrierD(s, side) + 1.0)), A, 'dist' + lab, 1.0, 1.25, 0.9);
    }
  }

  const ADS = ['ad-takuden', 'ad-univ', 'ad-ev', 'ad-zero', 'ad-sf', 'ad-36kw', 'ad-circuit', 'ad-race', 'ad-univ2', 'ad-gp', 'ad-charge', 'ad-safety'];
  // ===================== そのほかのグランドスタンド =====================
  const stand = (s, side, length, rows, color, sign) => {
    const d = side * (track.barrierD(s, side) + 8);
    const m = place(s, d);
    props.grandstand(mb, m, { length, rows, color, sign });
    // 裏の壁にも広告（ほかの区間から見える）
    const D = rows * 0.85, H = rows * 0.5, n = Math.floor(length / 10);
    for (let k = 0; k < n; k++) {
      const g = slotPlane(A.get(ADS[(k + Math.round(s)) % ADS.length]), 9, 1.12).rotateY(Math.PI).translate(-length / 2 + (length - n * 10) / 2 + (k + 0.5) * 10, H * 0.55 + 1, -D / 2 - 0.45);
      mb.add(g, A.material(), m, { shadow: false });
    }
    for (let k = -length / 2; k <= length / 2; k += 15) block(track.wrap(s + k), d + side * 6, 14);
  };
  stand(M.T1 + 30, -1, 50, 12, 0x1565c0, 'TAKUDEN CIRCUIT');          // 1 コーナーの外
  stand(M.hairpin + 26, 1, 46, 10, 0xc62828, null);                    // ヘアピンの外
  stand(M.chicane - 30, -1, 56, 12, 0x2e7d32, 'TAKUDEN FORMULA');     // シケインの手前の外
  stand(M.spoonX + 70, -1, 60, 10, 0xf9a825, null);                    // バックストレートの外

  // ===================== 広告看板（直線のガードレールの外） =====================
  let ad = 0;
  for (let s = 0; s < L; s += 24) {
    if (inR(s, L - 50, M.T1 + 40)) continue;                          // メインストレート
    if (Math.abs(track.kappaAt(s)) > 1 / 150) continue;                // カーブの外は砂利・ランオフ
    for (const side of [-1, 1]) {
      const e = track.edgeAt(s, side);
      if (e.barrier !== 'armco') continue;
      if ((Math.floor(s / 24) + (side > 0 ? 1 : 0)) % 2) continue;
      const d = side * (track.barrierD(s, side) + 1.6);
      P.sign(mb, place(s, d), A, ADS[ad++ % ADS.length], 9, 1.15, 0.5);
    }
  }

  // ===================== 池（コースの内側の一番広い所）=====================
  {
    let best = null;
    for (let x = b0.x0 + 40; x < b0.x1 - 40; x += 12) for (let z = b0.z0 + 40; z < b0.z1 - 40; z += 12) {
      const nr = track.nearest(x, z, 200), cl = nr ? nr.dist : 200;
      if (blocked.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 30)) continue;
      if (!best || cl > best.cl) best = { x, z, cl };
    }
    if (best && best.cl > 60) {
      const r = Math.min(38, best.cl - 32);
      let y = -Infinity; for (let a = 0; a < 16; a++) for (const f of [0, 0.5, 1, 1.3]) y = Math.max(y, ctx.heightFn(best.x + Math.cos(a / 16 * 6.283) * r * f, best.z + Math.sin(a / 16 * 6.283) * r * f));
      P.pond(mb, group, best, r, y + 0.08);
      blocked.push({ x: best.x, z: best.z, r: r * 1.45 });
    }
  }

  // ===================== 空：飛行船と中継のヘリ =====================
  {
    const c = { x: (b0.x0 + b0.x1) / 2, z: (b0.z0 + b0.z1) / 2 };
    const bl = P.blimp(A, c, { R: 330, H: 150 }); group.add(bl.group); ctx.addUpdate((dt) => bl.update(dt));
    const he = P.helicopter(c, { R: 230, H: 85 }); group.add(he.group); ctx.addUpdate((dt) => he.update(dt));
  }

  // ===================== 林 =====================
  const b = track.bounds, margin = 330;
  // 林は「かたまり」で生える（ノイズで濃い所と草原を分ける）。均一に散らすより自然に見える
  const N = Math.round(6500 * deco);
  const dens = (x, z) => { const n = ctx.heightFn.noise ? ctx.heightFn.noise(x / 140 + 31.7, z / 140 - 12.3, 2) : 0.6; return Math.min(1, Math.max(0, (n - 0.45) / 0.1)); };
  for (let i = 0; i < N; i++) {
    const x = b.x0 - margin + rnd() * (b.x1 - b.x0 + 2 * margin), z = b.z0 - margin + rnd() * (b.z1 - b.z0 + 2 * margin);
    if (rnd() > dens(x, z) * 0.95 + 0.02) continue;
    const near = track.nearest(x, z, 140);
    if (near) {
      const side = near.d >= 0 ? 1 : -1, clear = track.barrierD(near.s, side) + 12;
      if (near.dist < clear) continue;
    }
    if (blocked.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r)) continue;
    const y = ctx.heightFn(x, z);
    const r = rnd(), kind = r < 0.6 ? 'conifer' : r < 0.9 ? 'broadleaf' : 'bush';   // 広葉樹は三角形が多いので針葉樹を多めに
    forest.add(kind, x, y, z, 0.8 + rnd() * 0.7, rnd() * 6.28, (rnd() - 0.5) * 0.2);
  }

  return {
    setStartLights: (n, color) => sa.setStartLights(n, color),
  };
}

const inR = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

// カーブの区間を探す（なめらかにした曲率がしきい値を越える所）
export function findCorners(track, thr = 1 / 140) {
  const out = []; let cur = null;
  for (let i = 0; i < track.n; i++) {
    const k = track.kappaS[i], on = Math.abs(k) > thr, s = i * track.ds;
    if (on && (!cur || Math.sign(k) !== cur.dir)) { cur = { s0: s, s1: s, dir: Math.sign(k), peak: 0 }; out.push(cur); }
    if (on) { cur.s1 = s; cur.peak = Math.max(cur.peak, Math.abs(k)); } else cur = null;
  }
  // 周回の継ぎ目をまたぐカーブは 1 つにまとめる
  if (track.closed && out.length > 1) {
    const a = out[0], z = out[out.length - 1];
    if (a.s0 === 0 && z.s1 >= track.length - track.ds * 1.5 && a.dir === z.dir) { z.s1 = a.s1 + track.length; z.peak = Math.max(a.peak, z.peak); out.shift(); }
  }
  return out.filter((c) => c.s1 - c.s0 > 8);
}
