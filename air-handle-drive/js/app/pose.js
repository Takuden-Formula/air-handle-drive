// カメラと骨格認識（MediaPipe Pose）。右下のカメラ画面に骨格と「見えないハンドル」を描く。
// ハンドルの判定そのものは ../../wheel.js（旧版と同じ）。
import { FilesetResolver, PoseLandmarker } from '../../lib/vision_bundle.mjs';
import { readWheel } from '../../wheel.js';

export class PoseInput {
  // video: <video>, canvas: カメラ画面の <canvas>, settings: { camId, mirror }, log, save()
  constructor({ video, canvas, select, settings, log, save }) {
    this.video = video; this.cam = canvas; this.ctx = canvas.getContext('2d'); this.select = select;
    this.settings = settings; this.log = log; this.save = save;
    this.stream = null; this.landmarker = null; this.lastVideoTime = -1;
    this.wheel = { held: false }; this.frames = 0; this.delegate = '';
    if (select) select.onchange = () => { settings.camId = select.value; save(); this.startCamera().catch((e) => this.onError && this.onError(e.message)); };
    window.addEventListener('beforeunload', () => { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); });
  }

  async startCamera() {
    const { video, cam, settings } = this;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    const v = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } };
    if (settings.camId) v.deviceId = { exact: settings.camId };
    try { this.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); }
    catch (e) {
      if (settings.camId) { settings.camId = ''; this.save(); return this.startCamera(); }
      throw new Error('カメラを開けません: ' + e.message + '（他のアプリがカメラを使っていないか、カメラの許可を確認）');
    }
    video.srcObject = this.stream; await video.play();
    cam.width = video.videoWidth || 640; cam.height = video.videoHeight || 480;
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const cur = this.stream.getVideoTracks()[0].getSettings().deviceId;
    if (this.select) {
      this.select.innerHTML = '';
      devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'カメラ ' + (i + 1); o.selected = d.deviceId === cur; this.select.appendChild(o); });
    }
    this.log(`カメラ: ${cam.width}x${cam.height}`);
  }

  async loadModel() {
    const fileset = await FilesetResolver.forVisionTasks('./lib/wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: './models/pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); this.delegate = 'GPU'; }
    catch (e) {
      this.log('GPU で起動できないので CPU に切り替え: ' + e.message);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); this.delegate = 'CPU';
    }
  }

  // 毎フレーム呼ぶ。カメラの新しいコマがあれば骨格を読み、ハンドルの状態を更新する。戻り値: 新しいコマを処理したか
  update(now) {
    const video = this.video;
    if (!this.landmarker || video.readyState < 2 || video.currentTime === this.lastVideoTime) return false;
    this.lastVideoTime = video.currentTime;
    let res = null;
    try { res = this.landmarker.detectForVideo(video, now); } catch (e) { this.log('認識エラー: ' + e.message); }
    this.draw(res); this.frames++;
    return true;
  }

  // カメラ画面（骨格とハンドル）を描き、ハンドルの状態を読む（旧版と同じ描き方）
  draw(res) {
    const { cam, ctx: c, video, settings } = this;
    const W = cam.width, H = cam.height;
    c.save();
    if (settings.mirror) { c.translate(W, 0); c.scale(-1, 1); }
    c.drawImage(video, 0, 0, W, H);
    c.restore();
    const lm = res && res.landmarks && res.landmarks[0];
    this.wheel = readWheel(lm, W, H, settings.mirror);
    if (this.wheel.held) this.lastHeldAt = performance.now();
    if (!lm) return;
    const P = (i) => ({ x: (settings.mirror ? 1 - lm[i].x : lm[i].x) * W, y: lm[i].y * H });
    c.strokeStyle = '#ffffff'; c.lineWidth = 4; c.beginPath();
    [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]].forEach(([a, b]) => {
      if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) return;
      const p = P(a), q = P(b); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y);
    });
    c.stroke();
    const wheel = this.wheel;
    if (wheel.left) {
      const { center: ce, radius: r } = wheel;
      c.save(); c.translate(ce.x, ce.y); c.rotate(wheel.angle * Math.PI / 180);
      c.strokeStyle = wheel.held ? '#7ee787' : '#999'; c.lineWidth = 10;
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 7; c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, 0); c.lineTo(0, r); c.stroke();
      c.restore();
      c.fillStyle = '#ffcf3f';
      [wheel.left, wheel.right].forEach((p) => { c.beginPath(); c.arc(p.x, p.y, 12, 0, Math.PI * 2); c.fill(); });
    }
  }
}
