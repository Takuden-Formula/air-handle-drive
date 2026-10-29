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

export const MAX_SPEED = SEG * 60;    // 1秒に60セグメント
const ACCEL = MAX_SPEED / 4;
const DECEL = -MAX_SPEED / 4;
const OFFROAD_DECEL = -MAX_SPEED / 1.5;
const OFFROAD_LIMIT = MAX_SPEED / 4;
const CENTRIFUGAL = 0.12;   // カーブで外側に流される強さ
export const CAR_HALF = 0.15; // 自車の半幅（道路の半幅=1 とした単位）

const BARRIER = 2.55;       // ガードレール・タイヤバリアの位置（道路の半幅=1）。自車はこの手前で止まる
const BARRIER_H = 260;      // ガードレールの高さ（ワールド単位。車幅 ≒ 450）
const KERB_CURVE = 1.2;     // これよりきついカーブに縁石と砂利（グラベル）を置く
const TREE_SCALE = { pine: 0.8, round: 1, poplar: 0.6, bush: 1 };  // 木の画像ごとの大きさの補正

const C = {
  sky1: [46, 120, 204], sky2: [150, 196, 232], fog: [205, 222, 232],
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

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Race {
  constructor() {
    this.segments = []; this.skyOffset = 0; this.cx = 0.5;  // cx: 画面上の道路・車の中心（横位置の割合）
    this.showMap = true; this.particles = []; this.mapPts = [];
    this.quality = 1;   // 0 = 軽量（雲・遠くの林を省く。遅い PC 用）
    this.reset();
  }

  // ---------- コース生成 ----------
  build({ length = 'normal', cones = true, seed = 7 } = {}) {
    this.segments = [];
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
    this.trackLength = this.segments.length * SEG;
    this.finishZ = this.finishSeg * SEG;
    this.reset();
  }

  // サーキットらしい景色: 縁石・グラベル・ガードレール・スタンド・ピット・看板・カーブの矢印・距離看板・コースマップ
  decorate(seed) {
    const segs = this.segments, N = segs.length, rnd = mulberry32(seed * 7919 + 13);
    const add = (n, sp) => { if (segs[n]) segs[n].sprites.push(sp); };
    // カーブの区間（向きと強さ）を調べる
    const corners = [];
    for (let n = 0; n < N; n++) {
      const c = segs[n].curve, on = Math.abs(c) > KERB_CURVE;
      segs[n].kerb = on;
      segs[n].stripe = Math.floor(n / 6) % 2;         // 芝刈りのしま模様
      segs[n].shade = segs[n].light ? 0.015 : -0.015;  // 舗装のむら（3セグメントごとに少し明暗。速さが分かりやすい）
      if (on && (!corners.length || corners[corners.length - 1].end < n - 1)) corners.push({ start: n, end: n, dir: Math.sign(c), peak: 0 });
      if (on) { const k = corners[corners.length - 1]; k.end = n; k.peak = Math.max(k.peak, Math.abs(c)); }
    }
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
    // 奥の物から描くよう、セグメント内では外側の物を先に並べる
    segs.forEach((s) => s.sprites.sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset)));

    // コースマップ（カーブ量を積分して平面図にする。ゴールまで）
    let x = 0, y = 0, h = -Math.PI / 2; this.mapPts = [];
    for (let n = 0; n <= this.finishSeg && n < N; n++) { h += segs[n].curve * 0.0062; x += Math.cos(h); y += Math.sin(h); if (n % 3 === 0 || n === this.finishSeg) this.mapPts.push([x, y]); }
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
    this.surface = 'road'; this.particles = [];
    this.segments.forEach((s) => s.sprites.forEach((sp) => { sp.hit = false; }));
  }

  // 0〜1 のコース進捗
  get progress() { return clamp((this.position + PLAYER_Z) / this.finishZ, 0, 1); }
  // 理論上の最速タイム（だいたいの目安）
  idealTime(topFactor) { const v = MAX_SPEED * topFactor; return this.finishZ / v + v / ACCEL / 2; }

  // ---------- 物理 ----------
  // steer: -1(左)〜1(右), throttle: 0〜1, opts: { topFactor, assist(0〜1) }
  update(dt, steer, throttle, opts) {
    if (!this.segments.length) return;
    const top = MAX_SPEED * opts.topFactor;
    const seg = this.findSegment(this.position + PLAYER_Z);
    const pct = this.speed / MAX_SPEED;
    const dx = dt * 2 * pct;
    this.steer = steer;

    this.position = Math.min(this.position + this.speed * dt, this.trackLength - (DRAW + 5) * SEG);
    this.playerX += dx * steer;
    this.playerX -= dx * pct * seg.curve * CENTRIFUGAL * (1 - opts.assist * 0.7);
    if (opts.assist > 0 && Math.abs(this.playerX) > 0.6) this.playerX -= Math.sign(this.playerX) * opts.assist * dt * 0.8; // 道路に戻すアシスト
    this.skyOffset += seg.curve * pct * dt * 0.02;

    if (throttle > 0) this.speed += ACCEL * throttle * dt; else this.speed += DECEL * dt;
    this.offroad = Math.abs(this.playerX) > 1;
    this.surface = !this.offroad ? 'road' : (seg.gravel && Math.sign(this.playerX) === seg.gravel ? 'gravel' : 'grass');
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
    // ガードレールにぶつかる
    if (Math.abs(this.playerX) > BARRIER - CAR_HALF - 0.05) {
      const side = Math.sign(this.playerX);
      if (this.speed > MAX_SPEED / 8) {
        this.speed = MAX_SPEED / 8; this.crashes++; this.events.push('crash'); this.shake = 0.5; this.spawnSparks(side);
      }
      this.playerX = side * (BARRIER - CAR_HALF - 0.2);
    }
    this.speed = clamp(this.speed, 0, top);
    this.shake = Math.max(0, this.shake - dt);
    if (!this.finished && this.position + PLAYER_Z >= this.finishZ) { this.finished = true; this.events.push('finish'); }
  }

  // 自動運転（待機画面のデモ・テスト用）: コーンをよけながら道路の中央付近を走る
  autopilot() {
    const seg = this.findSegment(this.position + PLAYER_Z);
    let target = 0;
    for (let n = 2; n < 40; n++) {
      const s = this.segments[seg.index + n]; if (!s) break;
      const cones = s.sprites.filter((sp) => sp.type === 'cone' && !sp.hit);
      if (!cones.length) continue;
      const lanes = [-0.66, 0, 0.66].filter((x) => cones.every((c) => Math.abs(c.offset - x) > 0.4));
      target = lanes.length ? lanes.reduce((a, b) => (Math.abs(b - this.playerX) < Math.abs(a - this.playerX) ? b : a)) : 0;
      break;
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
    if (this.offroad && pct > 0.08) {
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
    for (let i = vis.length - 1; i >= 0; i--) {
      const s = vis[i];
      if (s.drawn) this.drawSegment(ctx, W, H, s);
      for (const sp of s.sprites) if (Math.abs(sp.offset) > BARRIER) this.drawSprite(ctx, s, sp);
      if (s.drawn) this.drawBarrier(ctx, H, s);
      for (const sp of s.sprites) if (Math.abs(sp.offset) <= BARRIER) this.drawSprite(ctx, s, sp);
    }
    this.drawCar(ctx, W, H, now);
    ctx.restore();
    if (this.showMap) this.drawMap(ctx, W, H);
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
    // 雲（ゆっくり流れ、カーブで横に動く）
    const drift = now / 1000 * 0.004;
    for (let i = 0; i < (this.quality ? 7 : 0); i++) {
      const img = SPR.clouds[i % SPR.clouds.length], k = 0.3 + (i % 3) * 0.15;
      const cw = W * (0.22 + (i % 3) * 0.08), ch = cw * img.height / img.width;
      const px = ((i * 0.37 + drift * (1 + i % 2) - this.skyOffset * k) % 1.4 + 1.4) % 1.4 * W * 1.0 - cw * 0.5 - W * 0.1;
      ctx.globalAlpha = 0.85; ctx.drawImage(img, px, hy * (0.1 + (i * 0.13) % 0.45), cw, ch);
    }
    ctx.globalAlpha = 1;
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
    ctx.fillStyle = fogc(s.stripe ? C.grass1 : C.grass2, f, lit); ctx.fillRect(0, b.y + 0.5, W, y1 - b.y + 0.5);
    // 外側のグラベル（砂利）
    if (s.gravel) {
      const g = s.gravel, [i1, i2] = at(g * 1.14), [o1, o2] = at(g * BARRIER);
      Q(s.index % 2 ? C.gravel1 : C.gravel2, 1, i1, o1, i2, o2);
    }
    // 縁石（カーブだけ）
    const kw = s.kerb ? 0.14 : 0.05;
    for (const side of [-1, 1]) {
      const [e1, e2] = at(side), [k1, k2] = at(side * (1 + kw));
      Q(s.kerb ? (s.light ? C.kerbW : C.kerbR) : C.road, s.kerb ? 1 : 0.92, e1, k1, e2, k2);
    }
    // 舗装
    const [l1, l2] = at(-1), [r1, r2] = at(1);
    Q(C.road, 1 + s.shade, l1, r1, l2, r2);
    if (w2 < 6) return;   // 遠くて細いときは細かい線を省く
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
    } else if (s.light && s.index % 2 === 0) {            // 車線の破線
      const lw = 0.025;
      for (let i = 1; i < LANES; i++) { const o = -1 + (2 * i) / LANES, [p1, p2] = at(o - lw), [q1, q2] = at(o + lw); Q(C.roadLine, 0.95, p1, q1, p2, q2); }
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
      } else {
        // ガードレール：支柱 ＋ 波板
        poly(ctx, fogc(C.armcoDark, f), bx1, a.y, bx2, b.y, bx2, b.y - h2 * 0.45, bx1, a.y - h1 * 0.45);
        poly(ctx, fogc(C.armco, f), bx1, a.y - h1 * 0.45, bx2, b.y - h2 * 0.45, bx2, b.y - h2, bx1, a.y - h1);
        poly(ctx, fogc(C.armco, f, 0.78), bx1, a.y - h1 * 0.68, bx2, b.y - h2 * 0.68, bx2, b.y - h2 * 0.76, bx1, a.y - h1 * 0.76);
        if (s.index % 2 === 0 && h1 > 6) { const pw = Math.max(1, a.w * 0.03); ctx.fillStyle = fogc(C.armcoDark, f, 0.8); ctx.fillRect(bx1 - pw / 2, a.y - h1, pw, h1); }
      }
    }
  }

  drawSprite(ctx, s, sp) {
    if (sp.hit || (sp.deco && !this.quality)) return;
    const img = SPR[sp.type]; if (!img) return;
    const sc = s.p1.screen;
    if (s.p1.camera.z <= CAM_DEPTH) return;
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
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      const ph = (now / 1000 * pct * 40) % 1;
      for (let k = 0; k < 4; k++) { const ty = -32 * u + ((k + ph) / 4) * 32 * u; ctx.fillRect(tx + 3 * u, ty, 18 * u, 1.2 * u); }
    }
    // ディフューザー
    ctx.fillStyle = '#161616'; ctx.fillRect(-24 * u, -12 * u, 48 * u, 10 * u);
    ctx.fillStyle = '#2c2c2c'; for (let k = -2; k <= 2; k++) ctx.fillRect(k * 9 * u - 0.8 * u, -12 * u, 1.6 * u, 10 * u);
    // 車体の後ろ（バッテリーの箱が入っている）
    ctx.fillStyle = bodyG;
    ctx.beginPath(); ctx.moveTo(-26 * u, -12 * u); ctx.lineTo(26 * u, -12 * u); ctx.lineTo(17 * u, -40 * u); ctx.lineTo(-17 * u, -40 * u); ctx.closePath(); ctx.fill();
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
    // リアウイング（翼端板 ＋ 2枚の翼）
    ctx.fillStyle = '#222'; ctx.fillRect(-7 * u, -66 * u, 2.4 * u, 26 * u); ctx.fillRect(4.6 * u, -66 * u, 2.4 * u, 26 * u);
    ctx.fillStyle = '#111'; rrect(ctx, -42 * u, -70 * u, 84 * u, 8 * u, 2 * u);
    ctx.fillStyle = '#1565c0'; rrect(ctx, -42 * u, -79 * u, 84 * u, 6 * u, 2 * u);
    ctx.fillStyle = '#e53935'; ctx.fillRect(-45 * u, -84 * u, 4 * u, 28 * u); ctx.fillRect(41 * u, -84 * u, 4 * u, 28 * u);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(6, Math.round(6.5 * u))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TAKUDEN EV', 0, -65.6 * u);
    // レインライト（ブレーキで明るく光る）
    ctx.fillStyle = braking ? '#ff1744' : '#5a1010';
    if (braking) { ctx.shadowColor = '#ff1744'; ctx.shadowBlur = 18 * u; }
    ctx.fillRect(-5 * u, -9 * u, 10 * u, 5 * u);
    ctx.shadowBlur = 0;
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
  SPR.ready = true;
}
