// 走行音（Web Audio で合成。音声ファイルは使わない）
// モータ回転数とトルクから、インバータ音・モータの電磁音・ギヤ音を作り、車速からタイヤ音・風切り音・路面の音を作る。
// 前提：デンソー製モータ 36 kW（最高 11000 rpm）、減速比 10:1。極対数・キャリア周波数・ギヤの歯数は仮定（下の定数で変えられる）

const POLE_PAIRS = 4;          // モータの極対数（仮定）。電気周波数 = 回転数/60 × 極対数（11000 rpm で約 730 Hz）
const PINION_TEETH = 17;       // モータ側の歯車の歯数（仮定）。ギヤ音の高さ = 回転数/60 × 歯数
// インバータのキャリア周波数 [Hz]。低速ほど低い音から切り替わる（「ヒュイーン」の段の変わり目）
const CARRIER_STEPS = [[0, 1250], [900, 2500], [2600, 5000]];   // [この回転数から, キャリア周波数]
const STRIPE_M = 1.9;          // 縁石の紅白 1 区画の長さ [m]（縁石の上を走るときのゴトゴトの間隔）

export class DriveSound {
  constructor(actx) {
    this.ctx = actx;
    const c = actx, t = c.currentTime;
    this.master = c.createGain(); this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);

    // ホワイトノイズ（タイヤ・風・砂利・衝突に使い回す）
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const n = c.createBufferSource(); n.buffer = buf; n.loop = true; n.start(t, Math.random() * 2); return n; };
    const gain = (to = this.master) => { const g = c.createGain(); g.gain.value = 0; g.connect(to); return g; };
    const filt = (type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

    // モータの電磁音（電気周波数と、その 2・3・6 倍の成分）
    this.motor = c.createOscillator();
    this.motor.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.35, 0.2, 0, 0, 0.45])));
    this.motorG = gain(); this.motor.connect(this.motorG); this.motor.start();
    // インバータのキャリア音（キャリア周波数 ± 電気周波数の 2 倍の側帯波＝周波数変調で作る）
    this.carrier = c.createOscillator(); this.carrier.type = 'sine'; this.carrier.frequency.value = 1250;
    this.fm = c.createOscillator(); this.fm.type = 'sine';
    this.fmDepth = c.createGain(); this.fm.connect(this.fmDepth); this.fmDepth.connect(this.carrier.frequency);
    this.invG = gain(); const invF = filt('bandpass', 3000, 0.4); this.carrier.connect(invF); invF.connect(this.invG);
    this.carrier.start(); this.fm.start();
    // ギヤのかみ合い音
    this.gearOsc = c.createOscillator(); this.gearOsc.type = 'triangle'; this.gearG = gain(); this.gearOsc.connect(this.gearG); this.gearOsc.start();
    // タイヤのロードノイズ（速いほど高く大きく）
    this.roadF = filt('lowpass', 300); this.roadG = gain(); noise().connect(this.roadF); this.roadF.connect(this.roadG);
    // 風切り音
    this.windF = filt('bandpass', 700, 0.5); this.windG = gain(); noise().connect(this.windF); this.windF.connect(this.windG);
    // 砂利（ザザザ）と芝（ボソボソ）
    this.gravelG = gain(); const gf = filt('highpass', 1800); noise().connect(gf); gf.connect(this.gravelG);
    this.grassG = gain(); const sf = filt('lowpass', 260); noise().connect(sf); sf.connect(this.grassG);
    // 縁石（ゴトゴト）：低い矩形波を区画の間隔で鳴らす
    this.kerbOsc = c.createOscillator(); this.kerbOsc.type = 'square'; this.kerbOsc.frequency.value = 10;
    this.kerbG = gain(); const kf = filt('lowpass', 140); this.kerbOsc.connect(kf); kf.connect(this.kerbG); this.kerbOsc.start();
  }

  // 毎フレーム呼ぶ。st: { on, rpm, torque(N·m、負は回生), maxTorque, speed(m/s), topSpeed(m/s), surface, onKerb }
  update(st) {
    const c = this.ctx, t = c.currentTime, k = 0.04;
    const set = (p, v, tc = k) => p.setTargetAtTime(v, t, tc);
    set(this.master.gain, st.on ? 1 : 0, 0.08);
    if (!st.on) return;
    const rpm = Math.max(0, st.rpm), v = Math.max(0, st.speed), vr = Math.min(1, v / st.topSpeed);
    const load = Math.min(1, Math.abs(st.torque) / st.maxTorque);   // 0〜1 のトルクの大きさ
    const moving = v > 0.3 ? 1 : 0;
    const fe = Math.max(1, rpm / 60 * POLE_PAIRS);
    // モータ
    set(this.motor.frequency, fe);
    set(this.motorG.gain, moving * (0.02 + 0.07 * load) * (0.4 + 0.6 * vr));
    // インバータ：キャリアの段は回転数で決まる。トルクを出しているほど大きい
    let fc = CARRIER_STEPS[0][1];
    for (const [r, f] of CARRIER_STEPS) if (rpm >= r) fc = f;
    if (fc !== this._fc) { this.carrier.frequency.setValueAtTime(fc, t); this._fc = fc; }
    set(this.fm.frequency, 2 * fe); set(this.fmDepth.gain, 2 * fe * 0.9);
    set(this.invG.gain, moving * (0.012 + 0.05 * load) * (1 - 0.5 * vr));
    // ギヤ
    set(this.gearOsc.frequency, Math.max(1, rpm / 60 * PINION_TEETH));
    set(this.gearG.gain, moving * 0.012 * vr * (0.4 + 0.6 * load));
    // タイヤ・風
    set(this.roadF.frequency, 250 + 1400 * vr);
    set(this.roadG.gain, (st.surface === 'road' ? 0.12 : 0.04) * Math.min(1, v / 8) * (0.4 + 0.6 * vr));
    set(this.windG.gain, 0.1 * vr * vr);
    set(this.windF.frequency, 500 + 900 * vr);
    // 路面
    const rough = Math.min(1, v / 10);
    set(this.gravelG.gain, st.surface === 'gravel' ? (0.06 + Math.random() * 0.1) * rough : 0, 0.01);
    set(this.grassG.gain, st.surface === 'grass' ? (0.15 + Math.random() * 0.1) * rough : 0, 0.02);
    set(this.kerbOsc.frequency, Math.max(2, v / STRIPE_M));
    set(this.kerbG.gain, st.onKerb ? 0.07 * rough : 0, 0.02);
  }

  // 短いノイズの音（衝突・コーン）
  burst(type, f, q, dur, vol, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(b); b.connect(g); g.connect(this.master); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }
  tone(freq, dur, vol, type = 'sine', delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  // コーンをはねた音（樹脂の「ボコッ」）
  cone() { this.tone(180, 0.18, 0.5, 'sine'); this.burst('bandpass', 1100, 2, 0.12, 0.5); this.tone(420, 0.1, 0.15, 'triangle', 0.03); }
  // ガードレールにぶつかった音（ドンッ＋金属のキーン）
  crash() {
    this.burst('lowpass', 400, 0.7, 0.45, 0.9); this.tone(70, 0.35, 0.6, 'sine');
    [523, 1307, 2113].forEach((f, i) => this.tone(f, 0.6, 0.05, 'triangle', 0.02 * i));
    this.burst('highpass', 3000, 0.7, 0.3, 0.15, 0.05);
  }
}
