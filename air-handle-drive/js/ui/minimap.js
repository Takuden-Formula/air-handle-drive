// コースマップ（左上）：白い線がコース、黄色が走った所、赤い点が自分、緑の点がスタート、チェッカーがゴール
// 線は一度だけ画像に描いておき、毎フレームは走った所と自分の点だけ描く
export class MiniMap {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.base = null; this.pts = null; this.visible = false;
  }
  // stage.map: { pts: [[x, z], ...]（スタート→ゴール）, all: コース全体, closed }
  setStage(stage) { this.map = stage.map; this.base = null; this.lastKey = ''; }

  _layout() {
    const cv = this.cv, dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(cv.clientWidth * dpr) || 200;
    if (cv.width !== size) { cv.width = size; cv.height = size; this.base = null; }
    if (this.base) return;
    const all = this.map.all, pts = this.map.pts;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of all) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = size * 0.1, k = (size - pad * 2) / Math.max(x1 - x0, y1 - y0, 1);
    const ox = pad + (size - pad * 2 - (x1 - x0) * k) / 2, oy = pad + (size - pad * 2 - (y1 - y0) * k) / 2;
    this.P = ([x, y]) => [ox + (x - x0) * k, oy + (y - y0) * k];
    this.lw = Math.max(2.5, size * 0.028);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.lineJoin = 'round'; g.lineCap = 'round';
    const line = (list) => { g.beginPath(); list.forEach((p, i) => { const [a, b] = this.P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); };
    // コース全体（走らない所はうすく）
    line(all); if (this.map.closed) g.closePath();
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = this.lw * 2.2; g.stroke();
    g.strokeStyle = 'rgba(232,237,242,.35)'; g.lineWidth = this.lw; g.stroke();
    line(pts); g.strokeStyle = '#e8edf2'; g.lineWidth = this.lw; g.stroke();
    // ゴール（チェッカー）とスタート（緑）
    const [gx, gy] = this.P(pts[pts.length - 1]), cs = Math.max(2, size * 0.024);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(gx - 2 * cs + i * cs, gy - 1.5 * cs + j * cs, cs, cs); }
    const [sx, sy] = this.P(pts[0]); g.fillStyle = '#7ee787'; g.beginPath(); g.arc(sx, sy, Math.max(3, size * 0.03), 0, Math.PI * 2); g.fill();
    this.base = c;
  }

  // f: スタートからゴールまでの進み具合（0〜1。周回コースで 2 周なら 1 周ごとに 0〜1 を渡す）
  draw(f, visible = true) {
    const cv = this.cv;
    if (visible !== this.visible) { cv.style.display = visible ? 'block' : 'none'; this.visible = visible; }
    if (!visible || !this.map) return;
    this._layout();
    const g = this.g, pts = this.map.pts;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.base, 0, 0);
    const fp = Math.max(0, Math.min(1, f)) * (pts.length - 1), i0 = Math.min(pts.length - 2, Math.floor(fp)), t = fp - i0;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); for (let i = 0; i <= i0; i++) { const [a, b] = this.P(pts[i]); i ? g.lineTo(a, b) : g.moveTo(a, b); }
    const [ax, ay] = this.P(pts[i0]), [bx, by] = this.P(pts[i0 + 1]);
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    g.lineTo(px, py); g.strokeStyle = '#ffcf3f'; g.lineWidth = this.lw; g.stroke();
    g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, this.lw * 0.6);
    g.beginPath(); g.arc(px, py, Math.max(4, cv.width * 0.045), 0, Math.PI * 2); g.fill(); g.stroke();
  }
}
