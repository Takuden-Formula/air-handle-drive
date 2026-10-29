// 車の性能と運動（three.js を使わない純粋な計算。単位は m・秒・rad）
// 車の位置はコースの中心線に沿った距離 s と、中心線からの横の位置 d（+ = 進行方向の右）で持つ。
// 縦の動き（加速）は旧版 game.js の CAR / motorAccel をそのまま使い、
// 横の動き（ハンドル）は旧版と同じ「ハンドル量 → 横の速さ」の一次の式を m 単位に直したもの。
// コーナーでは横 G の上限から決まる速さまで自動でブレーキをかける（ブレーキランプが光る）。

// ---------- 車の性能（同好会の車：デンソー製モータ 36 kW） ----------
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
export const TOP_MS = rpmToMs(CAR.maxRpm);        // 最高速 [m/s]（約 30.5）
export const TOP_KMH = TOP_MS * 3.6;              // 最高速（約 110 km/h）
// 車速 v [m/s] でアクセル全開のときの加速度 [m/s²] と、そのときのモータトルク [N·m]
// 低速はトルク一定（60 N·m）、約 5700 rpm から上は出力一定（36 kW）でトルクが下がる
export function motorAccel(v, throttle = 1) {
  const w = msToRpm(v) * 2 * Math.PI / 60;                       // モータの角速度 [rad/s]
  const tq = Math.min(CAR.torque, CAR.power / Math.max(w, 1)) * throttle;
  const drive = tq * CAR.gear * CAR.eff / (CAR.tireD / 2);
  const resist = 0.5 * 1.2 * CAR.cda * v * v + CAR.crr * CAR.mass * 9.81;
  return { a: (drive - resist) / CAR.mass, torque: tq };
}
const aeroDrag = (v) => 0.5 * 1.2 * CAR.cda * v * v;
// 一定速で走るのに要るトルク [N·m]
const cruiseTorque = (v) => (aeroDrag(v) + CAR.crr * CAR.mass * 9.81) * (CAR.tireD / 2) / CAR.gear / CAR.eff;

// ---------- 車の大きさ（当たり判定） ----------
export const CAR_HALF = 0.7;     // 車の半幅 [m]（タイヤの外側。旧版の「車幅 1.4 m」）
export const CAR_LEN = 2.9;      // 全長 [m]（ウイング込み）
export const DEMO_KMH = 94;      // 待機デモの最高時速（旧版の topFactor 0.7 相当）

// ---------- 運動の定数（旧版の値を m 単位に直したもの） ----------
export const PHYS = {
  steerRate: 0.25,       // ハンドルいっぱいで横に動く速さ = 0.25 × 車速（約 14°）
  drift: 0.12,           // カーブで外へ流される強さ（横の速さ = drift × v² × 曲率）
  offroadDecel: 24.9,    // コースアウト中の減速度 [m/s²]（旧版 MAX_SPEED/1.5）
  offroadLimit: 9.33,    // これより遅ければコースアウトでも減速しない [m/s]（約 34 km/h）
  gravelFactor: 1.3,     // 砂利（グラベル）は芝より強く減速
  crashSpeed: 4.67,      // ガードレールに当たったら、この速さ [m/s] まで落ちる（約 17 km/h）
  crashBack: 0.9,        // 当たったら壁からこれだけ [m] 内側に戻す
  coneSlow: 0.5,         // コーンに当たると速度がこの倍率になる
  brake: 10,             // コーナー手前の自動ブレーキの減速度 [m/s²]
  latG: 2.0,             // 既定の横 G の上限（コースごとに course.latG で変えられる）
  kappaSmooth: 6,        // 曲率をならす範囲 [m]（前後）
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- コーナーの速度の上限（自動ブレーキ用） ----------
// track: Track（kappaAt(s), length, closed, ds, n を使う）。latG: 横 G の上限、caps: [[s0, s1, km/h], ...] 区間の速度上限
// 戻り値: 各サンプル点（ds ごと）での「ここを通ってよい最高速」[m/s] の Float32Array
export function buildSpeedProfile(track, { latG = PHYS.latG, caps = [] } = {}) {
  const n = track.n, ds = track.ds, out = new Float32Array(n);
  const W = Math.max(1, Math.round(PHYS.kappaSmooth / ds));
  const kap = track.kappa;
  for (let i = 0; i < n; i++) {
    // 前後 W 点の曲率の平均（ギザギザで急に遅くならないように）
    let sum = 0, cnt = 0;
    for (let j = -W; j <= W; j++) {
      let k = i + j;
      if (track.closed) k = (k % n + n) % n; else if (k < 0 || k >= n) continue;
      sum += Math.abs(kap[k]); cnt++;
    }
    const k = sum / cnt;
    out[i] = k > 1e-5 ? Math.sqrt(latG * 9.81 / k) : 999;
  }
  for (const [s0, s1, kmh] of caps) {
    for (let i = 0; i < n; i++) {
      const s = i * ds;
      if (s >= s0 && s <= s1) out[i] = Math.min(out[i], kmh / 3.6);
    }
  }
  // 後ろから前へ：ブレーキで間に合う速さにする（周回コースは 2 周ぶん回して継ぎ目もならす）
  const passes = track.closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = n - 1; i >= 0; i--) {
      let nx = i + 1;
      if (nx >= n) { if (!track.closed) continue; nx -= n; }
      out[i] = Math.min(out[i], Math.sqrt(out[nx] * out[nx] + 2 * PHYS.brake * ds));
    }
  }
  return out;
}

// ---------- レースの状態と物理 ----------
// 使い方: sim.setCourse(stage) → sim.reset() → 毎フレーム sim.update(dt, steer, throttle, { topMs, assist })
export class Sim {
  constructor() {
    this.track = null; this.cones = []; this.vprof = null;
    this.startS = 0; this.raceLength = 1000; this.laps = 1;
    this.reset();
  }

  // stage: { track, startS, raceLength, laps, cones:[{s,d,r,kind}], vprof }
  setCourse(stage) {
    this.track = stage.track; this.startS = stage.startS; this.raceLength = stage.raceLength;
    this.laps = stage.laps || 1; this.cones = stage.cones || []; this.vprof = stage.vprof;
    this.reset();
  }

  reset() {
    this.dist = 0;              // スタートからの距離 [m]（周回しても増え続ける）
    this.d = 0;                 // 横の位置 [m]（+ = 右）
    this.dDot = 0;              // 横の速さ [m/s]
    this.speed = 0;             // 車速 [m/s]
    this.accel = 0;             // 前後の加速度 [m/s²]
    this.latAcc = 0;            // 横の加速度 [m/s²]（見た目のロール用）
    this.steer = 0; this.throttle = 0;
    this.rpm = 0; this.torque = 0;
    this.coneHits = 0; this.crashes = 0;
    this.finished = false; this.offroad = false; this.onKerb = false; this.surface = 'road';
    this.braking = false;       // ブレーキランプ（自動ブレーキ or 回生）
    this.autoBrake = false;
    this.events = [];           // {type:'cone', index} / {type:'crash', side} / {type:'finish'} / {type:'lap', lap}
    this.shake = 0;
    this.lap = 0;
    this.time = 0;
    for (const c of this.cones) c.hit = false;
  }

  get s() { return this.track ? this.track.wrap(this.startS + this.dist) : 0; }
  get progress() { return clamp(this.dist / this.raceLength, 0, 1); }
  get kmh() { return this.speed * 3.6; }

  // この位置で出してよい最高速 [m/s]
  vAllowed(s) {
    if (!this.vprof || !this.track) return 999;
    const t = this.track, f = t.wrap(s) / t.ds, i = Math.floor(f), u = f - i;
    const a = this.vprof[clamp(i, 0, t.n - 1)], b = this.vprof[t.closed ? (i + 1) % t.n : clamp(i + 1, 0, t.n - 1)];
    return a + (b - a) * u;
  }

  // steer: -1(左)〜1(右), throttle: 0〜1, opts: { topMs, assist(0〜1) }
  update(dt, steer, throttle, opts) {
    const t = this.track;
    if (!t || dt <= 0) return;
    this.time += dt;
    const top = Math.min(opts.topMs ?? TOP_MS, TOP_MS);
    const assist = clamp(opts.assist ?? 0, 0, 1);
    this.steer = steer; this.throttle = throttle;
    const s = this.s;
    const v = this.speed;
    const kap = t.kappaAt(s);
    const halfL = t.halfWidth(s, -1), halfR = t.halfWidth(s, 1);
    const half = this.d >= 0 ? halfR : halfL;

    // ---- 前後（モータ・回生・自動ブレーキ）----
    const vLim = Math.min(top, this.vAllowed(s));
    const v0 = v;
    let nv = v;
    this.autoBrake = false;
    if (throttle > 0 && v > vLim + 0.3) {
      // コーナーの手前：自動ブレーキ
      nv = Math.max(vLim, v - PHYS.brake * dt); this.torque = -CAR.torque * 0.6; this.autoBrake = true;
    } else if (throttle > 0 && v < vLim - 0.05) {
      const m = motorAccel(v, throttle); nv = Math.min(vLim, v + m.a * dt); this.torque = m.torque;
    } else if (throttle > 0) {
      nv = vLim; this.torque = Math.max(0, cruiseTorque(v));     // 一定速で走るぶんだけ
    } else {
      nv = v - (CAR.regen + aeroDrag(v) / CAR.mass) * dt; this.torque = v > 0.3 ? -CAR.torque * 0.5 : 0;
    }
    nv = Math.max(0, nv);

    // ---- 横（ハンドル・遠心力・アシスト）----
    let dDot = PHYS.steerRate * v * steer;
    dDot -= PHYS.drift * v * v * kap * (1 - assist * 0.7);
    if (assist > 0 && Math.abs(this.d) > 0.6 * half) dDot -= Math.sign(this.d) * assist * 0.8 * half;   // 道路に戻すアシスト
    this.d += dDot * dt;
    this.latAcc += ((v * v * kap + (dDot - this.dDot) / dt * 0.15) - this.latAcc) * Math.min(1, dt * 6);
    this.dDot = dDot;

    // ---- 路面 ----
    const side = this.d >= 0 ? 1 : -1, ad = Math.abs(this.d);
    const edge = t.edgeAt(s, side);
    const roadHalf = side > 0 ? halfR : halfL;
    this.surface = t.surfaceAt(s, this.d);
    this.offroad = ad > roadHalf + edge.kerb;
    this.onKerb = edge.kerb > 0 && ad > roadHalf - CAR_HALF && ad < roadHalf + edge.kerb + CAR_HALF;
    if (this.offroad && nv > PHYS.offroadLimit) {
      const k = this.surface === 'gravel' || this.surface === 'sand' ? PHYS.gravelFactor : 1;
      nv = Math.max(PHYS.offroadLimit, nv - PHYS.offroadDecel * k * dt);
    }

    // ---- 前へ進む ----
    const before = this.dist;
    this.dist += (v + nv) * 0.5 * dt;
    this.speed = nv;
    this.accel += ((nv - v0) / dt - this.accel) * Math.min(1, dt * 8);
    this.braking = this.autoBrake || (throttle <= 0 && v > 1);

    // ---- コーン ----
    const sNow = this.startS + this.dist, sPrev = this.startS + before;
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i];
      if (c.hit) continue;
      // 車の前端がコーンを通り過ぎ、後端がまだ手前にある間に横が重なれば当たり
      let cs = c.s;
      if (t.closed) { const L = t.length; cs += Math.round((sNow - cs) / L) * L; }
      if (cs > sNow + CAR_LEN * 0.5 + 0.1 || cs < sPrev - CAR_LEN * 0.5 - 0.1) continue;
      if (Math.abs(this.d - c.d) < (CAR_HALF + (c.r || 0.18)) * 0.92) {
        c.hit = true; this.speed *= PHYS.coneSlow; this.coneHits++; this.shake = 0.3;
        this.events.push({ type: 'cone', index: i, rel: this.d - c.d });
      }
    }

    // ---- ガードレール・壁 ----
    const bd = t.barrierD(s, side);
    if (ad > bd - CAR_HALF - 0.05) {
      if (this.speed > PHYS.crashSpeed) {
        this.speed = PHYS.crashSpeed; this.crashes++; this.shake = 0.5;
        this.events.push({ type: 'crash', side });
      }
      this.d = side * Math.max(0, bd - CAR_HALF - PHYS.crashBack);
      this.dDot = 0;
    }

    this.rpm = msToRpm(this.speed);
    this.shake = Math.max(0, this.shake - dt);

    // ---- 周回・ゴール ----
    if (t.closed && this.laps > 1) {
      const lapLen = this.raceLength / this.laps, lap = Math.floor(this.dist / lapLen);
      if (lap > this.lap && lap < this.laps) { this.lap = lap; this.events.push({ type: 'lap', lap: lap + 1 }); }
    }
    if (!this.finished && this.dist >= this.raceLength) { this.finished = true; this.events.push({ type: 'finish' }); }
    // コースの端（片道コースのゴールの先）では止める
    if (!t.closed) {
      const maxDist = t.length - this.startS - 5;
      if (this.dist > maxDist) { this.dist = maxDist; this.speed = 0; }
    }
  }

  // 自動運転（待機画面のデモ・テスト用）: コーンをよけながら道路の中央付近を走る
  autopilot(assist = 0) {
    const t = this.track; if (!t) return 0;
    const s = this.s, half = Math.min(t.halfWidth(s, -1), t.halfWidth(s, 1));
    const sNow = this.startS + this.dist;
    let target = 0;
    const lanes = [-0.62, 0, 0.62].map((k) => k * half);
    // 前方 45 m のコーンを調べて、空いている車線を選ぶ
    let nearest = Infinity, blockers = [];
    for (const c of this.cones) {
      if (c.hit || c.kind === 'boundary') continue;
      let cs = c.s;
      if (t.closed) { const L = t.length; cs += Math.round((sNow - cs) / L) * L; }
      const ahead = cs - sNow;
      if (ahead < -1 || ahead > 45) continue;
      if (ahead < nearest - 6) { nearest = ahead; blockers = [c]; } else if (Math.abs(ahead - nearest) <= 6) blockers.push(c);
    }
    if (blockers.length) {
      const free = lanes.filter((x) => blockers.every((c) => Math.abs(c.d - x) > CAR_HALF + 0.55));
      target = free.length ? free.reduce((a, b) => (Math.abs(b - this.d) < Math.abs(a - this.d) ? b : a)) : 0;
    }
    // 境界のコーン（学生フォーミュラのコース）が近いときは中央へ
    const v = this.speed;
    // 少し先の曲率で前もって切る（遠心力の打ち消し）
    const kap = t.kappaAt(s + Math.min(6, v * 0.15));
    const ff = PHYS.drift * v * kap * (1 - assist * 0.7) / PHYS.steerRate;
    const fb = (target - this.d) * 0.55 - this.dDot / Math.max(4, v) * 0.6;
    return clamp(ff + fb, -1, 1);
  }

  // 理論上の最速タイム：アクセル全開（コーナーの自動ブレーキ込み）で道の真ん中を走ったときの時間
  idealTime(topMs = TOP_MS) {
    const top = Math.min(topMs, TOP_MS), dt = 1 / 120;
    let v = 0, x = 0, tm = 0;
    while (x < this.raceLength && tm < 900) {
      const lim = Math.min(top, this.vAllowed(this.startS + x));
      let nv;
      if (v > lim + 0.3) nv = Math.max(lim, v - PHYS.brake * dt);
      else if (v < lim - 0.05) nv = Math.min(lim, v + motorAccel(v).a * dt);
      else nv = lim;
      x += (v + nv) * 0.5 * dt; v = nv; tm += dt;
    }
    return tm;
  }
}
