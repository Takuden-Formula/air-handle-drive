// 高速道路（仮実装：中心線・道幅・最低限の景観。後で作り込む）
// 片側 3 車線の高速道路。ゆるいカーブと起伏、防音壁、照明、緑の案内標識。スタートは料金所の先、ゴールは出口。
import { PathBuilder, profile } from '../engine/track.js';
import { coneZones, startArea, finishArea, forRange, LENGTH_FACTOR } from './common.js';
import { mulberry32 } from '../engine/textures.js';

export default {
  id: 'highway',
  name: '高速道路',
  nameEn: 'TAKUDEN EXPRESSWAY',
  desc: '3車線の高速道路を全開で。\n最高速のスリル',
  accent: '#2e7d32',
  difficulty: 1,
  latG: 2.0,
  env: {
    sunElevation: 52, sunAzimuth: 160, turbidity: 2.6, rayleigh: 1.2, skyIntensity: 0.55,
    clouds: { cover: 0.55, sharp: 0.25, scale: 0.7, speed: 0.008, opacity: 0.85 },
    sunIntensity: 3.6, ambient: 0.38, fogDensity: 0.0007,
    mountains: { count: 3, height: 340, dist: 2600, color: [0.3, 0.4, 0.46], seed: 21 },
  },
  grade: { exposure: 1.02, saturation: 1.08, contrast: 1.05 },

  build(opts) {
    const p = new PathBuilder({ x: 0, z: 0, heading: 0 });
    p.mark('plaza').straight(160)
      .turn(380, 18).straight(180)
      .mark('c2').turn(300, -32).straight(220)
      .mark('c3').turn(260, 40).straight(200)
      .mark('c4').turn(420, -22).straight(260)
      .mark('c5').turn(320, 28).straight(300).mark('end');
    const path = p.build({ ds: 1 });
    const M = p.marks, L = p.length;
    const half = 5.25;   // 3 車線（3.5 m × 3）
    const elevation = profile([[0, 0], [300, 2], [600, 9], [900, 12], [1200, 6], [1500, 3], [L, 4]]);
    const edges = (s, side) => side < 0
      ? { kerb: 0, runoff: 'asphalt', runoffW: 2.5, barrier: 'wall', barrierD: half + 2.8, verge: 18 }
      : { kerb: 0, runoff: 'asphalt', runoffW: 1.0, barrier: 'wall', barrierD: half + 1.3, verge: 18 };
    const startS = 40;
    const raceLength = 1150 * (LENGTH_FACTOR[opts.length] || 1);
    const rnd = mulberry32(opts.seed || 7);
    const tmp = { halfWidth: () => half };
    // 工事区間のコーン
    const cones = opts.cones ? coneZones(tmp, [{ s0: 260, s1: 360, kind: 'lane' }, { s0: 560, s1: 660, kind: 'lane' }, { s0: 900, s1: 1000, kind: 'slalom' }, { s0: 1250, s1: 1350, kind: 'lane' }].filter((z) => z.s1 < startS + raceLength - 30), rnd, { laneK: 0.667 }) : [];
    return {
      path, width: half * 2, elevation, edges, ground: 'grass', startS, raceLength, cones, marks: M,
      terrain: { amp: 30, scale: 380, flat: 30, ramp: 260, seed: 9 },
      trackStyle: {
        markings: [
          { edge: -1, inset: 0.1, w: 0.2 }, { edge: 1, inset: 0.1, w: 0.2 },
          { d: -half / 3, w: 0.15, dash: [8, 12] }, { d: half / 3, w: 0.15, dash: [8, 12] },
        ],
      },
    };
  },

  decorate(ctx) {
    const { track, mb, forest, props, rnd, deco, layout } = ctx;
    const L = track.length;
    const sLine = ctx.startS + 3, sFin = ctx.startS + ctx.raceLength;
    const sa = startArea(ctx, sLine, { label: 'TAKUDEN EXPRESSWAY', grid: 0 });
    finishArea(ctx, sFin, { label: 'EXIT' });
    // 照明（左の壁の上、40 m ごと）
    forRange(track, 0, L, 40, (s) => props.lightTower(mb, ctx.place(s, -(track.barrierD(s, -1) + 0.6)), { height: 11 }));
    // 緑の案内標識（門型）
    for (const s of [220, 620, 1020, 1420]) {
      if (s > L - 50) continue;
      const m = track.placeMatrix(s, 0, 0, { yaw: Math.PI / 2 });
      const span = track.barrierD(s, -1) + track.barrierD(s, 1) + 2;
      props.footBridge(mb, m, { span, height: 6.5, text: s < 1000 ? '拓殖 TAKUSHOKU  3 km' : '出口 EXIT  1 km' });
    }
    // 林
    const b = track.bounds, margin = 360, N = Math.round(1800 * deco);
    for (let i = 0; i < N; i++) {
      const x = b.x0 - margin + rnd() * (b.x1 - b.x0 + 2 * margin), z = b.z0 - margin + rnd() * (b.z1 - b.z0 + 2 * margin);
      const near = track.nearest(x, z, 60);
      if (near && near.dist < track.barrierD(near.s, near.d >= 0 ? 1 : -1) + 12) continue;
      forest.add(rnd() < 0.5 ? 'conifer' : 'broadleaf', x, ctx.heightFn(x, z), z, 0.8 + rnd() * 0.7, rnd() * 6.28);
    }
    void layout;
    return { setStartLights: (n, c) => sa.setStartLights(n, c) };
  },
};
