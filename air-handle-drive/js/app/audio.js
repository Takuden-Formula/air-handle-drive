// 効果音（ビープ・ファンファーレ）と走行音（../../sound.js の DriveSound）
import { DriveSound } from '../../sound.js';

export class Audio {
  constructor(settings, log) {
    this.settings = settings; this.log = log; this.actx = null; this.drive = null;
    const unlock = () => { if (this.ctx()) this.actx.resume(); };
    document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
  }
  ctx() { if (!this.actx) { try { this.actx = new AudioContext(); } catch {} } return this.actx; }
  beep(freq, ms, type = 'square', vol = 0.15, delay = 0) {
    if (!this.settings.sound || !this.ctx()) return;
    const a = this.actx, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(a.destination);
    const t = a.currentTime + delay / 1000;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000); o.start(t); o.stop(t + ms / 1000 + 0.02);
  }
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.beep(f, 260, 'square', 0.15, i * 140)); }
  // 走行音（必要になったときに作る）
  driveSound(create = true) {
    if (!this.drive && create && this.ctx()) { try { this.drive = new DriveSound(this.actx); } catch (e) { this.log('走行音を作れません: ' + e.message); } }
    return this.drive;
  }
}
