// 街中（仮実装：中心線・道幅・最低限の景観。後で作り込む）
// 夕暮れのビル街。交差点の 90° のカーブ、歩道、街灯、ビルの窓の明かり。
import { PathBuilder, profile } from '../engine/track.js';
import { coneZones, startArea, finishArea, forRange, LENGTH_FACTOR } from './common.js';
import { mulberry32 } from '../engine/textures.js';

export default {
  id: 'city',
  name: '街中',
  nameEn: 'TAKUDEN CITY STREET',
  desc: '夕暮れのビル街。\n交差点の直角コーナー',
  accent: '#ff9800',
  difficulty: 3,
  thumb: { s: -10, d: 0, h: 12, look: 150 },
  latG: 2.1,
  env: {
    sunElevation: 6, sunAzimuth: 255, turbidity: 4.5, rayleigh: 2.2, mie: 0.008, mieG: 0.86, skyIntensity: 0.6,
    clouds: { cover: 0.5, sharp: 0.25, scale: 0.8, speed: 0.004, opacity: 0.8, color: [1, 0.85, 0.75] },
    sunIntensity: 2.8, ambient: 0.6, envIntensity: 1.4, fogDensity: 0.0012, night: 0.4,
    mountains: { count: 0 },
  },
  grade: { exposure: 1.18, saturation: 1.12, contrast: 1.08, tint: [1.04, 0.98, 0.94], bloom: { strength: 0.5, threshold: 1.0 } },

  build(opts) {
    const p = new PathBuilder({ x: 0, z: 0, heading: 0 });
    const R = 14;
    // 右・左の直角カーブを交互に（階段状に進むので道が重ならない）
    p.mark('a').straight(220)
      .turn(R, 90, { entry: 6 }).straight(160)
      .turn(R, -90, { entry: 6 }).straight(200)
      .turn(R, 90, { entry: 6 }).straight(140)
      .turn(R, -90, { entry: 6 }).straight(180)
      .turn(R, 90, { entry: 6 }).straight(160)
      .turn(R, -90, { entry: 6 }).straight(200)
      .turn(R, 90, { entry: 6 }).straight(180)
      .turn(R, -90, { entry: 6 }).straight(260).mark('end');
    const path = p.build({ ds: 1 });
    const half = 4.5;
    const elevation = profile([[0, 0], [500, 1.5], [1000, 0], [1400, 2]]);
    const edges = (s, side) => ({ kerb: 0, runoff: 'concrete', runoffW: 3.6, barrier: 'none', barrierD: half + 3.4, verge: 2 });
    const startS = 40;
    const raceLength = 1100 * (LENGTH_FACTOR[opts.length] || 1);
    const rnd = mulberry32(opts.seed || 7);
    const tmp = { halfWidth: () => half };
    const cones = opts.cones ? coneZones(tmp, [{ s0: 90, s1: 200, kind: 'slalom', step: 16 }, { s0: 500, s1: 620, kind: 'lane' }, { s0: 1040, s1: 1120, kind: 'slalom', step: 16 }].filter((z) => z.s1 < startS + raceLength - 30), rnd) : [];
    return {
      path, width: half * 2, elevation, edges, ground: 'concrete', startS, raceLength, cones,
      terrain: { amp: 0, flat: 10, ramp: 50, material: 'concrete' },
      trackStyle: {
        vergeMat: 'concrete',
        markings: [{ edge: -1, inset: 0.2, w: 0.15 }, { edge: 1, inset: 0.2, w: 0.15 }, { d: 0, w: 0.15, color: 'yellow' }],
      },
    };
  },

  decorate(ctx) {
    const { track, mb, props, rnd, deco } = ctx;
    const L = track.length;
    const sa = startArea(ctx, ctx.startS + 3, { label: 'TAKUDEN CITY GP', grid: 0 });
    finishArea(ctx, ctx.startS + ctx.raceLength, { label: 'FINISH' });
    // ビル（両側に並べる。カーブの内側は曲率で間引く）
    for (const side of [-1, 1]) {
      let s = 5;
      while (s < L - 5) {
        const w = 14 + rnd() * 18, d = 14 + rnd() * 10, h = 12 + rnd() * rnd() * 60;
        const sc = s + w / 2;
        if (Math.abs(track.kappaAt(sc)) < 1 / 40) {
          const off = side * (track.barrierD(sc, side) + 0.6 + d / 2);
          props.building(mb, ctx.place(sc, off, { back: false }), { w, d, h, style: Math.floor(rnd() * 4) });
        }
        s += w + 2 + rnd() * 4;
      }
    }
    // 街灯
    forRange(track, 10, L, 30, (s) => { const side = Math.floor(s / 30) % 2 ? 1 : -1; props.lightTower(mb, ctx.place(s, side * (track.barrierD(s, side) - 0.4)), { height: 8 }); });
    void deco;
    // 夕方なのでビルの窓を光らせる
    for (const m of props.buildingMaterials()) m.emissiveIntensity = 1.1;
    return { setStartLights: (n, c) => sa.setStartLights(n, c) };
  },
};
