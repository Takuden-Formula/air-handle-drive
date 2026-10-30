// 疑似3Dレースゲームのエンジン（道路の生成・車の物理・描画）
// 道路は一定長のセグメントの連なりで、各セグメントにカーブ量と高さを持たせて画面に投影する。
// 景色（木・看板・スタンドなど）は起動時に一度だけ画像として描いておき、毎フレームは拡大縮小して貼るだけにする（軽くするため）。

const SEG = 200;            // セグメント1つの長さ
const RUMBLE = 3;           // 縁石の紅白・破線が何セグメントで切り替わるか
const ROAD_W = 1500;        // 道路の半幅
const LANES = 3;
const FOV = 100;
const CAM_H = 1000;         // カメラの高さ
const DRAW = 220;           // 何セグメント先まで描くか
const FOG = 4;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z = CAM_H * CAM_DEPTH;  // カメラから自車までの距離

export const MAX_SPEED = SEG * 60;    // 1秒に60セグメント（速度のものさし。実際の最高速は下の CAR で決まる）
const OFFROAD_DECEL = -MAX_SPEED / 1.5;
const OFFROAD_LIMIT = MAX_SPEED / 4;
const CENTRIFUGAL = 0.12;   // カーブで外側に流される強さ
export const CAR_HALF = 0.15; // 自車の半幅（道路の半幅=1 とした単位）

// ---------- 車の性能（同好会の車：デンソー製モータ 36 kW） ----------
// 画面の縮尺：車幅 2*CAR_HALF*ROAD_W = 450 を 1.4 m とする（道路の幅は約 9.4 m になる）
export const UNITS_PER_M = 2 * CAR_HALF * ROAD_W / 1.4;
export const KMH_AT_MAX = MAX_SPEED / UNITS_PER_M * 3.6;   // MAX_SPEED が何 km/h か（約 135）
export const CAR = {
  power: 36000,      // モータの最大出力 [W]
  torque: 60,        // モータの最大トルク [N·m]
  maxRpm: 11000,     // モータの最高回転数 [rpm]
  gear: 10,          // 減速比（モータ 10 回転でタイヤ 1 回転）
  tireD: 0.53,       // タイヤ外径 [m]（14 インチホイール。仮定）
  mass: 300,         // 運転手込みの車重 [kg]（仮定）
  eff: 0.92,         // モータからタイヤまでの効率（仮定）
  cda: 1.2,          // 空気抵抗係数×前面投影面積 [m²]（ウイング込み。仮定）
  crr: 0.015,        // 転がり抵抗係数（仮定）
  regen: 4,          // アクセルを離したときの回生ブレーキの減速度 [m/s²]（仮定）
};
// モータ回転数 [rpm] ⇔ 車速 [m/s]
export const rpmToMs = (rpm) => rpm / CAR.gear / 60 * Math.PI * CAR.tireD;
export const msToRpm = (v) => v / (Math.PI * CAR.tireD) * 60 * CAR.gear;
export const TOP_KMH = rpmToMs(CAR.maxRpm) * 3.6;   // 最高速（約 110 km/h）
// 車速 v [m/s] でアクセル全開のときの加速度 [m/s²] と、そのときのモータトルク [N·m]
// 低速はトルク一定（60 N·m）、約 5700 rpm から上は出力一定（36 kW）でトルクが下がる
export function motorAccel(v, throttle = 1) {
  const w = msToRpm(v) * 2 * Math.PI / 60;                       // モータの角速度 [rad/s]
  const tq = Math.min(CAR.torque, CAR.power / Math.max(w, 1)) * throttle;
  const drive = tq * CAR.gear * CAR.eff / (CAR.tireD / 2);
  const resist = 0.5 * 1.2 * CAR.cda * v * v + CAR.crr * CAR.mass * 9.81;
  return { a: (drive - resist) / CAR.mass, torque: tq };
}

const BARRIER = 2.55;       // ガードレール・タイヤバリアの位置（道路の半幅=1）。自車はこの手前で止まる
const BARRIER_H = 260;      // ガードレールの高さ（ワールド単位。車幅 ≒ 450）
const KERB_CURVE = 1.2;     // これよりきついカーブに縁石と砂利（グラベル）を置く
const TREE_SCALE = { pine: 0.8, round: 1, poplar: 0.6, bush: 1 };  // 木の画像ごとの大きさの補正

// コースの種類（最初に選ぶ）
export const COURSES = {
  city: { name: '市街地', desc: 'ビルの間の直角コーナーとシケイン', icon: '🏙️' },
  circuit: { name: 'サーキット', desc: '縁石と砂利のある本格コース', icon: '🏁' },
  highway: { name: '高速', desc: '長い直線と大きなカーブ。前の車を追い越す', icon: '🛣️' },
};
// コースごとの見た目（地面・壁・背景）
const THEMES = {
  circuit: { ground1: [86, 156, 72], ground2: [76, 144, 64], road: [92, 94, 98], wall: 'armco', bg: 'mountains', off: 'grass' },
  city: { ground1: [170, 168, 160], ground2: [158, 156, 148], road: [84, 86, 90], wall: 'concrete', bg: 'city', off: 'pavement' },
  highway: { ground1: [92, 150, 74], ground2: [84, 140, 68], road: [88, 90, 94], wall: 'sound', bg: 'mountains', off: 'grass' },
};

const C = {
  sky1: [30, 96, 190], sky2: [146, 194, 232], fog: [205, 222, 232],
  road: [92, 94, 98], roadLine: [238, 238, 232], kerbR: [214, 40, 40], kerbW: [242, 242, 242],
  grass1: [86, 156, 72], grass2: [76, 144, 64], gravel1: [214, 196, 158], gravel2: [204, 186, 148],
  armco: [182, 188, 196], armcoDark: [104, 110, 120], tire: [34, 34, 36],
};
const FOG_CSS = rgb(C.fog);

const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const lerp = (a, b, p) => a + (b - a) * p;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }

// 色を霧の色に近づける（f=1 が近く、0 が霧）。毎フレーム同じ色を何千回も作るので文字列をキャッシュする
const fogCache = new Map();
function fogc(c, f, k = 1) {
  const q = Math.round(f * 24), kk = Math.round(k * 50);
  const key = (c[0] << 16 | c[1] << 8 | c[2]) * 4096 + q * 64 + kk;
  let s = fogCache.get(key);
  if (!s) {
    const t = q / 24, m = kk / 50;
    s = rgb([lerp(C.fog[0], c[0] * m, t), lerp(C.fog[1], c[1] * m, t), lerp(C.fog[2], c[2] * m, t)]);
    fogCache.set(key, s);
  }
  return s;
}

// 整数から 0〜1 の疑似乱数（コースの見た目のむら用。毎回同じ値になる）
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Race {
  constructor() {
    this.segments = []; this.skyOffset = 0; this.cx = 0.5;  // cx: 画面上の道路・車の中心（横位置の割合）
    this.showMap = true; this.particles = []; this.mapPts = []; this.traffic = []; this.theme = THEMES.circuit; this.type = 'circuit';
    this.quality = 1;   // 0 = 軽量（雲・遠くの林を省く。遅い PC 用）
    this.reset();
  }

  // ---------- コース生成 ----------
  build({ type = 'circuit', length = 'normal', cones = true, seed = 7 } = {}) {
    this.segments = []; this.traffic = [];
    this.type = THEMES[type] ? type : 'circuit'; this.theme = THEMES[this.type];
    if (this.type === 'city') this.buildCity(length, cones, seed);
    else if (this.type === 'highway') this.buildHighway(length, cones, seed);
    else this.buildCircuit(length, cones, seed);
    this.segments.forEach((sg) => sg.sprites.sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset)));  // 外側の物を先に描く
    // コースマップ（カーブ量を積分して平面図にする。ゴールまで）
    const segs = this.segments; let x = 0, y = 0, h = -Math.PI / 2; this.mapPts = [];
    for (let n = 0; n <= this.finishSeg && n < segs.length; n++) { h += segs[n].curve * 0.0062; x += Math.cos(h); y += Math.sin(h); if (n % 3 === 0 || n === this.finishSeg) this.mapPts.push([x, y]); }
    this.trackLength = this.segments.length * SEG;
    this.finishZ = this.finishSeg * SEG;
    this.reset();
  }

  // ---------- サーキット ----------
  buildCircuit(length, cones, seed) {
    const rnd = mulberry32(seed);
    const L = { s: 15, m: 30, l: 60 }, C = { e: 2, m: 4, h: 6 }, Hh = { l: 12, m: 24, h: 36 };
    const road = (e, h, l, c, y) => this.addRoad(e, h, l, c, y);
    const straight = (n) => road(n, n, n, 0, 0);
    const hill = (n, h) => road(n, n, n, 0, h);
    const curve = (n, c, h = 0) => road(n, n, n, c, h);
    const sCurves = () => {
      road(L.m, L.m, L.m, -C.e, 0); road(L.m, L.m, L.m, C.m, Hh.m); road(L.m, L.m, L.m, C.e, -Hh.l);
      road(L.m, L.m, L.m, -C.e, Hh.m); road(L.m, L.m, L.m, -C.m, -Hh.m);
    };
    const coneZones = [];   // コーンを置く区間 [開始, 終了, 並べ方]
    const zone = (kind, fn) => { const a = this.segments.length; fn(); coneZones.push([a, this.segments.length, kind]); };

    straight(L.s);                         // スタート直線
    curve(L.m, C.e, Hh.l);
    zone('lane', () => straight(L.m));
    curve(L.m, -C.m, 0);
    hill(L.m, Hh.m);
    zone('slalom', () => straight(L.m));
    if (length !== 'short') {
      sCurves();
      zone('lane', () => curve(L.l, C.m, -Hh.l));
      hill(L.m, Hh.h); hill(L.m, -Hh.h);
    }
    curve(L.m, C.h, 0);
    zone('slalom', () => straight(L.m));
    curve(L.m, -C.h, Hh.l);
    if (length === 'long') {
      sCurves();
      zone('lane', () => curve(L.l, -C.e, Hh.m));
      curve(L.m, C.h, -Hh.m);
      zone('slalom', () => straight(L.m));
    }
    curve(L.m, -C.e, -Hh.l);
    straight(L.s);                         // ゴール前の直線
    this.finishSeg = this.segments.length;
    straight(L.l); straight(L.l);          // ゴール後（描画用）

    // 木（ガードレールの外）。乱数の使い方は旧版と同じにして、コーンの並びが変わらないようにしている
    const TREES = ['pine', 'pine', 'round', 'poplar'];
    for (let n = 10; n < this.segments.length; n += 3 + Math.floor(rnd() * 5)) {
      const side = rnd() < 0.5 ? -1 : 1, r1 = rnd(), r2 = rnd();
      const type = TREES[Math.floor(r2 * 4 * 0.999)];
      this.segments[n].sprites.push({ type, offset: side * (BARRIER + 0.6 + r1 * 2.8), w: (0.9 + r2 * 0.5) * TREE_SCALE[type] });
    }
    // コーン（道路の上）
    if (cones) {
      coneZones.forEach(([a, b, kind]) => {
        let k = 0;
        for (let n = a + 10; n < b - 5; n += kind === 'slalom' ? 22 : 30) {
          let offs;
          if (kind === 'slalom') offs = [(k % 2 ? 1 : -1) * 0.45];
          else { const free = Math.floor(rnd() * 3); offs = [-0.66, 0, 0.66].filter((_, i) => i !== free); }
          offs.forEach((o) => this.segments[n].sprites.push({ type: 'cone', offset: o, w: 0.14 }));
          k++;
        }
      });
    }
    this.decorate(seed);
  }

  // カーブの区間（向きと強さ）を調べ、縁石の印を付ける
  findCorners(kerbs = true) {
    const segs = this.segments, corners = [];
    for (let n = 0; n < segs.length; n++) {
      const c = segs[n].curve, on = Math.abs(c) > KERB_CURVE;
      segs[n].kerb = kerbs && on;
      segs[n].stripe = Math.floor(n / 6) % 2;
      segs[n].shade = segs[n].light ? 0.015 : -0.015;
      if (on && (!corners.length || corners[corners.length - 1].end < n - 1)) corners.push({ start: n, end: n, dir: Math.sign(c), peak: 0 });
      if (on) { const k = corners[corners.length - 1]; k.end = n; k.peak = Math.max(k.peak, Math.abs(c)); }
    }
    return corners;
  }
  // コーンを置く。zones: [開始, 終了, 'slalom'|'lane']
  placeCones(zones, rnd) {
    zones.forEach(([a, b, kind]) => {
      let k = 0;
      for (let n = a + 10; n < b - 5; n += kind === 'slalom' ? 22 : 30) {
        const offs = kind === 'slalom' ? [(k % 2 ? 1 : -1) * 0.45] : (() => { const free = Math.floor(rnd() * 3); return [-0.66, 0, 0.66].filter((_, i) => i !== free); })();
        offs.forEach((o) => this.segments[n].sprites.push({ type: 'cone', offset: o, w: 0.14 }));
        k++;
      }
    });
  }

  // ---------- 市街地：ビルの谷間。直角コーナー・ヘアピン・シケインが続く ----------
  buildCity(length, cones, seed) {
    const rnd = mulberry32(seed + 101), zones = [];
    const road = (e, h, l, c, y = 0) => this.addRoad(e, h, l, c, y);
    const straight = (n, y = 0) => road(n, n, n, 0, y);
    const zone = (kind, fn) => { const a = this.segments.length; fn(); zones.push([a, this.segments.length, kind]); };
    const corner = (d) => road(10, 25, 10, d * 6);
    const hairpin = (d) => road(12, 40, 12, d * 7);
    const chicane = (d) => { road(8, 10, 8, -d * 5); road(8, 10, 8, d * 5); };
    const A = () => { corner(1); zone('slalom', () => straight(30)); corner(-1); straight(20, 6); chicane(1); zone('lane', () => straight(30));
      hairpin(1); straight(25, -8); corner(-1); corner(1); zone('slalom', () => straight(30)); corner(-1); straight(30); };
    const B = () => { chicane(-1); zone('lane', () => straight(30)); hairpin(-1); straight(30, 10); corner(1); zone('slalom', () => straight(30));
      corner(1); straight(25, -10); corner(-1); chicane(1); straight(20); };
    straight(15);
    A(); if (length !== 'short') B(); if (length === 'long') { A(); }
    corner(1); straight(15);
    this.finishSeg = this.segments.length;
    straight(60); straight(60);
    if (cones) this.placeCones(zones, rnd);
    const segs = this.segments, N = segs.length, add = (n, sp) => { if (segs[n]) segs[n].sprites.push(sp); };
    const corners = this.findCorners(true);
    segs.forEach((sg) => { sg.wall = 'concrete'; });
    for (const k of corners) {
      const out = -k.dir;
      for (let n = k.start - 2; n <= k.end + 6; n++) if (segs[n]) segs[n].tires = out;
      for (let n = k.start + 2; n < k.end; n += 8) add(n, { type: k.dir > 0 ? 'chevR' : 'chevL', offset: out * (BARRIER - 0.15), w: 0.5 });
      if (k.peak >= 6.5) for (let n = k.start; n < k.end; n += 6) add(n, { type: 'crowd', offset: out * (BARRIER + 0.9), w: 2.2 });
    }
    // ビル（両側にすき間なく）・街灯・街路樹・信号・歩道橋
    const BLD = ['bld1', 'bld2', 'bld3', 'bld4', 'bld5', 'bld6'];
    for (const side of [-1, 1]) for (let n = 2; n < N; n += 5 + Math.floor(rnd() * 4)) {
      add(n, { type: BLD[Math.floor(rnd() * BLD.length)], offset: side * (BARRIER + 1.8 + rnd() * 0.8), w: 2.6 + rnd() * 0.8 });
    }
    for (let n = 6; n < N; n += 16) {
      add(n, { type: 'lampL', offset: -(BARRIER + 0.25), w: 0.9 }); add(n + 8, { type: 'lampR', offset: BARRIER + 0.25, w: 0.9 });
      add(n + 4, { type: 'round', offset: (n % 32 ? -1 : 1) * (BARRIER + 0.75), w: 0.7, deco: true });
    }
    for (let n = 60; n < N - 20; n += 110) { add(n, { type: 'sigL', offset: -(BARRIER + 0.2), w: 0.8 }); add(n, { type: 'sigR', offset: BARRIER + 0.2, w: 0.8 }); }
    for (let n = 260; n < this.finishSeg - 60; n += 420) add(n, { type: 'bridge', offset: 0, w: 2.9 });
    for (let n = 0; n < 30; n += 3) add(n, { type: 'stand', offset: (n % 2 ? -1 : 1) * (BARRIER + 1.1), w: 2.6 });
    for (let n = this.finishSeg - 20; n < this.finishSeg + 20; n += 3) add(n, { type: 'stand', offset: (n % 2 ? -1 : 1) * (BARRIER + 1.1), w: 2.6 });
    add(9, { type: 'start', offset: 0, w: 2.4 }); add(this.finishSeg, { type: 'gate', offset: 0, w: 2.4 });
  }

  // ---------- 高速道路：長い直線と大きなカーブ。前を走る車を追い越す ----------
  buildHighway(length, cones, seed) {
    const rnd = mulberry32(seed + 202);
    const road = (e, h, l, c, y = 0) => this.addRoad(e, h, l, c, y);
    const straight = (n, y = 0) => road(n, n, n, 0, y);
    const A = () => { road(30, 50, 30, 2, 15); straight(40); road(40, 60, 40, -2.5, -25); straight(40, 40); road(30, 60, 30, 3);
      straight(30); road(40, 40, 40, -2, -30); };
    const B = () => { straight(50); road(30, 60, 30, 2.5, 30); road(30, 60, 30, -2.5, -30); straight(40, -20); road(30, 50, 30, 2); straight(40); };
    straight(15);
    A(); if (length !== 'short') B(); if (length === 'long') { straight(30); A(); }
    straight(30);
    this.finishSeg = this.segments.length;
    straight(60); straight(60);
    // 高速はコーンを置かない（障害物は前を走る車。「コーン」の設定を OFF にすると車も走らない）
    const segs = this.segments, N = segs.length, add = (n, sp) => { if (segs[n]) segs[n].sprites.push(sp); };
    this.findCorners(false);
    segs.forEach((sg) => { sg.wall = 'sound'; });
    for (let n = 12; n < N; n += 24) { add(n, { type: 'hwLampL', offset: -(BARRIER - 0.05), w: 1.1 }); add(n + 12, { type: 'hwLampR', offset: BARRIER - 0.05, w: 1.1 }); }
    for (let n = 50; n < N; n += 50) add(n, { type: 'kmPost', offset: BARRIER - 0.12, w: 0.18 });
    add(Math.floor(this.finishSeg * 0.35), { type: 'hwSign1', offset: 0, w: 2.6 });
    add(Math.max(60, this.finishSeg - 160), { type: 'hwSign2', offset: 0, w: 2.6 });
    for (let n = 5; n < N; n += 2) if (rnd() < 0.6) {
      const type = rnd() < 0.5 ? 'pine' : 'round';
      add(n, { type, offset: (rnd() < 0.5 ? -1 : 1) * (BARRIER + 1 + rnd() * 6), w: (1.1 + rnd() * 0.6) * TREE_SCALE[type], deco: n % 4 !== 1 });
    }
    add(9, { type: 'toll', offset: 0, w: 2.7 }); add(this.finishSeg, { type: 'gate', offset: 0, w: 2.4 });
    // 前を走る車（3車線に1台ずつ間をあけて置く。どの車線も 60〜70 km/h で走る）
    const kinds = ['carWhite', 'carRed', 'carBlack', 'carBlue', 'truck'];
    if (cones) for (let n = 70; n < this.finishSeg - 20; n += 22 + Math.floor(rnd() * 18)) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      this.traffic.push({ z0: n * SEG, x: [-0.66, 0, 0.66][Math.floor(rnd() * 3)], v: (60 + rnd() * 10) / 3.6 * UNITS_PER_M, kind, w: kind === 'truck' ? 0.5 : 0.38 });
    }
  }

  // サーキットらしい景色: 縁石・グラベル・ガードレール・スタンド・ピット・看板・カーブの矢印・距離看板・コースマップ
  decorate(seed) {
    const segs = this.segments, N = segs.length, rnd = mulberry32(seed * 7919 + 13);
    const add = (n, sp) => { if (segs[n]) segs[n].sprites.push(sp); };
    // カーブの区間（向きと強さ）を調べる。芝刈りのしま模様と舗装のむらもここで付ける
    const corners = this.findCorners(true);
    for (const k of corners) {
      const out = -k.dir;   // 右カーブ（curve>0）の外側は左
      // 外側のグラベル（砂利）とタイヤバリア
      for (let n = k.start - 4; n <= k.end + 14; n++) if (segs[n]) { segs[n].gravel = out; segs[n].tires = out; }
      // カーブの矢印看板（外側）
      for (let n = k.start + 2; n < k.end; n += 9) add(n, { type: k.dir > 0 ? 'chevR' : 'chevL', offset: out * (BARRIER - 0.15), w: 0.5 });
      // ブレーキの目安の距離看板（きついカーブの手前）
      if (k.peak >= 3.5) [[30, 'd150'], [20, 'd100'], [10, 'd50']].forEach(([d, t]) => {
        if (k.start - d > 20) add(k.start - d, { type: t, offset: -out * (BARRIER - 0.2), w: 0.36 });
      });
      // マーシャルポスト（旗を持った係員）と観客
      add(k.start + Math.floor((k.end - k.start) / 2), { type: 'marshal', offset: -out * (BARRIER + 0.45), w: 0.7 });
      if (k.peak >= 5) for (let n = k.start; n < k.end; n += 5) add(n, { type: 'crowd', offset: out * (BARRIER + 1.4), w: 2.2 });
    }
    // スタート：グランドスタンドとピット、スタートのゲート
    for (let n = 0; n < 34; n += 3) {
      add(n, { type: 'stand', offset: -(BARRIER + 1.6), w: 3.2 });
      add(n, { type: 'pit', offset: BARRIER + 2.2, w: 4.2 });
    }
    add(9, { type: 'start', offset: 0, w: 2.4 });
    // ゴール付近にもスタンド
    for (let n = this.finishSeg - 24; n < this.finishSeg + 30; n += 3) add(n, { type: 'stand', offset: (n % 2 ? -1 : 1) * (BARRIER + 1.6), w: 3.2 });
    add(this.finishSeg, { type: 'gate', offset: 0, w: 2.4 });
    // 直線には広告看板と照明塔
    const ADS = ['adTakuden', 'adEV', 'adUniv', 'adZero'];
    let ad = 0;
    for (let n = 40; n < N - 10; n += 11 + Math.floor(rnd() * 8)) {
      if (segs[n].kerb || segs[n].gravel || Math.abs(n - this.finishSeg) < 30) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      add(n, { type: ADS[ad++ % ADS.length], offset: side * (BARRIER + 0.25), w: 1.5 });
    }
    for (let n = 30; n < N; n += 40) add(n, { type: 'light', offset: (Math.floor(n / 40) % 2 ? -1 : 1) * (BARRIER + 0.3), w: 0.5 });
    // 林（遠くの木・やぶ）
    for (let n = 5; n < N; n += 2) {
      if (rnd() < 0.55) { const type = rnd() < 0.3 ? 'bush' : (rnd() < 0.6 ? 'pine' : 'round'); add(n, { type, offset: (rnd() < 0.5 ? -1 : 1) * (BARRIER + 3.5 + rnd() * 5), w: (1 + rnd() * 0.6) * TREE_SCALE[type], deco: true }); }
    }
  }

  lastY() { return this.segments.length ? this.segments[this.segments.length - 1].p2.world.y : 0; }
  addSegment(curve, y) {
    const n = this.segments.length;
    this.segments.push({
      index: n, curve, sprites: [],
      p1: { world: { y: this.lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
      light: Math.floor(n / RUMBLE) % 2 === 0,
    });
  }
  addRoad(enter, hold, leave, curve, y) {
    const startY = this.lastY(), endY = startY + y * SEG, total = enter + hold + leave;
    for (let n = 0; n < enter; n++) this.addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    for (let n = 0; n < hold; n++) this.addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    for (let n = 0; n < leave; n++) this.addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }
  findSegment(z) { return this.segments[clamp(Math.floor(z / SEG), 0, this.segments.length - 1)]; }

  reset() {
    this.position = 0; this.speed = 0; this.playerX = 0; this.coneHits = 0; this.crashes = 0;
    this.finished = false; this.offroad = false; this.events = []; this.steer = 0; this.shake = 0;
    this.surface = 'road'; this.particles = []; this.rpm = 0; this.torque = 0; this.onKerb = false;
    this.segments.forEach((s) => s.sprites.forEach((sp) => { sp.hit = false; }));
    (this.traffic || []).forEach((t) => { t.z = t.z0; t.hit = false; t.dx = 0; });
  }

  // 0〜1 のコース進捗
  get progress() { return clamp((this.position + PLAYER_Z) / this.finishZ, 0, 1); }
  // 理論上の最速タイム（だいたいの目安）
  // アクセル全開で道の真ん中を走ったときの時間を、車の性能から計算する
  idealTime(topFactor) {
    const top = Math.min(MAX_SPEED * topFactor, rpmToMs(CAR.maxRpm) * UNITS_PER_M), dt = 1 / 60;
    let v = 0, z = PLAYER_Z, t = 0;
    while (z < this.finishZ && t < 600) { v = Math.min(top, v + motorAccel(v / UNITS_PER_M).a * UNITS_PER_M * dt); z += v * dt; t += dt; }
    return t;
  }

  // ---------- 物理 ----------
  // steer: -1(左)〜1(右), throttle: 0〜1, opts: { topFactor, assist(0〜1) }
  update(dt, steer, throttle, opts) {
    if (!this.segments.length) return;
    const top = Math.min(MAX_SPEED * opts.topFactor, rpmToMs(CAR.maxRpm) * UNITS_PER_M);
    const seg = this.findSegment(this.position + PLAYER_Z);
    const pct = this.speed / MAX_SPEED;
    const dx = dt * 2 * pct;
    this.steer = steer;

    this.position = Math.min(this.position + this.speed * dt, this.trackLength - (DRAW + 5) * SEG);
    this.playerX += dx * steer;
    this.playerX -= dx * pct * seg.curve * CENTRIFUGAL * (1 - opts.assist * 0.7);
    if (opts.assist > 0 && Math.abs(this.playerX) > 0.6) this.playerX -= Math.sign(this.playerX) * opts.assist * dt * 0.8; // 道路に戻すアシスト
    this.skyOffset += seg.curve * pct * dt * 0.02;

    // モータの力で加速。アクセルを離すと回生ブレーキで減速。最高回転数か設定の最高時速で頭打ち
    const vms = this.speed / UNITS_PER_M;
    if (throttle > 0 && this.speed < top - 1) {
      const m = motorAccel(vms, throttle); this.speed += m.a * UNITS_PER_M * dt; this.torque = m.torque;
    } else if (throttle > 0) {
      this.torque = Math.max(0, (0.5 * 1.2 * CAR.cda * vms * vms + CAR.crr * CAR.mass * 9.81) * (CAR.tireD / 2) / CAR.gear / CAR.eff);   // 一定速で走るぶんだけ
    } else {
      this.speed -= (CAR.regen + (0.5 * 1.2 * CAR.cda * vms * vms) / CAR.mass) * UNITS_PER_M * dt; this.torque = this.speed > 1 ? -CAR.torque * 0.5 : 0;
    }
    this.offroad = Math.abs(this.playerX) > 1;
    this.surface = !this.offroad ? 'road' : (seg.gravel && Math.sign(this.playerX) === seg.gravel ? 'gravel' : this.theme.off);
    this.onKerb = seg.kerb && Math.abs(this.playerX) > 1 - CAR_HALF && Math.abs(this.playerX) < 1.14 + CAR_HALF;
    if (this.offroad && this.speed > OFFROAD_LIMIT) this.speed += OFFROAD_DECEL * dt;

    // 当たり判定（自車がいるセグメントと次のセグメントのコーン）
    for (const s of [seg, this.segments[seg.index + 1]]) {
      if (!s) continue;
      for (const sp of s.sprites) {
        if (sp.hit || sp.type !== 'cone') continue;
        if (Math.abs(this.playerX - sp.offset) < (CAR_HALF + sp.w * 0.5) * 0.85) {
          sp.hit = true; this.speed *= 0.5; this.coneHits++; this.events.push('cone'); this.shake = 0.3;
          this.spawnCone(this.playerX - sp.offset);
        }
      }
    }
    // 前を走る車（高速）。追いついてぶつかると、コーンと同じく大きく減速して +1 秒
    const pz = this.position + PLAYER_Z;
    for (const t of this.traffic) {
      t.z += t.v * dt; t.dx *= 0.97;
      if (t.hit || Math.abs(t.z - pz) > SEG * 0.7) continue;
      if (Math.abs(this.playerX - (t.x + t.dx)) < (CAR_HALF + t.w * 0.5) * 0.9) {
        t.hit = true; this.speed = Math.min(this.speed * 0.5, t.v * 0.8); this.coneHits++; this.events.push('car'); this.shake = 0.4;
        t.dx = (t.x + t.dx > this.playerX ? 1 : -1) * 0.3; this.spawnSparks(Math.sign(t.x - this.playerX) || 1);
      }
    }
    // ガードレールにぶつかる
    if (Math.abs(this.playerX) > BARRIER - CAR_HALF - 0.05) {
      const side = Math.sign(this.playerX);
      if (this.speed > MAX_SPEED / 8) {
        this.speed = MAX_SPEED / 8; this.crashes++; this.events.push('crash'); this.shake = 0.5; this.spawnSparks(side);
      }
      this.playerX = side * (BARRIER - CAR_HALF - 0.2);
    }
    this.speed = clamp(this.speed, 0, top);
    this.rpm = msToRpm(this.speed / UNITS_PER_M);
    this.shake = Math.max(0, this.shake - dt);
    if (!this.finished && this.position + PLAYER_Z >= this.finishZ) { this.finished = true; this.events.push('finish'); }
  }

  // 自動運転（待機画面のデモ・テスト用）: コーンをよけ、前の車（高速）が近ければ空いている車線へ移る
  autopilot() {
    const seg = this.findSegment(this.position + PLAYER_Z), pz = this.position + PLAYER_Z;
    const LN = [-0.66, 0, 0.66];
    let free = null;   // 先にあるコーンをよけられる車線
    for (let n = 2; n < 40 && !free; n++) {
      const s = this.segments[seg.index + n]; if (!s) break;
      const cones = s.sprites.filter((sp) => sp.type === 'cone' && !sp.hit);
      if (cones.length) free = LN.filter((x) => cones.every((c) => Math.abs(c.offset - x) > 0.4));
    }
    const near = (xs, x0) => xs.slice().sort((a, b) => Math.abs(a - x0) - Math.abs(b - x0));
    let cand = free ? near(free, this.playerX) : [0, ...near([-0.66, 0.66], this.playerX)];
    if (!cand.length) cand = [0];
    let target = cand[0];
    if (this.traffic.length) {
      // 車線ごとに、いちばん近い前の車までの距離（横に並んでいる車は 0 とみなす）
      const gap = (x) => this.traffic.reduce((g, t) => (!t.hit && Math.abs(t.x + t.dx - x) < 0.4 && t.z > pz - SEG * 0.8 ? Math.min(g, Math.max(0, t.z - pz)) : g), Infinity);
      // 2車線またぐときは、まん中の車線も空いていること
      const pass = (x) => gap(x) > SEG * 35 && (Math.abs(x - this.playerX) < 1 || gap(0) > SEG * 8);
      const ok = cand.find(pass);
      target = ok !== undefined ? ok : cand.reduce((a, b) => (gap(b) > gap(a) ? b : a));
    }
    const pct = this.speed / MAX_SPEED;
    return clamp((target - this.playerX) * 2.5 + seg.curve * CENTRIFUGAL * pct, -1, 1);
  }

  // ---------- 演出（はね飛ぶコーン・砂ぼこり・火花） ----------
  // 画面上の自車からの相対位置（自車の幅=1）で持つ
  spawnCone(rel) {
    const dir = rel > 0 ? -1 : 1;
    this.particles.push({ kind: 'cone', x: -dir * 0.1, y: -0.4, vx: dir * (0.8 + Math.random() * 0.6), vy: -2.6, r: 0, vr: dir * 9, life: 1.1, max: 1.1, s: 0.32 });
  }
  spawnSparks(side) {
    for (let i = 0; i < 16; i++) this.particles.push({ kind: 'spark', x: side * 0.45, y: -0.2, vx: side * (Math.random() * 1.5) - side * 0.3, vy: -Math.random() * 2, life: 0.4 + Math.random() * 0.3, max: 0.7 });
  }
  stepParticles(dt) {
    const pct = this.speed / MAX_SPEED;
    if (this.offroad && pct > 0.08 && this.surface !== 'pavement') {
      const n = Math.random() < pct * 1.8 ? 2 : 0;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        this.particles.push({ kind: this.surface === 'gravel' ? 'dust' : 'grass', x: side * 0.38 + (Math.random() - 0.5) * 0.1, y: -0.05,
          vx: side * 0.25 * Math.random(), vy: -0.3 - Math.random() * 0.4, life: 0.7, max: 0.7, s: 0.08 + Math.random() * 0.05 });
      }
    }
    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'cone' || p.kind === 'spark') p.vy += 6 * dt;
      if (p.kind === 'cone') p.r += p.vr * dt;
      if (p.kind === 'dust' || p.kind === 'grass') p.s += dt * 0.25;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 200) this.particles.splice(0, this.particles.length - 200);
  }

  // ---------- 描画 ----------
  render(ctx, W, H) {
    const segs = this.segments;
    if (!segs.length) return;
    if (!SPR.ready) makeSprites();
    const now = performance.now(), fdt = Math.min(0.05, (now - (this._lastRender || now)) / 1000); this._lastRender = now;
    this.stepParticles(fdt);
    const base = this.findSegment(this.position);
    const basePct = (this.position % SEG) / SEG;
    const pSeg = this.findSegment(this.position + PLAYER_Z);
    const pPct = ((this.position + PLAYER_Z) % SEG) / SEG;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * 12 : (this.offroad && this.speed > 0 ? (Math.random() - 0.5) * (this.surface === 'gravel' ? 7 : 4) : 0);

    ctx.save();
    ctx.translate(0, shakeY);
    ctx.imageSmoothingEnabled = true;
    this.drawBackground(ctx, W, H, playerY, now);

    // 手前から奥へ投影して、奥から手前へ描く（重なりが正しくなる）。maxy より下は手前の坂に隠れて見えない
    const vis = [];
    let x = 0, dx = -(base.curve * basePct), maxy = H;
    for (let n = 0; n < DRAW; n++) {
      const s = segs[base.index + n];
      if (!s) break;
      s.fog = 1 / Math.pow(Math.E, (n / DRAW) * (n / DRAW) * FOG);
      this.project(s.p1, this.playerX * ROAD_W - x, playerY + CAM_H, this.position, W, H);
      this.project(s.p2, this.playerX * ROAD_W - x - dx, playerY + CAM_H, this.position, W, H);
      x += dx; dx += s.curve;
      s.clip = maxy; s.drawn = false;
      if (s.p2.camera.z <= CAM_DEPTH) continue;
      if (s.p2.screen.y < maxy) { s.drawn = true; maxy = s.p2.screen.y; }
      vis.push(s);
    }
    // いちばん手前のセグメントは画面の下端まで伸ばす（下にすき間ができないように）
    if (vis.length) {
      const s = vis[0], a = s.p1.screen, b = s.p2.screen;
      if (a.y < H + 2 && a.y > b.y) {
        const t = (H + 2 - b.y) / (a.y - b.y);
        s.ext = { x: b.x + (a.x - b.x) * t, y: H + 2, w: b.w + (a.w - b.w) * t, scale: b.scale + (a.scale - b.scale) * t };
      } else s.ext = null;
      for (let i = 1; i < vis.length; i++) vis[i].ext = null;
    }
    // 前を走る車を、見えているセグメントに割り当てる
    const frame = (this._frame = (this._frame || 0) + 1);
    for (const s of vis) { s.cars = null; s.carFrame = frame; }
    for (const t of this.traffic) {
      const sg = segs[Math.floor(t.z / SEG)];
      if (sg && sg.carFrame === frame) (sg.cars || (sg.cars = [])).push(t);
    }
    for (let i = vis.length - 1; i >= 0; i--) {
      const s = vis[i];
      if (s.drawn) this.drawSegment(ctx, W, H, s);
      for (const sp of s.sprites) if (Math.abs(sp.offset) > BARRIER) this.drawSprite(ctx, s, sp);
      if (s.drawn) this.drawBarrier(ctx, H, s);
      for (const sp of s.sprites) if (Math.abs(sp.offset) <= BARRIER) this.drawSprite(ctx, s, sp);
      if (s.cars) for (const t of s.cars) this.drawSprite(ctx, s, { type: t.kind, offset: t.x + t.dx, w: t.w }, (t.z % SEG) / SEG);
    }
    this.drawCar(ctx, W, H, now);
    ctx.restore();
    this.postFx(ctx, W, H);
    if (this.showMap) this.drawMap(ctx, W, H);
  }

  // 仕上げの画像処理：ブルーム（明るい所のにじみ）・色調補正・レンズフレア・スピード感の筋・ビネット・フィルムグレイン
  postFx(ctx, W, H) {
    const pct = clamp(this.speed / MAX_SPEED, 0, 1);
    ctx.save();
    if (this.quality) {
      const bw = Math.max(96, (W / 5) | 0), bh = Math.max(54, (H / 5) | 0);
      let b = this._bloom;
      if (!b || b.width !== bw || b.height !== bh) { b = this._bloom = document.createElement('canvas'); b.width = bw; b.height = bh; b.g = b.getContext('2d'); }
      b.g.clearRect(0, 0, bw, bh); b.g.filter = 'blur(2.5px) contrast(2.3) brightness(0.85)'; b.g.drawImage(ctx.canvas, 0, 0, bw, bh); b.g.filter = 'none';
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.5; ctx.imageSmoothingEnabled = true; ctx.drawImage(b, 0, 0, W, H);
      // 色調補正（上は暖かく、下は少し青く。ソフトライトで重ねる）
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'soft-light';
      const cg = ctx.createLinearGradient(0, 0, 0, H);
      cg.addColorStop(0, 'rgba(255,205,150,.30)'); cg.addColorStop(0.55, 'rgba(255,255,255,0)'); cg.addColorStop(1, 'rgba(70,100,150,.32)');
      ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);
      // レンズフレア（太陽が画面内のとき）
      const sun = this._sun;
      if (sun && sun.x > -W * 0.1 && sun.x < W * 1.1 && this.theme.bg !== 'city') {
        ctx.globalCompositeOperation = 'screen';
        const mx = W / 2, my = H / 2, dx = mx - sun.x, dy = my - sun.y, fade = clamp(1 - Math.abs(sun.x - mx) / (W * 0.75), 0, 1);
        const ghosts = [[0.35, 0.05, '255,220,160'], [0.7, 0.09, '160,210,255'], [1.0, 0.04, '255,180,120'], [1.5, 0.13, '200,255,200'], [1.9, 0.06, '255,200,255']];
        for (const [t, r, col] of ghosts) {
          const gx = sun.x + dx * t, gy = sun.y + dy * t, gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, H * r);
          gr.addColorStop(0, `rgba(${col},${0.22 * fade})`); gr.addColorStop(0.7, `rgba(${col},${0.08 * fade})`); gr.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(gx, gy, H * r, 0, Math.PI * 2); ctx.fill();
        }
      }
      // スピード感：画面の端から中心へ向かう細い筋
      if (pct > 0.45) {
        ctx.globalCompositeOperation = 'screen'; ctx.lineCap = 'round';
        const cx = W * this.cx, cy = H * 0.5, n = Math.round((pct - 0.4) * 36), M = Math.max(W, H);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, r0 = M * (0.42 + Math.random() * 0.2), r1 = r0 + M * (0.06 + Math.random() * 0.12) * pct;
          ctx.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.07})`; ctx.lineWidth = 1 + Math.random() * 2.2;
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.7); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.7); ctx.stroke();
        }
      }
    }
    // ビネット（周辺を暗く）
    ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 1;
    if (!this._vig || this._vig.W !== W || this._vig.H !== H) {
      const vg = ctx.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.35, W / 2, H * 0.52, Math.hypot(W, H) * 0.56);
      vg.addColorStop(0, 'rgba(255,255,255,1)'); vg.addColorStop(1, 'rgba(70,72,80,1)');
      this._vig = { W, H, g: vg };
    }
    ctx.fillStyle = this._vig.g; ctx.fillRect(0, 0, W, H);
    // フィルムグレイン
    if (this.quality) {
      if (!SPR.grain) SPR.grain = canvas(192, 192, (g, w, h) => { const d = g.createImageData(w, h); for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 255 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); });
      if (!this._grainPat) this._grainPat = ctx.createPattern(SPR.grain, 'repeat');
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.07;
      ctx.translate((Math.random() * 192) | 0, (Math.random() * 192) | 0); ctx.fillStyle = this._grainPat; ctx.fillRect(-192, -192, W + 192, H + 192);
    }
    ctx.restore();
  }

  project(p, camX, camY, camZ, W, H) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    p.screen.scale = CAM_DEPTH / p.camera.z;
    p.screen.x = W * this.cx + p.screen.scale * p.camera.x * W / 2;
    p.screen.y = H / 2 - p.screen.scale * p.camera.y * H / 2;
    p.screen.w = p.screen.scale * ROAD_W * W / 2;
  }

  // 空・雲・遠くの山・丘・森
  drawBackground(ctx, W, H, playerY, now) {
    const hy = H * 0.5 + playerY * 0.002;
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, rgb(C.sky1)); g.addColorStop(0.65, rgb(C.sky2)); g.addColorStop(1, FOG_CSS);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 太陽
    const sx = ((0.78 - this.skyOffset * 0.25) % 1 + 1) % 1 * W * 1.3 - W * 0.15, sy = hy * 0.28;
    ctx.drawImage(SPR.sun, sx - H * 0.22, sy - H * 0.22, H * 0.44, H * 0.44);
    this._sun = { x: sx, y: sy };
    if (this.quality) {   // 太陽から広がる光の筋（薄く）
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.12 + i * 0.095) + Math.sin(now / 5000 + i) * 0.02, L = H * 1.4, wd = 0.028 + (i % 3) * 0.012;
        const gr = ctx.createLinearGradient(sx, sy, sx + Math.cos(a) * L, sy + Math.sin(a) * L);
        gr.addColorStop(0, 'rgba(255,236,190,.16)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a - wd) * L, sy + Math.sin(a - wd) * L); ctx.lineTo(sx + Math.cos(a + wd) * L, sy + Math.sin(a + wd) * L); ctx.fill();
      }
      ctx.restore();
    }
    // 雲（ゆっくり流れ、カーブで横に動く）
    const drift = now / 1000 * 0.004;
    for (let i = 0; i < (this.quality ? 7 : 0); i++) {
      const img = SPR.clouds[i % SPR.clouds.length], k = 0.3 + (i % 3) * 0.15;
      const cw = W * (0.22 + (i % 3) * 0.08), ch = cw * img.height / img.width;
      const px = ((i * 0.37 + drift * (1 + i % 2) - this.skyOffset * k) % 1.4 + 1.4) % 1.4 * W * 1.0 - cw * 0.5 - W * 0.1;
      ctx.globalAlpha = 0.85; ctx.drawImage(img, px, hy * (0.1 + (i * 0.13) % 0.45), cw, ch);
    }
    ctx.globalAlpha = 1;
    if (this.theme.bg === 'city') { this.drawSkyline(ctx, W, H, hy); return; }
    // 山と丘（遠いほど霞んで青っぽい）。カーブで左右に流れる
    const layers = [
      { c: [150, 178, 204], h: 0.2, k: 0.25, f: 2, j: 0.15 },
      { c: [116, 152, 150], h: 0.12, k: 0.5, f: 4, j: 0.2 },
      { c: [70, 120, 78], h: 0.06, k: 1, f: 9, j: 0.6 },
    ];
    for (const Lr of layers) {
      ctx.fillStyle = rgb(Lr.c); ctx.beginPath(); ctx.moveTo(0, hy + 2);
      const off = this.skyOffset * Lr.k * W;
      for (let i = 0; i <= 64; i++) {
        const px = (i / 64) * W, t = (px + off) / W * Math.PI * 2;
        const y = hy - H * Lr.h * (0.55 + 0.25 * Math.sin(t * Lr.f / 2) + 0.2 * Math.sin(t * Lr.f * 1.7 + 1) + Lr.j * 0.15 * Math.sin(t * Lr.f * 7.3));
        ctx.lineTo(px, y);
      }
      ctx.lineTo(W, hy + 2); ctx.closePath(); ctx.fill();
    }
    // 地平線近くの森（木のてっぺんのギザギザ）
    ctx.fillStyle = 'rgb(58,104,66)'; ctx.beginPath(); ctx.moveTo(0, hy + 2);
    const off = this.skyOffset * 1.6 * W;
    for (let i = 0; i <= 160; i++) {
      const px = (i / 160) * W, t = (px + off) / W * 40;
      ctx.lineTo(px, hy - H * 0.012 * (1.2 + Math.abs(Math.sin(t)) * 1.1 + Math.sin(t * 0.37) * 0.7));
    }
    ctx.lineTo(W, hy + 2); ctx.closePath(); ctx.fill();
    // 地平線のもや
    const hz = ctx.createLinearGradient(0, hy - H * 0.06, 0, hy + 4);
    hz.addColorStop(0, 'rgba(205,222,232,0)'); hz.addColorStop(1, 'rgba(205,222,232,.85)');
    ctx.fillStyle = hz; ctx.fillRect(0, hy - H * 0.06, W, H * 0.06 + 4);
    ctx.fillStyle = FOG_CSS; ctx.fillRect(0, hy, W, H - hy);
  }

  // 市街地の背景：遠くのビル群（2段。カーブで左右に流れる）
  drawSkyline(ctx, W, H, hy) {
    for (const [img, k, hh] of [[SPR.skyFar, 0.3, 0.28], [SPR.skyNear, 0.7, 0.2]]) {
      const tw = W * 1.4, th = H * hh, off = ((this.skyOffset * k * W) % tw + tw) % tw;
      for (let x = -off; x < W; x += tw) ctx.drawImage(img, x, hy - th + 2, tw + 1, th);
    }
    const hz = ctx.createLinearGradient(0, hy - H * 0.05, 0, hy + 4);
    hz.addColorStop(0, 'rgba(205,222,232,0)'); hz.addColorStop(1, 'rgba(205,222,232,.7)');
    ctx.fillStyle = hz; ctx.fillRect(0, hy - H * 0.05, W, H * 0.05 + 4);
    ctx.fillStyle = FOG_CSS; ctx.fillRect(0, hy, W, H - hy);
  }

  drawSegment(ctx, W, H, s) {
    const a = s.ext || s.p1.screen, b = s.p2.screen;
    const x1 = a.x, y1 = a.y, w1 = a.w, x2 = b.x, w2 = b.w;
    const y2 = b.y - 0.6;   // 少し重ねて、セグメントの継ぎ目に線が出ないようにする
    const f = s.fog;
    // 坂の明るさ（上り坂は日が当たって明るく、下り坂は少し暗く）
    const slope = (s.p2.world.y - s.p1.world.y) / SEG;
    const lit = clamp(1 + slope * 0.6, 0.85, 1.12);
    const Q = (c, k, xa1, xb1, xa2, xb2) => poly(ctx, fogc(c, f, k * lit), xa1, y1, xb1, y1, xb2, y2, xa2, y2);
    const at = (o) => [x1 + w1 * o, x2 + w2 * o];   // 道路の中心からの位置 o（半幅=1）の画面 x

    // 芝生（しま模様）
    const T = this.theme;
    ctx.fillStyle = fogc(s.stripe ? T.ground1 : T.ground2, f, lit); ctx.fillRect(0, b.y + 0.5, W, y1 - b.y + 0.5);
    // 外側のグラベル（砂利）
    if (s.gravel) {
      const g = s.gravel, [i1, i2] = at(g * 1.14), [o1, o2] = at(g * BARRIER);
      Q(s.index % 2 ? C.gravel1 : C.gravel2, 1, i1, o1, i2, o2);
    }
    // 縁石（カーブだけ）
    const kw = s.kerb ? 0.14 : 0.05;
    for (const side of [-1, 1]) {
      const [e1, e2] = at(side), [k1, k2] = at(side * (1 + kw));
      Q(s.kerb ? (s.light ? C.kerbW : C.kerbR) : T.road, s.kerb ? 1 : 0.92, e1, k1, e2, k2);
    }
    // 舗装
    const [l1, l2] = at(-1), [r1, r2] = at(1);
    Q(T.road, 1 + s.shade, l1, r1, l2, r2);
    if (w2 < 6) return;   // 遠くて細いときは細かい線を省く
    if (this.quality && w2 > 9) this.drawSurface(ctx, s, at, Q, b.y, y1, w1, w2, x1, x2, f);
    // 白線（両端）
    for (const side of [-1, 1]) { const [p1, p2] = at(side * 0.965), [q1, q2] = at(side * 0.995); Q(C.roadLine, 1, p1, q1, p2, q2); }
    if (s.index === this.finishSeg || s.index === this.finishSeg + 1 || s.index === 9) {     // ゴールのチェッカーとスタートライン
      const n = 12, pal = s.index === 9 ? [C.roadLine] : [[250, 250, 250], [20, 20, 20]];
      for (let i = 0; i < n; i++) {
        const c = s.index === 9 ? pal[0] : pal[(i + s.index) % 2];
        const [p1, p2] = at(-1 + (2 * i) / n), [q1, q2] = at(-1 + (2 * (i + 1)) / n);
        Q(c, 1, p1, q1, p2, q2);
      }
    } else if (s.index >= 2 && s.index <= 8) {          // スタートのグリッド（白いかぎ形）
      if (s.index % 3 === 2) for (const o of [-0.55, 0.15]) { const [p1, p2] = at(o), [q1, q2] = at(o + 0.4); Q(C.roadLine, 1, p1, q1, p2, q2); }
    } else if (s.light && (this.type === 'highway' || s.index % 2 === 0)) {   // 車線の破線（高速は長い破線）
      const lw = 0.025;
      for (let i = 1; i < LANES; i++) { const o = -1 + (2 * i) / LANES, [p1, p2] = at(o - lw), [q1, q2] = at(o + lw); Q(C.roadLine, 0.95, p1, q1, p2, q2); }
    }
  }

  // 路面のリアリティ：補修跡・タイヤの通り道（黒ずみ）・路肩の砂・芝のむら
  drawSurface(ctx, s, at, Q, yTop, y1, w1, w2, x1, x2, f) {
    const h = hash(s.index);
    // 補修されたアスファルト（ところどころ色が違う帯）
    if (h < 0.14) { const [p1, p2] = at(-1), [q1, q2] = at(1); ctx.globalAlpha = 0.5; Q(h < 0.07 ? [60, 62, 66] : [112, 114, 118], 1, p1, q1, p2, q2); ctx.globalAlpha = 1; }
    // 各車線のタイヤの通り道（2本ずつ暗くなる）
    ctx.globalAlpha = 0.16 + 0.1 * (1 - f);
    for (let i = 0; i < LANES; i++) {
      const c = -1 + (2 * i + 1) / LANES;
      for (const d of [-0.1, 0.1]) { const [p1, p2] = at(c + d - 0.035), [q1, q2] = at(c + d + 0.035); Q([22, 22, 24], 1, p1, q1, p2, q2); }
    }
    // 継ぎ目・ひび（細い暗線）
    if (h > 0.8 && w2 > 16) { ctx.globalAlpha = 0.28; const [p1, p2] = at(-1), [q1, q2] = at(1); poly(ctx, 'rgb(20,20,22)', p1, y1, q1, y1, q2, y1 - 1.4, p2, y1 - 1.4); }
    // 路肩のほこり・砂（道路の外側が汚れる）
    ctx.globalAlpha = 0.22;
    for (const side of [-1, 1]) { const [p1, p2] = at(side * 0.9), [q1, q2] = at(side * 1.0); Q([150, 138, 112], 1, p1, q1, p2, q2); }
    ctx.globalAlpha = 1;
    // 芝（または歩道）のむら：道路沿いに濃淡の斑点を散らす
    if (w2 > 22) {
      for (let k = 0; k < 4; k++) {
        const r = hash(s.index * 7 + k * 13), r2 = hash(s.index * 11 + k * 5), side = k % 2 ? 1 : -1;
        const o = 1.7 + r * 3.2, wd = 0.1 + r2 * 0.28, yy = lerp(y1, yTop, r2);
        const px = lerp(x1, x2, r2) + side * lerp(w1, w2, r2) * o, ww = lerp(w1, w2, r2) * wd;
        ctx.fillStyle = r2 > 0.5 ? `rgba(25,60,22,${0.16 * f})` : `rgba(160,200,110,${0.12 * f})`;
        ctx.fillRect(px - ww / 2, yy, ww, Math.max(1.5, ww * 0.12));
      }
    }
  }

  // ガードレール（直線）とタイヤバリア（カーブの外側）。道路の両側に立つ壁として描く
  drawBarrier(ctx, H, s) {
    const a = s.ext || s.p1.screen, b = s.p2.screen, f = s.fog;
    const h1 = a.scale * BARRIER_H * H / 2, h2 = b.scale * BARRIER_H * H / 2;
    if (h1 < 0.8) return;
    for (const side of [-1, 1]) {
      const bx1 = a.x + a.w * BARRIER * side, bx2 = b.x + b.w * BARRIER * side;
      if (s.tires === side) {
        // タイヤを積んだ壁（黒）＋ 紅白のベルト
        poly(ctx, fogc(C.tire, f), bx1, a.y, bx2, b.y, bx2, b.y - h2 * 1.1, bx1, a.y - h1 * 1.1);
        const c = s.light ? C.kerbR : C.kerbW;
        poly(ctx, fogc(c, f), bx1, a.y - h1 * 0.55, bx2, b.y - h2 * 0.55, bx2, b.y - h2 * 0.85, bx1, a.y - h1 * 0.85);
      } else if (s.wall === 'concrete') {
        // 市街地：コンクリートの壁（青白の帯）＋ 上に金網
        poly(ctx, fogc([196, 196, 190], f), bx1, a.y, bx2, b.y, bx2, b.y - h2 * 0.9, bx1, a.y - h1 * 0.9);
        poly(ctx, fogc(s.light ? [30, 90, 170] : [235, 235, 230], f), bx1, a.y - h1 * 0.6, bx2, b.y - h2 * 0.6, bx2, b.y - h2 * 0.9, bx1, a.y - h1 * 0.9);
        if (this.quality && h1 > 3) {
          ctx.globalAlpha = 0.22; poly(ctx, fogc([60, 60, 60], f), bx1, a.y - h1 * 0.9, bx2, b.y - h2 * 0.9, bx2, b.y - h2 * 2.6, bx1, a.y - h1 * 2.6); ctx.globalAlpha = 1;
          if (s.index % 3 === 0) { const pw = Math.max(1, a.w * 0.02); ctx.fillStyle = fogc([80, 80, 84], f); ctx.fillRect(bx1 - pw / 2, a.y - h1 * 2.6, pw, h1 * 1.7); }
        }
      } else if (s.wall === 'sound') {
        // 高速：防音壁（下はコンクリート、上は半透明の板）
        poly(ctx, fogc([178, 180, 176], f), bx1, a.y, bx2, b.y, bx2, b.y - h2 * 0.8, bx1, a.y - h1 * 0.8);
        ctx.globalAlpha = 0.7; poly(ctx, fogc([168, 192, 206], f), bx1, a.y - h1 * 0.8, bx2, b.y - h2 * 0.8, bx2, b.y - h2 * 2.2, bx1, a.y - h1 * 2.2); ctx.globalAlpha = 1;
        if (s.index % 2 === 0 && h1 > 4) { const pw = Math.max(1, a.w * 0.025); ctx.fillStyle = fogc([110, 116, 124], f); ctx.fillRect(bx1 - pw / 2, a.y - h1 * 2.2, pw, h1 * 2.2); }
      } else {
        // ガードレール：支柱 ＋ 波板
        poly(ctx, fogc(C.armcoDark, f), bx1, a.y, bx2, b.y, bx2, b.y - h2 * 0.45, bx1, a.y - h1 * 0.45);
        poly(ctx, fogc(C.armco, f), bx1, a.y - h1 * 0.45, bx2, b.y - h2 * 0.45, bx2, b.y - h2, bx1, a.y - h1);
        poly(ctx, fogc(C.armco, f, 0.78), bx1, a.y - h1 * 0.68, bx2, b.y - h2 * 0.68, bx2, b.y - h2 * 0.76, bx1, a.y - h1 * 0.76);
        if (s.index % 2 === 0 && h1 > 6) { const pw = Math.max(1, a.w * 0.03); ctx.fillStyle = fogc(C.armcoDark, f, 0.8); ctx.fillRect(bx1 - pw / 2, a.y - h1, pw, h1); }
      }
    }
  }

  drawSprite(ctx, s, sp, pct = 0) {
    if (sp.hit || (sp.deco && !this.quality)) return;
    const img = SPR[sp.type]; if (!img) return;
    if (s.p1.camera.z <= CAM_DEPTH) return;
    const a = s.p1.screen, b = s.p2.screen;
    const sc = pct ? { x: lerp(a.x, b.x, pct), y: lerp(a.y, b.y, pct), w: lerp(a.w, b.w, pct) } : a;
    const dw = sc.w * sp.w, dh = dw * img.height / img.width;
    if (dw < 1.2 || dw > 6000) return;
    const x = sc.x + sp.offset * sc.w - dw / 2, y = sc.y - dh;
    const visH = Math.min(dh, s.clip - y);   // 手前の坂に隠れる部分は描かない
    if (visH <= 0) return;
    ctx.globalAlpha = Math.min(1, s.fog * 1.5);
    ctx.drawImage(img, 0, 0, img.width, img.height * visH / dh, x, y, dw, visH);
    ctx.globalAlpha = 1;
  }

  // 自車（学生フォーミュラ EV を後ろから見た図）
  drawCar(ctx, W, H, now) {
    const cw = 2 * CAR_HALF * (ROAD_W / CAM_H) * W / 2;   // 画面上の車幅（当たり判定の幅と同じ）
    const cx = W * this.cx, by = H - H * 0.04;
    const pct = this.speed / MAX_SPEED;
    const bounce = this.speed > 0 ? Math.sin(now / 40) * (this.offroad ? 3 : 0.6) : 0;
    const u = cw / 100;
    const braking = this._prevSpeed > this.speed + 1; this._prevSpeed = this.speed;
    ctx.save();
    ctx.translate(cx, by + bounce);
    // 砂ぼこり・芝（車の後ろ＝車より奥に見える物は先に）
    this.drawParticles(ctx, u * 100, false);
    ctx.rotate(this.steer * 0.035);
    // 影
    const sh = ctx.createRadialGradient(0, 0, 10 * u, 0, 0, 62 * u);
    sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.save(); ctx.scale(1, 0.16); ctx.beginPath(); ctx.arc(0, 10 * u, 62 * u, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // タイヤの接地面の濃い影（地面に押し付けられている感じ）
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse((sx > 0 ? 39 : -39) * u, 2 * u, 17 * u, 3.2 * u, 0, 0, Math.PI * 2); ctx.fill(); }
    // 前輪（ハンドルを切ると少し見える）
    ctx.fillStyle = '#121212';
    const fs = this.steer * 3 * u;
    rrect(ctx, -44 * u + fs, -30 * u, 12 * u, 16 * u, 3 * u); rrect(ctx, 32 * u + fs, -30 * u, 12 * u, 16 * u, 3 * u);
    // サイドポンツーン
    const bodyG = ctx.createLinearGradient(0, -44 * u, 0, -4 * u);
    bodyG.addColorStop(0, '#2f80e0'); bodyG.addColorStop(0.5, '#1565c0'); bodyG.addColorStop(1, '#0b3d82');
    ctx.fillStyle = bodyG;
    ctx.beginPath(); ctx.moveTo(-44 * u, -20 * u); ctx.lineTo(-40 * u, -34 * u); ctx.lineTo(40 * u, -34 * u); ctx.lineTo(44 * u, -20 * u); ctx.closePath(); ctx.fill();
    // サスペンションアーム
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 2 * u; ctx.beginPath();
    ctx.moveTo(-14 * u, -22 * u); ctx.lineTo(-36 * u, -18 * u); ctx.moveTo(-14 * u, -10 * u); ctx.lineTo(-36 * u, -8 * u);
    ctx.moveTo(14 * u, -22 * u); ctx.lineTo(36 * u, -18 * u); ctx.moveTo(14 * u, -10 * u); ctx.lineTo(36 * u, -8 * u); ctx.stroke();
    // 後輪（スリックタイヤ。走ると表面が流れる）
    for (const sx of [-1, 1]) {
      const tx = sx > 0 ? 27 * u : -51 * u;
      const tg = ctx.createLinearGradient(tx, 0, tx + 24 * u, 0);
      tg.addColorStop(0, '#0c0c0c'); tg.addColorStop(0.35, '#2b2b2b'); tg.addColorStop(0.65, '#262626'); tg.addColorStop(1, '#0c0c0c');
      ctx.fillStyle = tg; rrect(ctx, tx, -34 * u, 24 * u, 36 * u, 5 * u);
      const edge = ctx.createLinearGradient(0, -34 * u, 0, 2 * u);   // 上は日が当たって少し明るく、接地面は暗い
      edge.addColorStop(0, 'rgba(255,255,255,.14)'); edge.addColorStop(0.4, 'rgba(255,255,255,0)'); edge.addColorStop(1, 'rgba(0,0,0,.35)');
      ctx.fillStyle = edge; rrect(ctx, tx, -34 * u, 24 * u, 36 * u, 5 * u);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      const ph = (now / 1000 * pct * 40) % 1;
      for (let k = 0; k < 4; k++) { const ty = -32 * u + ((k + ph) / 4) * 32 * u; ctx.fillRect(tx + 3 * u, ty, 18 * u, 1.2 * u); }
    }
    // ディフューザー
    ctx.fillStyle = '#161616'; ctx.fillRect(-24 * u, -12 * u, 48 * u, 10 * u);
    ctx.fillStyle = '#2c2c2c'; for (let k = -2; k <= 2; k++) ctx.fillRect(k * 9 * u - 0.8 * u, -12 * u, 1.6 * u, 10 * u);
    ctx.fillStyle = 'rgba(255,255,255,.07)';   // カーボンの織り目
    for (let ix = 0; ix < 12; ix++) for (let iy = 0; iy < 3; iy++) if ((ix + iy) % 2 === 0) ctx.fillRect(-24 * u + ix * 4 * u, -12 * u + iy * 3.3 * u, 4 * u, 3.3 * u);
    // 車体の後ろ（バッテリーの箱が入っている）
    ctx.fillStyle = bodyG;
    ctx.beginPath(); ctx.moveTo(-26 * u, -12 * u); ctx.lineTo(26 * u, -12 * u); ctx.lineTo(17 * u, -40 * u); ctx.lineTo(-17 * u, -40 * u); ctx.closePath(); ctx.fill();
    // クリアコートのつや（左上から光が当たる）：車体全体に明暗と細いハイライトを重ねる
    const cc = ctx.createLinearGradient(-44 * u, 0, 44 * u, 0);
    cc.addColorStop(0, 'rgba(255,255,255,.34)'); cc.addColorStop(0.3, 'rgba(255,255,255,0)'); cc.addColorStop(0.62, 'rgba(0,10,40,0)'); cc.addColorStop(1, 'rgba(0,10,40,.42)');
    ctx.fillStyle = cc;
    ctx.beginPath(); ctx.moveTo(-44 * u, -20 * u); ctx.lineTo(-40 * u, -34 * u); ctx.lineTo(40 * u, -34 * u); ctx.lineTo(44 * u, -20 * u); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-26 * u, -12 * u); ctx.lineTo(26 * u, -12 * u); ctx.lineTo(17 * u, -40 * u); ctx.lineTo(-17 * u, -40 * u); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.1 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-38 * u, -33 * u); ctx.lineTo(-12 * u, -33.5 * u); ctx.moveTo(-23 * u, -14 * u); ctx.lineTo(-17 * u, -38 * u); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-26 * u, -16 * u, 52 * u, 2.2 * u);
    // 高電圧マーク（EV の黄色い三角）
    ctx.fillStyle = '#ffd400'; tri(ctx, 0, -33 * u, -6 * u, -22 * u, 6 * u, -22 * u);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(1 * u, -31 * u); ctx.lineTo(-2 * u, -27 * u); ctx.lineTo(0.5 * u, -27 * u); ctx.lineTo(-1 * u, -23.5 * u); ctx.lineTo(2.2 * u, -28 * u); ctx.lineTo(-0.2 * u, -28 * u); ctx.closePath(); ctx.fill();
    // ロールバー（メインフープ）
    ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 2.6 * u; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-12 * u, -38 * u); ctx.lineTo(-9 * u, -60 * u); ctx.lineTo(9 * u, -60 * u); ctx.lineTo(12 * u, -38 * u); ctx.stroke();
    // ヘルメット
    const hg = ctx.createRadialGradient(-3 * u, -52 * u, 1 * u, 0, -48 * u, 10 * u);
    hg.addColorStop(0, '#ffffff'); hg.addColorStop(1, '#c9ced6');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, -48 * u, 8.5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1565c0'; ctx.fillRect(-1.6 * u, -56.5 * u, 3.2 * u, 17 * u);
    ctx.fillStyle = '#ffcf3f'; ctx.fillRect(-8.5 * u, -47 * u, 17 * u, 2.4 * u);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(-3.4 * u, -52.5 * u, 2.2 * u, 1.2 * u, -0.6, 0, Math.PI * 2); ctx.fill();   // ヘルメットの反射
    // リアウイング（翼端板 ＋ 2枚の翼）
    ctx.fillStyle = '#222'; ctx.fillRect(-7 * u, -66 * u, 2.4 * u, 26 * u); ctx.fillRect(4.6 * u, -66 * u, 2.4 * u, 26 * u);
    ctx.fillStyle = '#111'; rrect(ctx, -42 * u, -70 * u, 84 * u, 8 * u, 2 * u);
    ctx.fillStyle = '#1565c0'; rrect(ctx, -42 * u, -79 * u, 84 * u, 6 * u, 2 * u);
    const ws = ctx.createLinearGradient(-42 * u, 0, 42 * u, 0);
    ws.addColorStop(0, 'rgba(255,255,255,.4)'); ws.addColorStop(0.25, 'rgba(255,255,255,0)'); ws.addColorStop(1, 'rgba(0,0,30,.35)');
    ctx.fillStyle = ws; rrect(ctx, -42 * u, -79 * u, 84 * u, 6 * u, 2 * u); rrect(ctx, -42 * u, -70 * u, 84 * u, 8 * u, 2 * u);
    ctx.fillStyle = '#e53935'; ctx.fillRect(-45 * u, -84 * u, 4 * u, 28 * u); ctx.fillRect(41 * u, -84 * u, 4 * u, 28 * u);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(6, Math.round(6.5 * u))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TAKUDEN EV', 0, -65.6 * u);
    // レインライト（ブレーキで明るく光る）
    ctx.fillStyle = braking ? '#ff1744' : '#5a1010';
    if (braking) { ctx.shadowColor = '#ff1744'; ctx.shadowBlur = 18 * u; }
    ctx.fillRect(-5 * u, -9 * u, 10 * u, 5 * u);
    ctx.shadowBlur = 0;
    if (braking) {   // ブレーキランプのにじみ（路面にも赤い光が映る）
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const bl = ctx.createRadialGradient(0, -6.5 * u, 0, 0, -6.5 * u, 34 * u);
      bl.addColorStop(0, 'rgba(255,60,60,.75)'); bl.addColorStop(0.35, 'rgba(255,30,40,.28)'); bl.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = bl; ctx.beginPath(); ctx.arc(0, -6.5 * u, 34 * u, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.rotate(-this.steer * 0.035);
    this.drawParticles(ctx, u * 100, true);   // はね飛ぶコーン・火花（車より手前）
    ctx.restore();
  }

  drawParticles(ctx, cw, front) {
    for (const p of this.particles) {
      const isFront = p.kind === 'cone' || p.kind === 'spark';
      if (isFront !== front) continue;
      const a = clamp(p.life / p.max, 0, 1), px = p.x * cw, py = p.y * cw;
      if (p.kind === 'cone') {
        const img = SPR.cone, s = p.s * cw * (0.6 + 0.4 * a), h = s * img.height / img.width;
        ctx.save(); ctx.globalAlpha = Math.min(1, a * 2); ctx.translate(px, py); ctx.rotate(p.r); ctx.drawImage(img, -s / 2, -h / 2, s, h); ctx.restore();
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = `rgba(255,${180 + Math.random() * 60 | 0},80,${a})`; ctx.lineWidth = Math.max(1, cw * 0.01);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - p.vx * cw * 0.04, py - p.vy * cw * 0.04); ctx.stroke();
      } else {
        ctx.fillStyle = p.kind === 'dust' ? `rgba(196,172,128,${a * 0.55})` : `rgba(78,150,52,${a * 0.7})`;
        ctx.beginPath(); ctx.arc(px, py, p.s * cw, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // コースマップ（左上。白い線がコース、黄色が走った所、赤い点が自分）。コースの線は一度だけ画像に描いておく
  drawMap(ctx, W, H) {
    const pts = this.mapPts; if (pts.length < 2) return;
    const size = Math.round(Math.min(H * 0.26, W * 0.17)), pad = size * 0.1;
    const ox = Math.max(16, W * 0.015), oy = Math.min(H * 0.22, 190);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = (size - pad * 2) / Math.max(x1 - x0, y1 - y0);
    const mx = (x) => pad + (x - x0) * k + (size - pad * 2 - (x1 - x0) * k) / 2;
    const my = (y) => pad + (y - y0) * k + (size - pad * 2 - (y1 - y0) * k) / 2;
    const lw = Math.max(2.5, size * 0.03);
    const line = (g, n) => { g.beginPath(); for (let i = 0; i <= n; i++) (i ? g.lineTo(mx(pts[i][0]), my(pts[i][1])) : g.moveTo(mx(pts[i][0]), my(pts[i][1]))); };
    if (!this._map || this._map.width !== size || this._map.pts !== pts) {
      this._map = canvas(size, size, (g) => {
        g.fillStyle = 'rgba(10,16,26,.5)'; g.beginPath(); g.roundRect(0, 0, size, size, 12); g.fill();
        g.lineJoin = 'round'; g.lineCap = 'round';
        line(g, pts.length - 1); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = lw * 2; g.stroke();
        g.strokeStyle = '#e8edf2'; g.lineWidth = lw; g.stroke();
        const [gx, gy] = pts[pts.length - 1], c = Math.max(2, size * 0.022);   // ゴール（チェッカー）
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(mx(gx) - 2 * c + i * c, my(gy) - 1.5 * c + j * c, c, c); }
        g.fillStyle = '#7ee787'; g.beginPath(); g.arc(mx(pts[0][0]), my(pts[0][1]), Math.max(3, size * 0.03), 0, Math.PI * 2); g.fill();
      });
      this._map.pts = pts;
    }
    ctx.save();
    ctx.drawImage(this._map, ox, oy);
    ctx.translate(ox, oy); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const fp = this.progress * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(fp)), t = fp - i0;
    line(ctx, i0); ctx.strokeStyle = '#ffcf3f'; ctx.lineWidth = lw; ctx.stroke();
    const px = mx(lerp(pts[i0][0], pts[i0 + 1][0], t)), py = my(lerp(pts[i0][1], pts[i0 + 1][1], t));
    ctx.fillStyle = '#ff3b30'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, Math.max(4, size * 0.045), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

function poly(ctx, color, x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
function tri(ctx, x1, y1, x2, y2, x3, y3) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill(); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }

// ---------- 景色の画像（起動時に一度だけ描く） ----------
// どれも「下の中央」が地面に接する位置。幅は Race 側の sp.w（道路の半幅=1）で決まり、高さは画像の縦横比で決まる
const SPR = { ready: false };
function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function shadow(g, w, h, rx = 0.42) { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(w / 2, h - 6, w * rx, 6, 0, 0, Math.PI * 2); g.fill(); }
function blob(g, x, y, r, c1, c2) { const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function sign(g, x, y, w, h, bg, fg, text, font) {
  g.fillStyle = bg; g.fillRect(x, y, w, h); g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x + w / 2, y + h / 2 + 2);
}

function makeSprites() {
  const R = mulberry32(99);
  // 針葉樹
  SPR.pine = canvas(200, 360, (g, w, h) => {
    shadow(g, w, h, 0.3);
    g.fillStyle = '#5b3a1e'; g.fillRect(w / 2 - 9, h - 70, 18, 66);
    for (let i = 0; i < 5; i++) {
      const top = 10 + i * 52, bw = 50 + i * 20, yb = top + 110;
      const gr = g.createLinearGradient(w / 2 - bw, 0, w / 2 + bw, 0);
      gr.addColorStop(0, '#3f8f45'); gr.addColorStop(0.5, '#2d7034'); gr.addColorStop(1, '#1d4f24');
      g.fillStyle = gr; tri(g, w / 2, top, w / 2 - bw, yb, w / 2 + bw, yb);
    }
  });
  // 広葉樹（丸い木）
  SPR.round = canvas(260, 300, (g, w, h) => {
    shadow(g, w, h, 0.36);
    g.fillStyle = '#6b4526'; g.beginPath(); g.moveTo(w / 2 - 12, h - 4); g.lineTo(w / 2 - 7, h - 130); g.lineTo(w / 2 + 7, h - 130); g.lineTo(w / 2 + 12, h - 4); g.fill();
    const parts = [[0.5, 0.36, 0.3], [0.3, 0.46, 0.22], [0.7, 0.46, 0.22], [0.42, 0.22, 0.2], [0.62, 0.24, 0.19], [0.5, 0.52, 0.22]];
    for (const [px, py, r] of parts) blob(g, px * w, py * h, r * w, '#79c25a', '#2f6d2b');
  });
  // ポプラ（細長い木）
  SPR.poplar = canvas(120, 360, (g, w, h) => {
    shadow(g, w, h, 0.3);
    g.fillStyle = '#5b3a1e'; g.fillRect(w / 2 - 6, h - 60, 12, 56);
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#6db552'); gr.addColorStop(1, '#2b5f27');
    g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.43, w * 0.42, h * 0.42, 0, 0, Math.PI * 2); g.fill();
  });
  SPR.bush = canvas(220, 110, (g, w, h) => {
    shadow(g, w, h, 0.45);
    [[0.3, 0.6, 0.26], [0.55, 0.5, 0.3], [0.78, 0.62, 0.22]].forEach(([x, y, r]) => blob(g, x * w, y * h, r * w * 0.6, '#6aae4e', '#2d5f28'));
  });
  // パイロン（コーン）
  SPR.cone = canvas(80, 100, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(w / 2 + 6, h - 6, w * 0.48, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c94b00'; g.fillRect(4, h - 14, w - 8, 9);
    const gr = g.createLinearGradient(w * 0.2, 0, w * 0.8, 0); gr.addColorStop(0, '#ff9a3c'); gr.addColorStop(0.45, '#ff6d00'); gr.addColorStop(1, '#c84f00');
    g.fillStyle = gr; g.beginPath(); g.moveTo(w / 2 - 5, 4); g.lineTo(w / 2 + 5, 4); g.lineTo(w * 0.86, h - 14); g.lineTo(w * 0.14, h - 14); g.closePath(); g.fill();
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.moveTo(w * 0.36, h * 0.36); g.lineTo(w * 0.64, h * 0.36); g.lineTo(w * 0.7, h * 0.52); g.lineTo(w * 0.3, h * 0.52); g.closePath(); g.fill();
  });
  // グランドスタンド（屋根つき・観客）
  SPR.stand = canvas(512, 300, (g, w, h) => {
    g.fillStyle = '#8b939c'; g.fillRect(10, 40, w - 20, h - 40);
    g.fillStyle = '#d9dde2'; g.beginPath(); g.moveTo(0, 46); g.lineTo(w, 46); g.lineTo(w - 20, 18); g.lineTo(20, 18); g.closePath(); g.fill();
    g.fillStyle = '#c62828'; g.fillRect(0, 44, w, 8);
    for (let x = 30; x < w; x += 90) { g.fillStyle = '#5d646c'; g.fillRect(x, 52, 6, h - 52); }
    const cols = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fff', '#8e24aa', '#fb8c00', '#212121', '#90caf9'];
    for (let r = 0; r < 9; r++) {
      const y = 70 + r * 24; g.fillStyle = '#6e767f'; g.fillRect(14, y + 14, w - 28, 6);
      for (let x = 20; x < w - 20; x += 11 + R() * 4) {
        if (R() < 0.12) continue;
        g.fillStyle = cols[Math.floor(R() * cols.length)]; g.fillRect(x, y + 4, 9, 11);
        g.fillStyle = ['#f1c9a5', '#d9a77c', '#8d5a3b', '#3b2a20'][Math.floor(R() * 4)]; g.beginPath(); g.arc(x + 4.5, y + 1, 4, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = '#3f464e'; g.fillRect(10, h - 26, w - 20, 26);
    g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText('GRANDSTAND', w / 2, h - 9);
  });
  // ピットの建物
  SPR.pit = canvas(640, 220, (g, w, h) => {
    g.fillStyle = '#eceff1'; g.fillRect(0, 30, w, h - 30);
    g.fillStyle = '#1565c0'; g.fillRect(0, 30, w, 34);
    g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PIT  ・  TAKUDEN FORMULA', w / 2, 48);
    g.fillStyle = '#90a4ae'; g.fillRect(0, 0, w, 30);
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 104; g.fillStyle = '#37474f'; g.fillRect(x, 82, 92, h - 82);
      g.fillStyle = '#546e7a'; for (let y = 86; y < h; y += 10) g.fillRect(x, y, 92, 2);
      g.fillStyle = '#ffcf3f'; g.fillRect(x, 76, 92, 5);
    }
  });
  // 広告看板
  const ad = (bg, fg, text, size, sub) => canvas(480, 150, (g, w, h) => {
    shadow(g, w, h, 0.48);
    g.fillStyle = '#555'; g.fillRect(40, 90, 10, h - 90); g.fillRect(w - 50, 90, 10, h - 90);
    g.fillStyle = '#222'; g.fillRect(4, 6, w - 8, 98);
    const gr = g.createLinearGradient(0, 10, 0, 100); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
    g.fillStyle = gr; g.fillRect(10, 12, w - 20, 86);
    g.fillStyle = fg; g.font = `900 ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, sub ? 46 : 57);
    if (sub) { g.font = 'bold 20px sans-serif'; g.fillText(sub, w / 2, 82); }
  });
  SPR.adTakuden = ad(['#1976d2', '#0d47a1'], '#fff', 'TAKUDEN FORMULA', 46);
  SPR.adEV = ad(['#ffd54f', '#ffb300'], '#1a1a1a', '⚡ EV POWER', 54);
  SPR.adUniv = ad(['#ffffff', '#e0e0e0'], '#0d47a1', '拓殖大学', 52, '電気自動車同好会');
  SPR.adZero = ad(['#2e7d32', '#1b5e20'], '#fff', 'ZERO EMISSION', 50);
  // カーブの矢印（紅白の山形）
  const chev = (dir) => canvas(160, 150, (g, w, h) => {
    g.fillStyle = '#555'; g.fillRect(w / 2 - 5, 80, 10, h - 80);
    g.fillStyle = '#fff'; g.fillRect(4, 8, w - 8, 80); g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(4, 8, w - 8, 80);
    g.fillStyle = '#d32f2f';
    for (let i = 0; i < 2; i++) {
      const x = 40 + i * 50; g.beginPath();
      if (dir > 0) { g.moveTo(x - 14, 18); g.lineTo(x + 6, 18); g.lineTo(x + 30, 48); g.lineTo(x + 6, 78); g.lineTo(x - 14, 78); g.lineTo(x + 10, 48); }
      else { g.moveTo(x + 30, 18); g.lineTo(x + 10, 18); g.lineTo(x - 14, 48); g.lineTo(x + 10, 78); g.lineTo(x + 30, 78); g.lineTo(x + 6, 48); }
      g.closePath(); g.fill();
    }
  });
  SPR.chevR = chev(1); SPR.chevL = chev(-1);
  // ブレーキの目安の距離看板
  const dist = (t, bars) => canvas(100, 180, (g, w, h) => {
    g.fillStyle = '#555'; g.fillRect(w / 2 - 4, 100, 8, h - 100);
    g.fillStyle = '#fff'; g.fillRect(6, 6, w - 12, 100); g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, 100);
    g.fillStyle = '#111'; for (let i = 0; i < bars; i++) g.fillRect(16, 16 + i * 14, w - 32, 8);
    g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, 86);
  });
  SPR.d150 = dist('150', 3); SPR.d100 = dist('100', 2); SPR.d50 = dist('50', 1);
  // マーシャルポスト（小屋と旗を振る係員）
  SPR.marshal = canvas(200, 170, (g, w, h) => {
    shadow(g, w, h, 0.4);
    g.fillStyle = '#eceff1'; g.fillRect(20, 60, 90, h - 66); g.fillStyle = '#f57c00'; g.fillRect(14, 50, 102, 14);
    g.fillStyle = '#37474f'; g.fillRect(36, 80, 56, 30);
    g.fillStyle = '#ff6d00'; g.fillRect(140, 96, 22, 42); g.fillStyle = '#f1c9a5'; g.beginPath(); g.arc(151, 86, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#263238'; g.fillRect(141, 138, 8, h - 144); g.fillRect(154, 138, 8, h - 144);
    g.strokeStyle = '#333'; g.lineWidth = 3; g.beginPath(); g.moveTo(160, 100); g.lineTo(178, 40); g.stroke();
    g.fillStyle = '#2e7d32'; g.fillRect(178, 40, 20, 16);
  });
  // 観客（フェンスの向こう）
  SPR.crowd = canvas(420, 120, (g, w, h) => {
    const cols = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fff', '#8e24aa', '#fb8c00', '#212121'];
    for (let x = 6; x < w - 6; x += 12 + R() * 6) {
      const y = 40 + R() * 16;
      g.fillStyle = cols[Math.floor(R() * cols.length)]; g.fillRect(x, y, 12, 50);
      g.fillStyle = ['#f1c9a5', '#d9a77c', '#8d5a3b'][Math.floor(R() * 3)]; g.beginPath(); g.arc(x + 6, y - 6, 7, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(70,70,70,.85)'; g.lineWidth = 1.5;
    for (let x = 0; x < w; x += 10) { g.beginPath(); g.moveTo(x, 20); g.lineTo(x + 30, h); g.moveTo(x + 30, 20); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = '#555'; for (let x = 0; x < w; x += 70) g.fillRect(x, 14, 5, h - 14);
  });
  // 照明塔
  SPR.light = canvas(60, 420, (g, w, h) => {
    g.fillStyle = '#78838c'; g.fillRect(w / 2 - 3, 30, 6, h - 30);
    g.fillStyle = '#4c5359'; g.fillRect(4, 6, w - 8, 30);
    g.fillStyle = '#fffde7'; for (let i = 0; i < 3; i++) g.fillRect(8 + i * 16, 10, 12, 10);
  });
  // スタートのゲート（シグナル付き）とゴールのゲート
  const gantry = (label, lights) => canvas(800, 420, (g, w, h) => {
    g.fillStyle = '#3a3f46'; g.fillRect(0, 60, 26, h - 60); g.fillRect(w - 26, 60, 26, h - 60);
    g.fillStyle = '#26292e'; g.fillRect(0, 50, w, 90);
    if (lights) {
      for (let i = 0; i < 5; i++) { g.fillStyle = '#111'; g.fillRect(250 + i * 64, 140, 48, 90); g.fillStyle = '#4a0d0d'; [0, 1].forEach((k) => { g.beginPath(); g.arc(274 + i * 64, 165 + k * 40, 15, 0, Math.PI * 2); g.fill(); }); }
      sign(g, 30, 60, w - 60, 70, '#1565c0', '#fff', label, '900 52px sans-serif');
    } else {
      for (let i = 0; i < 24; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(26 + i * 31.2, 54 + j * 18, 32, 19); }
      sign(g, 26, 92, w - 52, 48, '#d32f2f', '#fff', label, '900 40px sans-serif');
    }
  });
  SPR.start = gantry('TAKUDEN  GRAND  PRIX', true);
  SPR.gate = gantry('FINISH', false);
  SPR.sun = canvas(256, 256, (g, w) => {
    const sg = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    sg.addColorStop(0, 'rgba(255,255,240,1)'); sg.addColorStop(0.08, 'rgba(255,250,220,.95)'); sg.addColorStop(0.2, 'rgba(255,245,210,.35)'); sg.addColorStop(1, 'rgba(255,245,210,0)');
    g.fillStyle = sg; g.fillRect(0, 0, w, w);
  });
  // 雲
  SPR.clouds = [0, 1, 2].map((k) => canvas(400, 160, (g, w, h) => {
    for (let i = 0; i < 9; i++) {
      const x = w * (0.18 + R() * 0.64), y = h * (0.45 + R() * 0.25), r = h * (0.18 + R() * 0.2);
      const gr = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.7, 'rgba(244,248,252,.7)'); gr.addColorStop(1, 'rgba(230,238,246,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }));
  makeCitySprites(R); makeHighwaySprites(R);
  SPR.ready = true;
}

// ---------- 市街地の絵 ----------
function makeCitySprites(R) {
  // ビル（窓・1階のお店・屋上）
  const SHOPS = [['ラーメン', '#c62828'], ['カフェ', '#6d4c41'], ['書店', '#1565c0'], ['薬局', '#2e7d32'], ['TAKUDEN', '#0d47a1'], ['パン', '#ef6c00'], ['電気', '#455a64']];
  const bld = (wPx, hPx, wall, glass, kind) => canvas(wPx, hPx, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(6, h - 8, w - 6, 8);
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, wall[0]); gr.addColorStop(1, wall[1]);
    g.fillStyle = gr; g.fillRect(0, 0, w, h - 4);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, w, 10);                 // 屋上のふち
    const shopH = 90, cols = Math.floor(w / 46), rows = Math.floor((h - shopH - 30) / (kind === 'glass' ? 30 : 44));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = 12 + c * (w - 24) / cols, y = 24 + r * (kind === 'glass' ? 30 : 44);
      g.fillStyle = R() < 0.15 ? '#fff6c8' : glass; g.fillRect(x, y, (w - 24) / cols - 10, kind === 'glass' ? 24 : 30);
      if (kind !== 'glass') { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, y, (w - 24) / cols - 10, 4); }
    }
    // 1階のお店（ひさしと看板）
    const [name, col] = SHOPS[Math.floor(R() * SHOPS.length)];
    g.fillStyle = '#2b2b2b'; g.fillRect(8, h - shopH, w - 16, shopH - 4);
    g.fillStyle = '#9fc6d8'; g.fillRect(18, h - shopH + 30, w - 36, shopH - 40);
    g.fillStyle = col; g.fillRect(4, h - shopH - 6, w - 8, 34);
    g.fillStyle = '#fff'; g.font = 'bold 24px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, h - shopH + 12);
    for (let x = 4; x < w - 4; x += 24) { g.fillStyle = x / 24 % 2 ? col : '#f5f5f5'; g.fillRect(x, h - shopH + 28, 24, 10); }
  });
  SPR.bld1 = bld(300, 760, ['#c9c3b8', '#a59e92'], '#58707f', 'office');
  SPR.bld2 = bld(340, 900, ['#7d93a8', '#5b7086'], '#2f4a63', 'glass');
  SPR.bld3 = bld(280, 560, ['#d9b38c', '#b38d68'], '#4e5d66', 'office');
  SPR.bld4 = bld(320, 680, ['#e0e0e0', '#bdbdbd'], '#607d8b', 'office');
  SPR.bld5 = bld(300, 980, ['#8aa0b0', '#60798c'], '#3b5a72', 'glass');
  SPR.bld6 = bld(260, 480, ['#b07a5a', '#8e5c40'], '#4a4a4a', 'office');
  // 街灯（腕が道路の方へのびる）
  const lamp = (dir) => canvas(160, 420, (g, w, h) => {
    const px = dir > 0 ? 20 : w - 20;
    g.fillStyle = '#5f676e'; g.fillRect(px - 4, 40, 8, h - 40);
    g.strokeStyle = '#5f676e'; g.lineWidth = 7; g.beginPath(); g.moveTo(px, 44); g.quadraticCurveTo(px, 14, px + dir * 60, 14); g.lineTo(px + dir * 120, 18); g.stroke();
    g.fillStyle = '#3d4247'; g.fillRect(px + dir * 120 - 22, 14, 44, 12); g.fillStyle = '#fff8d0'; g.fillRect(px + dir * 120 - 18, 26, 36, 5);
  });
  SPR.lampL = lamp(1); SPR.lampR = lamp(-1);
  // 信号機（腕の先に横向きの信号）
  const sig = (dir) => canvas(220, 360, (g, w, h) => {
    const px = dir > 0 ? 18 : w - 18;
    g.fillStyle = '#6b7278'; g.fillRect(px - 5, 30, 10, h - 30); g.fillRect(Math.min(px, px + dir * 150), 36, 150, 8);
    const bx = px + dir * 150 - (dir > 0 ? 0 : 110);
    g.fillStyle = '#2c3135'; g.fillRect(bx - (dir > 0 ? 110 : 0), 22, 110, 38);
    ['#2fbf71', '#ffd54f', '#e53935'].forEach((c, i) => { g.fillStyle = i === 0 ? c : '#4a4f53'; g.beginPath(); g.arc(bx - (dir > 0 ? 110 : 0) + 20 + i * 35, 41, 13, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = '#1565c0'; g.fillRect(px - 40, 110, 80, 30); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('拓電町', px, 126);
  });
  SPR.sigL = sig(1); SPR.sigR = sig(-1);
  // 歩道橋（道路をまたぐ）
  SPR.bridge = canvas(900, 420, (g, w, h) => {
    g.fillStyle = '#3f6e8c'; g.fillRect(0, 120, 28, h - 120); g.fillRect(w - 28, 120, 28, h - 120);
    g.fillStyle = '#5b8fb0'; g.fillRect(0, 100, w, 46); g.fillStyle = '#e8eef2'; g.fillRect(0, 70, w, 30);
    g.fillStyle = '#3f6e8c'; for (let x = 10; x < w; x += 26) g.fillRect(x, 70, 6, 30);
    sign(g, w / 2 - 210, 100, 420, 46, '#0d47a1', '#fff', 'TAKUDEN CITY GP', '900 30px sans-serif');
  });
  // 遠くのビル群（横につなげて並べる）
  const skyline = (wPx, hPx, c1, c2, lit) => canvas(wPx, hPx, (g, w, h) => {
    let x = 0;
    while (x < w) {
      const bw = 40 + R() * 90, bh = h * (0.3 + R() * 0.7); g.fillStyle = R() < 0.5 ? c1 : c2; g.fillRect(x, h - bh, Math.min(bw, w - x), bh);
      if (lit) { g.fillStyle = 'rgba(255,255,255,.18)'; for (let y = h - bh + 8; y < h - 6; y += 12) for (let xx = x + 6; xx < x + bw - 8 && xx < w - 4; xx += 12) if (R() < 0.6) g.fillRect(xx, y, 6, 6); }
      if (R() < 0.2) { g.fillStyle = c2; g.fillRect(x + bw / 2 - 2, h - bh - 30, 4, 30); }
      x += bw + 2;
    }
  });
  SPR.skyFar = skyline(2048, 300, '#a9b8c6', '#9aabbb', false);
  SPR.skyNear = skyline(2048, 260, '#7c8d9c', '#6d7f8f', true);
}

// ---------- 高速道路の絵 ----------
function makeHighwaySprites(R) {
  // 料金所（スタート）
  SPR.toll = canvas(900, 440, (g, w, h) => {
    g.fillStyle = '#e8e8e4'; g.fillRect(0, 40, w, 110); g.fillStyle = '#2e7d32'; g.fillRect(0, 150, w, 14);
    g.fillStyle = '#1b5e20'; g.font = '900 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('拓電 料金所', w / 2 - 120, 95);
    g.fillStyle = '#7b1fa2'; g.fillRect(w - 250, 62, 170, 66); g.fillStyle = '#fff'; g.font = '900 44px sans-serif'; g.fillText('ETC', w - 165, 96);
    for (const x of [0, w - 40]) { g.fillStyle = '#cfd2cf'; g.fillRect(x, 164, 40, h - 164); g.fillStyle = '#ffd54f'; for (let y = 180; y < h; y += 40) g.fillRect(x, y, 40, 16); }
  });
  // 案内標識（緑の板が道路の上にかかる）
  const hwSign = (lines) => canvas(900, 460, (g, w, h) => {
    g.fillStyle = '#7d868c'; g.fillRect(20, 40, 22, h - 40); g.fillRect(w - 42, 40, 22, h - 40); g.fillRect(20, 60, w - 40, 14);
    g.fillStyle = '#1b7a3a'; g.fillRect(150, 20, w - 300, 200); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(158, 28, w - 316, 184);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 60px sans-serif'; g.fillText(lines[0], w / 2, 84); g.font = 'bold 34px sans-serif'; g.fillText(lines[1], w / 2, 150);
    g.font = 'bold 30px sans-serif'; g.fillText(lines[2], w / 2, 192);
  });
  SPR.hwSign1 = hwSign(['拓電 IC', 'TAKUDEN', '出口 2 km']);
  SPR.hwSign2 = hwSign(['ゴール', 'GOAL', '1 km']);
  // 照明（腕が道路の方へ）
  const lamp = (dir) => canvas(200, 480, (g, w, h) => {
    const px = dir > 0 ? 14 : w - 14;
    g.fillStyle = '#8a9298'; g.fillRect(px - 5, 20, 10, h - 20);
    g.strokeStyle = '#8a9298'; g.lineWidth = 8; g.beginPath(); g.moveTo(px, 24); g.lineTo(px + dir * 170, 30); g.stroke();
    g.fillStyle = '#4c5359'; g.fillRect(px + dir * 170 - 26, 24, 52, 14); g.fillStyle = '#ffe9a8'; g.fillRect(px + dir * 170 - 22, 38, 44, 5);
  });
  SPR.hwLampL = lamp(1); SPR.hwLampR = lamp(-1);
  // キロポスト
  SPR.kmPost = canvas(60, 160, (g, w, h) => {
    g.fillStyle = '#888'; g.fillRect(w / 2 - 3, 60, 6, h - 60);
    g.fillStyle = '#fff'; g.fillRect(4, 6, w - 8, 56); g.strokeStyle = '#1b7a3a'; g.lineWidth = 4; g.strokeRect(4, 6, w - 8, 56);
    g.fillStyle = '#1b7a3a'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(1 + Math.floor(R() * 9)), w / 2, 34);
  });
  // 工事の矢印板
  SPR.arrow = canvas(200, 220, (g, w, h) => {
    g.fillStyle = '#444'; g.fillRect(w / 2 - 6, 130, 12, h - 130);
    g.fillStyle = '#111'; g.fillRect(6, 6, w - 12, 130);
    g.fillStyle = '#ffb300'; g.beginPath(); g.moveTo(40, 50); g.lineTo(120, 50); g.lineTo(120, 25); g.lineTo(170, 71); g.lineTo(120, 117); g.lineTo(120, 92); g.lineTo(40, 92); g.closePath(); g.fill();
    for (let x = 6; x < w - 6; x += 30) { g.fillStyle = (x / 30) % 2 ? '#e53935' : '#fff'; g.fillRect(x, 136, 30, 14); }
  });
  // 前を走る車（後ろから見た図）
  const car = (body, dark) => canvas(220, 170, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(w / 2, h - 6, w * 0.48, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#151515'; g.fillRect(16, h - 40, 34, 34); g.fillRect(w - 50, h - 40, 34, 34);
    const gr = g.createLinearGradient(0, 30, 0, h - 20); gr.addColorStop(0, body); gr.addColorStop(1, dark);
    g.fillStyle = gr; g.beginPath(); g.moveTo(40, 20); g.lineTo(w - 40, 20); g.lineTo(w - 8, 80); g.lineTo(w - 8, h - 26); g.lineTo(8, h - 26); g.lineTo(8, 80); g.closePath(); g.fill();
    g.fillStyle = '#26323a'; g.beginPath(); g.moveTo(48, 28); g.lineTo(w - 48, 28); g.lineTo(w - 26, 74); g.lineTo(26, 74); g.closePath(); g.fill();
    g.fillStyle = '#e53935'; g.fillRect(14, 92, 40, 16); g.fillRect(w - 54, 92, 40, 16);
    g.fillStyle = '#fff'; g.fillRect(w / 2 - 30, 108, 60, 26); g.fillStyle = '#1b5e20'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('拓電 5', w / 2, 121);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(8, h - 30, w - 16, 6);
  });
  SPR.carWhite = car('#f4f4f2', '#bfc2c4'); SPR.carRed = car('#d32f2f', '#8e1b1b'); SPR.carBlack = car('#3a3d42', '#16181b'); SPR.carBlue = car('#1e66c8', '#123f80');
  SPR.truck = canvas(260, 300, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(w / 2, h - 6, w * 0.48, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#151515'; g.fillRect(14, h - 40, 44, 34); g.fillRect(w - 58, h - 40, 44, 34);
    g.fillStyle = '#e9ecef'; g.fillRect(6, 6, w - 12, h - 70); g.strokeStyle = '#b0b6bb'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 70);
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 64); g.stroke();
    g.fillStyle = '#1565c0'; g.font = '900 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('拓電運輸', w / 2, 90);
    g.fillStyle = '#333'; g.fillRect(6, h - 64, w - 12, 26);
    g.fillStyle = '#e53935'; g.fillRect(10, h - 60, 30, 16); g.fillRect(w - 40, h - 60, 30, 16);
    g.fillStyle = '#fff'; g.fillRect(w / 2 - 30, h - 62, 60, 22);
  });
}
