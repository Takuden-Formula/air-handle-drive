// サーキット（参照実装）：1 周約 1.2 km のクローズドコース。メインストレート・ヘアピン・S 字・高速の最終コーナー。
// グランドスタンド・ピット・スタートのシグナル（レースのランプと連動）・縁石・グラベル・タイヤバリア・キャッチフェンス・
// 広告看板・歩道橋・観覧車・照明塔・マーシャルポスト・距離看板・林。
// 他のコースを作るときはこのファイルの形（build と decorate）をまねる。
import { PathBuilder, profile, defaultEdges } from '../engine/track.js';
import { coneZones, startArea, finishArea, forRange } from './common.js';

// 中心線（時計回り）。数値は直線の長さ [m]、turn(半径 [m], 角度 [度]（+ = 右）)
function makePath() {
  const p = new PathBuilder({ x: 0, z: 0, heading: 0 });
  p.mark('main').straight(200, { id: 'main' })
    .mark('T1').turn(32, 90).mark('T1x')
    .straight(95).mark('top')
    .mark('T2').turn(60, -45).mark('T3').turn(40, 90).mark('T3x')
    .straight(70)
    .mark('hairpin').turn(20, 135).mark('hairpinX')
    .mark('back').straight(100, { id: 'back' })
    .mark('T6').turn(50, -90).mark('T6x')
    .straight(115).mark('long')
    .mark('T7').turn(35, 90).mark('T7x')
    .straight(45)
    .mark('final').turn(45, 90).mark('end');
  return p;
}

export default {
  id: 'circuit',
  name: 'サーキット',
  nameEn: 'TAKUDEN CIRCUIT',
  desc: '本格サーキットを1周。\nヘアピンとS字、長いストレート',
  accent: '#e53935',
  difficulty: 2,
  latG: 2.0,          // コーナーでこの横 G まで自動で減速する
  // 午後の晴れ（太陽は南西）
  env: {
    sunElevation: 34, sunAzimuth: 225, turbidity: 3.0, rayleigh: 1.3, skyIntensity: 0.55,
    clouds: { cover: 0.5, sharp: 0.2, scale: 0.8, speed: 0.006, opacity: 0.9 },
    sunIntensity: 3.4, ambient: 0.35, envIntensity: 0.9, fogDensity: 0.0009,
    mountains: { count: 3, height: 260, dist: 2400, color: [0.33, 0.43, 0.5], seed: 11 },
  },
  grade: { exposure: 1.0, saturation: 1.1, contrast: 1.06, vignette: 0.3 },

  // 走るための形（three.js を使わないデータ）。opts: { length, cones }
  build(opts) {
    const p = makePath();
    const path = p.build({ ds: 1, close: true, solve: ['main', 'back'] });
    const M = p.marks, L = p.length;
    const half = 6;   // 道幅 12 m
    // 高低差：メインストレートは平ら、ヘアピンに向かって上り、裏のストレートで下る
    const elevation = profile([[0, 0], [M.T1, 0], [M.top, 3], [M.T3x, 6], [M.hairpin, 8], [M.back + 60, 7], [M.T6x, 4], [M.long, 1], [M.final, 0], [L, 0]], { period: L });
    // 道の脇
    const edges = (s, side, info) => {
      // メインストレート：左（西）はグランドスタンドの金網、右はピットウォール
      if (s < M.T1 - 25 || s > L - 10) {
        return side < 0
          ? { kerb: 0, runoff: 'asphalt', runoffW: 2.5, barrier: 'fence', barrierD: half + 3, verge: 16 }
          : { kerb: 0, runoff: 'asphalt', runoffW: 1.5, barrier: 'wall', barrierD: half + 2.2, verge: 2 };
      }
      return defaultEdges(s, side, info);
    };
    // 長さの設定：ふつう = 1 周、みじかい = 半周（裏のストレートでゴール）、ながい = 2 周
    const sLine = 60;                         // スタート / ゴールライン
    const startS = sLine - 3;                 // 車の中心のスタート位置（ラインの 3 m 手前）
    let raceLength, laps = 1;
    if (opts.length === 'short') raceLength = (M.back + 40) - startS;
    else if (opts.length === 'long') { laps = 2; raceLength = 2 * L + 3; }
    else raceLength = L + 3;
    // コーン（練習用のパイロン）：上のストレートと裏のストレート、最後の長いストレート
    const rnd = mulberry(opts.seed || 7);
    const tmp = { halfWidth: () => half };
    const zones = [{ s0: M.T1x + 10, s1: M.top - 10, kind: 'lane' }, { s0: M.back + 10, s1: M.back + 100, kind: 'slalom' }, { s0: M.T6x + 20, s1: M.long - 30, kind: 'lane' }];
    const cones = opts.cones ? coneZones(tmp, zones, rnd) : [];   // 2 周するときも同じコーン（はね飛ばした物はそのまま）
    return {
      path, width: half * 2, elevation, edges, ground: 'grass',
      startS, raceLength, laps, cones, sLine, marks: M,
      terrain: { amp: 22, scale: 320, flat: 40, ramp: 220, seed: 4 },
      trackStyle: { markings: [{ edge: -1, inset: 0.25, w: 0.2 }, { edge: 1, inset: 0.25, w: 0.2 }] },
    };
  },

  // 景色（three.js）。ctx は engine/stage.js を参照
  decorate(ctx) {
    const { track, mb, forest, props, group, rnd, layout, deco } = ctx;
    const M = layout.marks, L = track.length, half = 6;
    const place = ctx.place;
    const sLine = layout.sLine;
    // ---- スタート / ゴール ----
    const sa = startArea(ctx, sLine, { label: 'TAKUDEN GRAND PRIX', finishHere: ctx.laps >= 1 && ctx.opts.length !== 'short', grid: 4 });
    if (ctx.opts.length === 'short') finishArea(ctx, track.wrap(ctx.startS + ctx.raceLength), { label: 'FINISH' });
    // ---- グランドスタンド（メインストレートの左）とピット（右） ----
    for (const s of [40, 110, 180]) props.grandstand(mb, place(s, -(half + 3 + 9)), { length: 64, rows: 14, color: 0xc62828, sign: s === 110 ? 'TAKUDEN CIRCUIT' : null });
    // ピットレーン（ピットウォールの外の舗装）とピットの建物
    group.add(props.roadDecal(track, 15, 200, half + 2.6, half + 14, ctx.MAT.asphalt(), { lift: 0.02, steps: 50 }));
    group.add(props.roadDecal(track, 15, 200, half + 10.2, half + 10.4, ctx.MAT.line(), { lift: 0.035, steps: 50 }));
    props.pitBuilding(mb, place(115, half + 14 + 0.3), { length: 180, depth: 16, height: 8, garages: 14 });
    // 計時塔
    props.billboard(mb, place(70, half + 12), { w: 3, h: 9, text: 'P1', bg: '#11161d', bg2: '#1c2733', legs: 0, sub: 'TIMING' });
    // ---- 歩道橋（メインストレートの終わり） ----
    {
      const s = 215, m = track.placeMatrix(s, 0, 0, { yaw: Math.PI / 2 });
      const span = track.barrierD(s, -1) + track.barrierD(s, 1) + 6;
      props.footBridge(mb, m, { span, height: 6.5, text: 'TAKUDEN FORMULA  ・  拓殖大学 電気自動車同好会' });
    }
    // ---- 観覧車（グランドスタンドの裏） ----
    {
      const p = track.toWorld(120, -95, 0);
      const fw = props.ferrisWheel(props.mat4(p.x, ctx.heightFn(p.x, p.z), p.z, Math.PI / 2 - track.headingAt(120)), { radius: 28 });
      group.add(fw.group); ctx.addUpdate((dt) => fw.update(dt));
    }
    // ---- コーナーの飾り：縁石の外の矢印看板・距離看板・マーシャルポスト・観客 ----
    const corners = findCorners(track);
    for (const k of corners) {
      const out = -k.dir;   // 右カーブ（dir=1）の外側は左
      const sMid = (k.s0 + k.s1) / 2;
      // マーシャルポスト（内側）
      const din = -out * (track.barrierD(sMid, -out) + 4);
      props.marshalPost(mb, place(sMid, din));
      // 矢印看板（外側の壁の上）
      for (let s = k.s0 + 4; s < k.s1 - 2; s += 9) props.chevron(mb, place(s, out * (track.barrierD(s, out) + 0.9)), k.dir);
      // 距離看板（きついカーブの手前、外側）
      if (k.peak > 1 / 40) for (const [d, lab] of [[150, '150'], [100, '100'], [50, '50']]) {
        const s = k.s0 - d; if (s < 30 && !track.closed) continue;
        props.distanceBoard(mb, place(track.wrap(s), out * (track.barrierD(track.wrap(s), out) + 1.2)), lab);
      }
      // 観客（きついカーブの外側の土手）
      if (k.peak > 1 / 36) for (let s = k.s0; s < k.s1; s += 18) props.spectators(mb, place(s, out * (track.barrierD(s, out) + 7)), { length: 16, rows: 2 });
    }
    // ---- 広告看板（直線の壁の外） ----
    const ADS = [
      { text: 'TAKUDEN FORMULA', bg: '#0f4fb4', fg: '#ffffff' }, { text: '⚡ EV POWER', bg: '#ffc928', fg: '#1a1a1a' },
      { text: '拓殖大学', bg: '#ffffff', fg: '#0f2f6b', sub: '電気自動車同好会' }, { text: 'ZERO EMISSION', bg: '#1b5e20', fg: '#ffffff' },
      { text: 'STUDENT FORMULA', bg: '#c62828', fg: '#ffffff' }, { text: 'DENSO 36kW', bg: '#11161d', fg: '#ffc928' },
    ];
    let ad = 0;
    forRange(track, 0, L, 26, (s) => {
      if (s < M.T1 + 40 && s > 0) return;                     // メインストレートはスタンドとピット
      if (Math.abs(track.kappaAt(s)) > 1 / 150) return;       // カーブの外はグラベル
      const side = (Math.floor(s / 26) % 2) ? -1 : 1;
      const d = side * (track.barrierD(s, side) + 1.4);
      props.billboard(mb, place(s, d), { w: 9, h: 1.6, legs: 0.6, ...ADS[ad++ % ADS.length] });
    });
    // ---- 照明塔 ----
    forRange(track, 20, L, 120, (s) => { const side = Math.floor(s / 120) % 2 ? 1 : -1; props.lightTower(mb, place(s, side * (track.barrierD(s, side) + 8)), { height: 20 }); });
    // ---- 林（コースから離れた所。道の近くと建物の所はよける） ----
    const b = track.bounds, margin = 380;
    const N = Math.round(2600 * deco);
    for (let i = 0; i < N; i++) {
      const x = b.x0 - margin + rnd() * (b.x1 - b.x0 + 2 * margin), z = b.z0 - margin + rnd() * (b.z1 - b.z0 + 2 * margin);
      const near = track.nearest(x, z, 120);
      if (near) {
        const side = near.d >= 0 ? 1 : -1, clear = track.barrierD(near.s, side) + 14;
        if (near.dist < clear) continue;
        if (near.s < M.T1 && near.d < 0 && near.dist < 130) continue;    // グランドスタンドと観覧車の所
        if (near.s < M.T1 && near.d > 0 && near.dist < 45) continue;      // ピット
      }
      const y = ctx.heightFn(x, z);
      const r = rnd(), kind = r < 0.45 ? 'conifer' : r < 0.9 ? 'broadleaf' : 'bush';
      forest.add(kind, x, y, z, 0.8 + rnd() * 0.6, rnd() * 6.28, (rnd() - 0.5) * 0.2);
    }
    return {
      setStartLights: (n, color) => sa.setStartLights(n, color),
    };
  },
};

// カーブの区間を探す（なめらかにした曲率がしきい値を越える所）
export function findCorners(track, thr = 1 / 140) {
  const out = []; let cur = null;
  for (let i = 0; i < track.n; i++) {
    const k = track.kappaS[i], on = Math.abs(k) > thr, s = i * track.ds;
    if (on && (!cur || Math.sign(k) !== cur.dir)) { cur = { s0: s, s1: s, dir: Math.sign(k), peak: 0 }; out.push(cur); }
    if (on) { cur.s1 = s; cur.peak = Math.max(cur.peak, Math.abs(k)); } else cur = null;
  }
  return out.filter((c) => c.s1 - c.s0 > 8);
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
