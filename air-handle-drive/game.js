// 疑似3Dレースゲームのエンジン（道路の生成・車の物理・描画）
// 道路は一定長のセグメントの連なりで、各セグメントにカーブ量と高さを持たせて画面に投影する。

const SEG = 200;            // セグメント1つの長さ
const RUMBLE = 3;           // 路肩の紅白が何セグメントで切り替わるか
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

const COLORS = {
  light: { road: '#6c6c6c', grass: '#58b45c', rumble: '#f0f0f0', lane: '#f4f4f4' },
  dark: { road: '#666666', grass: '#4ea852', rumble: '#d93a3a', lane: null },
  fog: '#d7ebf7',
};

const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const lerp = (a, b, p) => a + (b - a) * p;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Race {
  constructor() { this.segments = []; this.skyOffset = 0; this.cx = 0.5; this.reset(); }  // cx: 画面上の道路・車の中心（横位置の割合）

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

    // 木（道路の外）
    for (let n = 10; n < this.segments.length; n += 3 + Math.floor(rnd() * 5)) {
      const side = rnd() < 0.5 ? -1 : 1;
      this.segments[n].sprites.push({ type: 'tree', offset: side * (1.5 + rnd() * 2.5), w: 0.55 + rnd() * 0.3 });
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
    this.segments[this.finishSeg].sprites.push({ type: 'gate', offset: 0, w: 2.4 });
    this.trackLength = this.segments.length * SEG;
    this.finishZ = this.finishSeg * SEG;
    this.reset();
  }

  lastY() { return this.segments.length ? this.segments[this.segments.length - 1].p2.world.y : 0; }
  addSegment(curve, y) {
    const n = this.segments.length;
    this.segments.push({
      index: n, curve, sprites: [],
      p1: { world: { y: this.lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
      color: Math.floor(n / RUMBLE) % 2 ? COLORS.dark : COLORS.light,
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
    if (this.offroad && this.speed > OFFROAD_LIMIT) this.speed += OFFROAD_DECEL * dt;

    // 当たり判定（自車がいるセグメントと次のセグメント）
    for (const s of [seg, this.segments[seg.index + 1]]) {
      if (!s) continue;
      for (const sp of s.sprites) {
        if (sp.hit || sp.type === 'gate') continue;
        const half = sp.type === 'tree' ? sp.w * 0.25 : sp.w * 0.5;
        if (Math.abs(this.playerX - sp.offset) < (CAR_HALF + half) * 0.85) {
          if (sp.type === 'cone') { sp.hit = true; this.speed *= 0.5; this.coneHits++; this.events.push('cone'); this.shake = 0.3; }
          else if (sp.type === 'tree' && this.speed > MAX_SPEED / 8) {
            this.speed = MAX_SPEED / 8; this.crashes++; this.events.push('crash'); this.shake = 0.5;
            this.playerX += (this.playerX > sp.offset ? 1 : -1) * 0.15;
          }
        }
      }
    }
    this.playerX = clamp(this.playerX, -2.5, 2.5);
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

  // ---------- 描画 ----------
  render(ctx, W, H) {
    const segs = this.segments;
    if (!segs.length) return;
    const base = this.findSegment(this.position);
    const basePct = (this.position % SEG) / SEG;
    const pSeg = this.findSegment(this.position + PLAYER_Z);
    const pPct = ((this.position + PLAYER_Z) % SEG) / SEG;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * 12 : (this.offroad && this.speed > 0 ? (Math.random() - 0.5) * 5 : 0);

    ctx.save();
    ctx.translate(0, shakeY);
    this.drawBackground(ctx, W, H, playerY);

    // 手前から奥へ投影して、奥から手前へ描く（重なりが正しくなる）
    const vis = [];
    let x = 0, dx = -(base.curve * basePct);
    for (let n = 0; n < DRAW; n++) {
      const s = segs[base.index + n];
      if (!s) break;
      s.fog = 1 / Math.pow(Math.E, (n / DRAW) * (n / DRAW) * FOG);
      this.project(s.p1, this.playerX * ROAD_W - x, playerY + CAM_H, this.position, W, H);
      this.project(s.p2, this.playerX * ROAD_W - x - dx, playerY + CAM_H, this.position, W, H);
      x += dx; dx += s.curve;
      if (s.p1.camera.z <= CAM_DEPTH) continue;
      vis.push(s);
    }
    for (let i = vis.length - 1; i >= 0; i--) {
      const s = vis[i];
      if (s.p2.screen.y < s.p1.screen.y) this.drawSegment(ctx, W, s);
      for (const sp of s.sprites) this.drawSprite(ctx, s, sp);
    }
    this.drawCar(ctx, W, H);
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

  drawBackground(ctx, W, H, playerY) {
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.6);
    g.addColorStop(0, '#5aa9f0'); g.addColorStop(1, COLORS.fog);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 遠くの山（カーブで左右に流れる）
    const hy = H * 0.5 + playerY * 0.002;
    const layers = [{ c: '#9cc2d9', h: 0.16, k: 0.5, f: 3 }, { c: '#7fb08f', h: 0.09, k: 1, f: 5 }];
    for (const L of layers) {
      ctx.fillStyle = L.c; ctx.beginPath(); ctx.moveTo(0, hy + 2);
      const off = this.skyOffset * L.k * W;
      for (let i = 0; i <= 40; i++) {
        const px = (i / 40) * W, t = (px + off) / W * Math.PI * 2;
        const y = hy - H * L.h * (0.55 + 0.25 * Math.sin(t * L.f / 2) + 0.2 * Math.sin(t * L.f * 1.7 + 1));
        ctx.lineTo(px, y);
      }
      ctx.lineTo(W, hy + 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = COLORS.fog; ctx.fillRect(0, hy, W, H - hy);
  }

  drawSegment(ctx, W, s) {
    const { x: x1, y: y1, w: w1 } = s.p1.screen, { x: x2, y: y2, w: w2 } = s.p2.screen;
    const c = s.color;
    const r1 = w1 / 6, r2 = w2 / 6, l1 = w1 / 32, l2 = w2 / 32;
    ctx.fillStyle = c.grass; ctx.fillRect(0, y2, W, y1 - y2 + 1);
    poly(ctx, c.rumble, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2);
    poly(ctx, c.rumble, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2);
    poly(ctx, c.road, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2);
    if (s.index === this.finishSeg || s.index === this.finishSeg + 1) {     // ゴールのチェッカー
      const n = 10;
      for (let i = 0; i < n; i++) {
        if ((i + s.index) % 2) continue;
        const a = -1 + (2 * i) / n, b = -1 + (2 * (i + 1)) / n;
        poly(ctx, '#ffffff', x1 + w1 * a, y1, x1 + w1 * b, y1, x2 + w2 * b, y2, x2 + w2 * a, y2);
      }
    } else if (c.lane) {
      const lw1 = (w1 * 2) / LANES, lw2 = (w2 * 2) / LANES;
      let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
      for (let i = 1; i < LANES; i++, lx1 += lw1, lx2 += lw2)
        poly(ctx, c.lane, lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2);
    }
    if (s.fog < 1) { ctx.globalAlpha = 1 - s.fog; ctx.fillStyle = COLORS.fog; ctx.fillRect(0, y2, W, y1 - y2 + 1); ctx.globalAlpha = 1; }
  }

  drawSprite(ctx, s, sp) {
    if (sp.hit) return;
    const sc = s.p1.screen;
    const w = sc.w * sp.w, x = sc.x + sp.offset * sc.w, y = sc.y;
    if (w < 1.5 || w > 4000) return;
    ctx.globalAlpha = Math.min(1, s.fog * 1.6);
    if (sp.type === 'tree') {
      const h = w * 1.8;
      ctx.fillStyle = '#7a5230'; ctx.fillRect(x - w * 0.08, y - h * 0.35, w * 0.16, h * 0.35);
      ctx.fillStyle = '#2e7d32';
      tri(ctx, x, y - h, x - w / 2, y - h * 0.3, x + w / 2, y - h * 0.3);
      ctx.fillStyle = '#388e3c';
      tri(ctx, x, y - h * 1.15, x - w * 0.38, y - h * 0.6, x + w * 0.38, y - h * 0.6);
    } else if (sp.type === 'cone') {
      const h = w * 1.3;
      ctx.fillStyle = '#ff6d00'; tri(ctx, x, y - h, x - w * 0.42, y - h * 0.12, x + w * 0.42, y - h * 0.12);
      ctx.fillRect(x - w / 2, y - h * 0.14, w, h * 0.14);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - w * 0.24, y - h * 0.58, w * 0.48, h * 0.13);
    } else if (sp.type === 'gate') {
      const h = w * 0.5, pw = Math.max(2, w * 0.025);
      ctx.fillStyle = '#333'; ctx.fillRect(x - w / 2, y - h, pw, h); ctx.fillRect(x + w / 2 - pw, y - h, pw, h);
      const bh = h * 0.18; const cells = 16;
      for (let i = 0; i < cells; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fillRect(x - w / 2 + (w * i) / cells, y - h + (bh * j) / 2, w / cells + 1, bh / 2 + 1);
      }
      ctx.fillStyle = '#d32f2f'; ctx.fillRect(x - w / 2, y - h + bh, w, bh);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(bh * 0.8)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('FINISH', x, y - h + bh * 1.5);
    }
    ctx.globalAlpha = 1;
  }

  // 自車（学生フォーミュラ EV を後ろから見た図）
  drawCar(ctx, W, H) {
    const cw = 2 * CAR_HALF * (ROAD_W / CAM_H) * W / 2;   // 画面上の車幅（当たり判定の幅と同じ）
    const cx = W * this.cx, by = H - H * 0.04;
    const bounce = this.speed > 0 ? Math.sin(performance.now() / 40) * (this.offroad ? 3 : 0.8) : 0;
    ctx.save();
    ctx.translate(cx, by + bounce);
    ctx.rotate(this.steer * 0.04);
    const u = cw / 100;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 2 * u, 55 * u, 7 * u, 0, 0, Math.PI * 2); ctx.fill();
    // タイヤ
    ctx.fillStyle = '#151515';
    rrect(ctx, -50 * u, -30 * u, 22 * u, 32 * u, 4 * u); rrect(ctx, 28 * u, -30 * u, 22 * u, 32 * u, 4 * u);
    // 車体
    ctx.fillStyle = '#1565c0';
    ctx.beginPath(); ctx.moveTo(-28 * u, -4 * u); ctx.lineTo(28 * u, -4 * u); ctx.lineTo(18 * u, -38 * u); ctx.lineTo(-18 * u, -38 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0d47a1'; ctx.fillRect(-28 * u, -12 * u, 56 * u, 8 * u);
    // ヘルメット
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, -42 * u, 9 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcf3f'; ctx.fillRect(-9 * u, -44 * u, 18 * u, 3 * u);
    // リアウイング
    ctx.fillStyle = '#222'; ctx.fillRect(-4 * u, -52 * u, 3 * u, 14 * u); ctx.fillRect(1 * u, -52 * u, 3 * u, 14 * u);
    ctx.fillStyle = '#111'; rrect(ctx, -40 * u, -62 * u, 80 * u, 10 * u, 2 * u);
    ctx.fillStyle = '#e53935'; ctx.fillRect(-42 * u, -66 * u, 4 * u, 18 * u); ctx.fillRect(38 * u, -66 * u, 4 * u, 18 * u);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(7 * u)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EV', 0, -57 * u);
    // ブレーキランプ（減速中）
    ctx.fillStyle = this._prevSpeed > this.speed + 1 ? '#ff1744' : '#5a1010';
    ctx.fillRect(-6 * u, -10 * u, 12 * u, 5 * u);
    this._prevSpeed = this.speed;
    ctx.restore();
  }
}

function poly(ctx, color, x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
function tri(ctx, x1, y1, x2, y2, x3, y3) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill(); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
