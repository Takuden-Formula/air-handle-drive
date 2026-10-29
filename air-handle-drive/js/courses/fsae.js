// 学生フォーミュラ大会（仮実装：中心線・道幅・最低限の景観。後で作り込む）
// 広い舗装の上にパイロンで作ったオートクロスのコース。パドックのテント。コーンに当たると +1 秒。
import { PathBuilder, profile } from '../engine/track.js';
import { coneZones, boundaryCones, startArea, finishArea, LENGTH_FACTOR } from './common.js';
import { mulberry32 } from '../engine/textures.js';

export default {
  id: 'fsae',
  name: '学生フォーミュラ大会',
  nameEn: 'STUDENT FORMULA AUTOCROSS',
  desc: 'パイロンで作った本番さながらの\nオートクロス。コーンに注意！',
  accent: '#1e88e5',
  difficulty: 3,
  thumb: { s: -25, d: -16, h: 11, look: 45 },
  latG: 2.0,
  env: {
    sunElevation: 58, sunAzimuth: 200, turbidity: 3.5, rayleigh: 1.3, skyIntensity: 0.55,
    clouds: { cover: 0.62, sharp: 0.3, scale: 0.6, speed: 0.005, opacity: 0.8 },
    sunIntensity: 3.8, ambient: 0.4, fogDensity: 0.0008,
    mountains: { count: 3, height: 300, dist: 2200, color: [0.3, 0.42, 0.42], seed: 31 },
  },
  grade: { exposure: 1.0, saturation: 1.05, contrast: 1.04 },

  build(opts) {
    const p = new PathBuilder({ x: 0, z: 0, heading: 90 });
    p.mark('start').straight(70)
      .turn(18, 90).straight(40)
      .mark('slalom').straight(90)
      .turn(10, -170).straight(50)
      .turn(25, 80).straight(35)
      .turn(14, -100).straight(60)
      .turn(9, 175).mark('hairpin').straight(70)
      .turn(30, -60).turn(30, 60).straight(40)
      .turn(16, -90).straight(110).mark('end');
    const path = p.build({ ds: 1 });
    const half = 3.5;
    const edges = () => ({ kerb: 0, runoff: 'asphalt', runoffW: 26, barrier: 'none', barrierD: half + 22, verge: 4 });
    const startS = 20;
    const raceLength = Math.min(p.length - 60, 780 * (LENGTH_FACTOR[opts.length] || 1));
    const rnd = mulberry32(opts.seed || 7);
    // パイロン：両脇（いつも）＋スラローム（「コーン」設定が ON のとき）
    const track = { halfWidth: () => half };
    let cones = boundaryCones(track, startS + 8, startS + raceLength, { every: 6 });
    if (opts.cones) cones = cones.concat(coneZones(track, [{ s0: p.marks.slalom, s1: p.marks.slalom + 90, kind: 'slalom', step: 15 }], rnd, { slalomK: 0.45 }));
    return {
      path, width: half * 2, elevation: profile([[0, 0]]), edges, ground: 'asphalt', startS, raceLength, cones,
      terrain: { amp: 0, flat: 40, ramp: 300, material: 'asphalt' },
      trackStyle: { vergeMat: 'asphalt', markings: [] },
    };
  },

  decorate(ctx) {
    const { track, mb, props, rnd, forest, deco } = ctx;
    const sa = startArea(ctx, ctx.startS + 3, { label: 'STUDENT FORMULA', grid: 0 });
    finishArea(ctx, ctx.startS + ctx.raceLength, { label: 'FINISH' });
    // パドックのテント（コースの外側に一列）
    const b = track.bounds;
    const cols = [0x1565c0, 0xc62828, 0x2e7d32, 0xf9a825, 0x6a1b9a, 0x00838f, 0xef6c00];
    for (let i = 0; i < 18; i++) {
      const x = b.x0 + i * 9, z = b.z0 - 45;
      props.tent(mb, props.mat4(x, 0, z, 0), { w: 6, d: 6, color: cols[i % cols.length] });
    }
    // 林（舗装の外）
    const N = Math.round(900 * deco), margin = 300;
    for (let i = 0; i < N; i++) {
      const x = b.x0 - margin + rnd() * (b.x1 - b.x0 + 2 * margin), z = b.z0 - margin + rnd() * (b.z1 - b.z0 + 2 * margin);
      const near = track.nearest(x, z, 140);
      if (near && near.dist < 90) continue;
      forest.add(rnd() < 0.5 ? 'broadleaf' : 'conifer', x, ctx.heightFn(x, z), z, 0.9 + rnd() * 0.5);
    }
    return { setStartLights: (n, c) => sa.setStartLights(n, c) };
  },
};
