// サーキット専用の看板テクスチャ（アトラス）。
// 広告・ブレーキ看板・コーナー番号・チーム名などを 1 枚の大きなキャンバスに並べて描き、
// すべての看板を 1 つの材質で描く（看板の種類が増えても描画の呼び出しが増えない）。
// 画像ファイルは使わず、文字と図形はキャンバスで描く（オフライン・ライセンス対策）。
import * as THREE from 'three';

const FONT = '"Meiryo","Yu Gothic UI","Hiragino Sans","IPAGothic","WenQuanYi Zen Hei",sans-serif';
const PAD = 6;   // ミップマップで隣の絵がにじまないよう、各枠のまわりに同じ色を塗り足す幅 [px]

export class SignAtlas {
  constructor(size = 2048, height = size) {
    this.size = size; this.height = height;
    this.canvas = document.createElement('canvas'); this.canvas.width = size; this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    this.g.fillStyle = '#808080'; this.g.fillRect(0, 0, size, height);
    this.slots = new Map();
    this.shelfY = 0; this.shelfH = 0; this.x = 0;
    this._tex = null; this._mats = {};
  }
  // 枠を取って draw(g, w, h) で描く。戻り値 { u0, v0, u1, v1, aspect }
  add(name, w, h, draw) {
    if (this.slots.has(name)) return this.slots.get(name);
    const W = w + PAD * 2, H = h + PAD * 2;
    if (this.x + W > this.size) { this.shelfY += this.shelfH; this.shelfH = 0; this.x = 0; }
    if (this.shelfY + H > this.height) { console.warn('SignAtlas: いっぱいです', name); return this.slots.values().next().value; }
    const x = this.x + PAD, y = this.shelfY + PAD;
    const g = this.g;
    g.save(); g.translate(x, y);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    draw(g, w, h);
    g.restore();
    // 塗り足し（枠の端の色を外へ伸ばす）
    g.drawImage(this.canvas, x, y, w, 1, x, y - PAD, w, PAD);
    g.drawImage(this.canvas, x, y + h - 1, w, 1, x, y + h, w, PAD);
    g.drawImage(this.canvas, x, y - PAD, 1, h + PAD * 2, x - PAD, y - PAD, PAD, h + PAD * 2);
    g.drawImage(this.canvas, x + w - 1, y - PAD, 1, h + PAD * 2, x + w, y - PAD, PAD, h + PAD * 2);
    this.x += W; this.shelfH = Math.max(this.shelfH, H);
    const S = this.size, SH = this.height;
    // テクスチャは上下が反転して貼られる（flipY）ので v は下から
    const slot = { u0: (x + 0.5) / S, u1: (x + w - 0.5) / S, v0: 1 - (y + h - 0.5) / SH, v1: 1 - (y + 0.5) / SH, aspect: w / h, name };
    this.slots.set(name, slot);
    return slot;
  }
  get(name) { return this.slots.get(name); }
  texture() {
    if (!this._tex) {
      const t = this._tex = new THREE.CanvasTexture(this.canvas);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    }
    return this._tex;
  }
  // 看板の材質（kind: 'board' = ふつうの看板, 'glow' = 光る LED 画面）
  material(kind = 'board') {
    if (this._mats[kind]) return this._mats[kind];
    const map = this.texture();
    let m;
    if (kind === 'glow') m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(1.6, 1.6, 1.6), name: 'circuit-led' });
    else m = new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.05, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.14, name: 'circuit-signs' });
    this._mats[kind] = m;
    return m;
  }
}

// 枠の絵を貼った板（幅 w × 高さ h、中心が原点、+Z 向き）
export function slotPlane(slot, w, h, { flipU = false } = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  setSlotUV(g, slot, flipU);
  return g;
}
export function setSlotUV(g, slot, flipU = false) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i); if (flipU) u = 1 - u;
    uv.setXY(i, slot.u0 + u * (slot.u1 - slot.u0), slot.v0 + uv.getY(i) * (slot.v1 - slot.v0));
  }
  uv.needsUpdate = true;
  return g;
}

// ---------- 絵の描き方 ----------
function fitText(g, text, maxW, size, weight = 900, style = '') {
  let s = size;
  g.font = `${style} ${weight} ${s}px ${FONT}`;
  const w = g.measureText(text).width;
  if (w > maxW) { s = Math.floor(s * maxW / w); g.font = `${style} ${weight} ${s}px ${FONT}`; }
  return s;
}
function grad(g, h, a, b) { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; }
function bolt(g, x, y, s, color) {
  g.fillStyle = color; g.beginPath();
  g.moveTo(x + 0.55 * s, y); g.lineTo(x + 0.1 * s, y + 0.55 * s); g.lineTo(x + 0.42 * s, y + 0.55 * s);
  g.lineTo(x + 0.25 * s, y + s); g.lineTo(x + 0.9 * s, y + 0.38 * s); g.lineTo(x + 0.56 * s, y + 0.38 * s); g.lineTo(x + 0.75 * s, y);
  g.closePath(); g.fill();
}
// 横長の広告（ロゴ風）
function adDraw({ bg, bg2, fg, text, sub = null, accent = null, logo = null, italic = true, align = 'center' }) {
  return (g, w, h) => {
    g.fillStyle = bg2 ? grad(g, h, bg, bg2) : bg; g.fillRect(0, 0, w, h);
    if (accent) { g.fillStyle = accent; g.fillRect(0, h * 0.86, w, h * 0.14); g.fillRect(0, 0, w, h * 0.05); }
    let x0 = 0;
    if (logo === 'bolt') { bolt(g, h * 0.12, h * 0.12, h * 0.72, accent || fg); x0 = h * 0.8; }
    g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = align;
    const st = italic ? 'italic' : '';
    if (sub) {
      fitText(g, text, w - x0 - h * 0.3, h * 0.5, 900, st); g.fillText(text, align === 'center' ? x0 + (w - x0) / 2 : x0 + h * 0.2, h * 0.38);
      fitText(g, sub, w - x0 - h * 0.3, h * 0.24, 700); g.fillText(sub, align === 'center' ? x0 + (w - x0) / 2 : x0 + h * 0.2, h * 0.75);
    } else {
      fitText(g, text, w - x0 - h * 0.3, h * 0.62, 900, st); g.fillText(text, align === 'center' ? x0 + (w - x0) / 2 : x0 + h * 0.2, h * 0.52);
    }
  };
}

// サーキットで使う絵をすべて登録したアトラスを作る（コースを作るたびに作り直さないようキャッシュ）
let shared = null;
export function circuitAtlas() {
  if (shared) return shared;
  const A = new SignAtlas(2048, 3200);
  // ---- 広告（8:1）----
  const ADS = [
    ['ad-takuden', { bg: '#0d47a1', bg2: '#0a3070', fg: '#ffffff', text: 'TAKUDEN FORMULA', accent: '#ffc928', logo: 'bolt' }],
    ['ad-univ', { bg: '#ffffff', fg: '#0f2f6b', text: '拓殖大学', sub: '電気自動車同好会', accent: '#0f2f6b', italic: false }],
    ['ad-ev', { bg: '#ffc928', fg: '#151515', text: 'EV POWER', accent: '#151515', logo: 'bolt' }],
    ['ad-zero', { bg: '#1b5e20', bg2: '#124016', fg: '#ffffff', text: 'ZERO EMISSION', accent: '#8bc34a' }],
    ['ad-sf', { bg: '#c62828', bg2: '#8e1b1b', fg: '#ffffff', text: 'STUDENT FORMULA', accent: '#ffffff' }],
    ['ad-36kw', { bg: '#11161d', fg: '#ffc928', text: '36kW  60N·m', sub: 'ELECTRIC MOTOR', italic: false }],
    ['ad-circuit', { bg: '#e53935', fg: '#ffffff', text: 'TAKUDEN CIRCUIT', accent: '#11161d' }],
    ['ad-race', { bg: '#212121', fg: '#ffffff', text: 'ELECTRIC RACING', accent: '#e53935', logo: 'bolt' }],
    ['ad-univ2', { bg: '#0f2f6b', fg: '#ffffff', text: '拓殖大学 電気自動車同好会', italic: false, accent: '#ffc928' }],
    ['ad-gp', { bg: '#fafafa', fg: '#c62828', text: 'TAKUDEN GRAND PRIX', accent: '#11161d' }],
    ['ad-charge', { bg: '#00838f', bg2: '#005662', fg: '#ffffff', text: 'CHARGE THE FUTURE', accent: '#ffffff' }],
    ['ad-safety', { bg: '#f57c00', fg: '#ffffff', text: 'SAFETY FIRST', sub: '安全第一で走ろう', italic: false }],
  ];
  for (const [name, o] of ADS) A.add(name, 1012, 126, adDraw(o));
  // ---- 細長い帯（16:1。屋根の看板・タイヤバリアの帯）----
  A.add('fascia-main', 2036, 127, adDraw({ bg: '#0d47a1', bg2: '#0a3070', fg: '#ffffff', text: 'TAKUDEN CIRCUIT  ・  MAIN GRANDSTAND', accent: '#e53935' }));
  A.add('fascia-pit', 2036, 127, adDraw({ bg: '#11161d', fg: '#ffffff', text: 'PIT BUILDING  ・  TAKUDEN FORMULA  ・  拓殖大学 電気自動車同好会', accent: '#ffc928', italic: false }));
  A.add('belt-takuden', 2036, 127, (g, w, h) => {
    g.fillStyle = '#d32f2f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const x = i * w / 4; g.fillStyle = i % 2 ? '#f5f5f5' : '#d32f2f'; g.fillRect(x, 0, w / 4, h);
      g.fillStyle = i % 2 ? '#d32f2f' : '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, i % 2 ? '拓殖大学' : 'TAKUDEN', w / 4 - 30, h * 0.58, 900, i % 2 ? '' : 'italic'); g.fillText(i % 2 ? '拓殖大学' : 'TAKUDEN', x + w / 8, h * 0.52);
    }
  });
  A.add('belt-blue', 2036, 127, (g, w, h) => {
    g.fillStyle = '#0d47a1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc928'; g.fillRect(0, h * 0.82, w, h * 0.18);
    for (let i = 0; i < 3; i++) { g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'TAKUDEN FORMULA', w / 3 - 40, h * 0.55, 900, 'italic'); g.fillText('TAKUDEN FORMULA', (i + 0.5) * w / 3, h * 0.44); }
  });
  // ---- ブレーキの目安の距離看板（4:5）----
  for (const [lab, bars] of [['150', 3], ['100', 2], ['50', 1]]) {
    A.add('dist' + lab, 200, 250, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = '#111'; for (let i = 0; i < bars; i++) g.fillRect(w * 0.16, h * (0.12 + i * 0.15), w * 0.68, h * 0.09);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * 0.3}px ${FONT}`; g.fillText(lab, w / 2, h * 0.78);
    });
  }
  // ---- カーブの矢印（紅白の山形、8:5）----
  for (const dir of [1, -1]) {
    A.add('chev' + dir, 256, 160, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#222'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#d32f2f';
      for (let i = 0; i < 2; i++) {
        const x = 70 + i * 90; g.beginPath();
        if (dir > 0) { g.moveTo(x - 30, 20); g.lineTo(x + 5, 20); g.lineTo(x + 45, 80); g.lineTo(x + 5, 140); g.lineTo(x - 30, 140); g.lineTo(x + 10, 80); }
        else { g.moveTo(x + 45, 20); g.lineTo(x + 10, 20); g.lineTo(x - 30, 80); g.lineTo(x + 10, 140); g.lineTo(x + 45, 140); g.lineTo(x + 5, 80); }
        g.closePath(); g.fill();
      }
    });
  }
  // ---- マーシャルポストの番号（2:1）----
  for (let i = 1; i <= 14; i++) {
    A.add('post' + i, 128, 64, (g, w, h) => {
      g.fillStyle = '#f57c00'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * 0.7}px ${FONT}`; g.fillText('P' + i, w / 2, h * 0.55);
    });
  }
  // ---- ピットのチーム名（4:1）----
  const TEAMS = [
    ['TAKUDEN', '#0d47a1', '#ffc928'], ['拓殖大学', '#ffffff', '#0f2f6b'], ['EV-LAB', '#00838f', '#ffffff'], ['VOLT RACING', '#ffc928', '#151515'],
    ['GREEN ARROW', '#1b5e20', '#ffffff'], ['RED STAR', '#c62828', '#ffffff'], ['SAKURA EV', '#f8bbd0', '#880e4f'], ['NIGHT OWL', '#212121', '#90caf9'],
    ['AQUA E', '#0277bd', '#ffffff'], ['ORANGE BOLT', '#ef6c00', '#ffffff'], ['SILVER WIND', '#b0bec5', '#263238'], ['VIOLET', '#6a1b9a', '#ffffff'],
  ];
  TEAMS.forEach(([name, bg, fg], i) => A.add('team' + i, 384, 96, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.fillRect(0, h * 0.84, w, h * 0.16);
    g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, name, w * 0.86, h * 0.56, 900, /[A-Z]/.test(name) ? 'italic' : ''); g.fillText(name, w / 2, h * 0.45);
  }));
  A.teamColors = TEAMS.map((t) => t[1]);
  // ---- ピットの標識（4:1）----
  A.add('pit-in', 512, 128, adDraw({ bg: '#ffffff', fg: '#111', text: 'PIT IN', accent: '#d32f2f', italic: false }));
  A.add('pit-out', 512, 128, adDraw({ bg: '#ffffff', fg: '#111', text: 'PIT OUT', accent: '#2e7d32', italic: false }));
  A.add('pit-limit', 256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2); g.fillStyle = '#d32f2f'; g.fill();
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.34, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * 0.34}px ${FONT}`; g.fillText('60', w / 2, h * 0.53);
  });
  // ---- 大きな画面（16:9）：レースの中継風の絵 ----
  A.add('screen', 512, 288, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#5d8fd1'); sky.addColorStop(0.55, '#b9d3ef'); sky.addColorStop(0.56, '#4f7d3a'); sky.addColorStop(1, '#3b5f2c');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3b3f45'; g.beginPath(); g.moveTo(w * 0.42, h * 0.56); g.lineTo(w * 0.58, h * 0.56); g.lineTo(w * 0.95, h); g.lineTo(w * 0.05, h); g.closePath(); g.fill();
    // 車（後ろから）
    g.fillStyle = '#0d47a1'; g.fillRect(w * 0.42, h * 0.7, w * 0.16, h * 0.12);
    g.fillStyle = '#111'; g.fillRect(w * 0.38, h * 0.74, w * 0.05, h * 0.12); g.fillRect(w * 0.57, h * 0.74, w * 0.05, h * 0.12); g.fillRect(w * 0.4, h * 0.64, w * 0.2, h * 0.04);
    g.fillStyle = '#ff2222'; g.fillRect(w * 0.48, h * 0.78, w * 0.04, h * 0.03);
    // 中継の文字
    g.fillStyle = 'rgba(10,20,40,.85)'; g.fillRect(0, 0, w, h * 0.16);
    g.fillStyle = '#ffc928'; g.font = `900 ${h * 0.1}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('LIVE', w * 0.03, h * 0.08);
    g.fillStyle = '#fff'; g.font = `italic 900 ${h * 0.1}px ${FONT}`; g.fillText('TAKUDEN GRAND PRIX', w * 0.16, h * 0.08);
    g.fillStyle = 'rgba(10,20,40,.85)'; g.fillRect(w * 0.03, h * 0.2, w * 0.24, h * 0.36);
    g.font = `800 ${h * 0.065}px ${FONT}`;
    ['1  TKD  0.000', '2  EVL  +0.8', '3  VLT  +1.4', '4  GRN  +2.2'].forEach((t, i) => { g.fillStyle = i ? '#fff' : '#ffc928'; g.fillText(t, w * 0.045, h * (0.25 + i * 0.08)); });
  });
  // ---- 順位表示の塔（1:4）----
  A.add('pylon', 128, 512, (g, w, h) => {
    g.fillStyle = '#0b0f14'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e53935'; g.fillRect(0, 0, w, h * 0.1);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${h * 0.05}px ${FONT}`; g.fillText('LAP 1/1', w / 2, h * 0.05);
    const rows = ['TKD', 'EVL', 'VLT', 'GRN', 'RED', 'SKR', 'AQA', 'OWL'];
    rows.forEach((t, i) => {
      const y = h * (0.15 + i * 0.105);
      g.fillStyle = i % 2 ? '#141b24' : '#1b2430'; g.fillRect(4, y - h * 0.045, w - 8, h * 0.095);
      g.fillStyle = '#ffc928'; g.font = `900 ${h * 0.055}px ${FONT}`; g.textAlign = 'left'; g.fillText(String(i + 1), w * 0.08, y);
      g.fillStyle = '#fff'; g.fillText(t, w * 0.36, y);
    });
  });
  // ---- 時計（コントロールタワー）----
  A.add('clock', 256, 256, (g, w, h) => {
    g.fillStyle = '#11161d'; g.fillRect(0, 0, w, h);
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2); g.fillStyle = '#fafafa'; g.fill();
    g.strokeStyle = '#11161d'; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.lineWidth = i % 3 ? 4 : 9; g.beginPath(); g.moveTo(w / 2 + Math.sin(a) * w * 0.34, h / 2 - Math.cos(a) * h * 0.34); g.lineTo(w / 2 + Math.sin(a) * w * 0.4, h / 2 - Math.cos(a) * h * 0.4); g.stroke(); }
    g.lineWidth = 10; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + Math.sin(-1.2) * w * 0.22, h / 2 - Math.cos(-1.2) * h * 0.22); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + Math.sin(2.1) * w * 0.33, h / 2 - Math.cos(2.1) * h * 0.33); g.stroke();
  });
  // ---- 大きな文字（コントロールタワー・アーチ）----
  A.add('tower-name', 1012, 126, adDraw({ bg: '#fafafa', fg: '#0d47a1', text: 'TAKUDEN CIRCUIT', accent: '#e53935' }));
  A.add('arch-logo', 1012, 252, (g, w, h) => {
    g.fillStyle = '#ffc928'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0d47a1'; g.fillRect(0, h * 0.78, w, h * 0.22);
    bolt(g, w * 0.04, h * 0.1, h * 0.62, '#0d47a1');
    g.fillStyle = '#0d47a1'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'TAKUDEN', w * 0.72, h * 0.62, 900, 'italic'); g.fillText('TAKUDEN', w * 0.56, h * 0.4);
    g.fillStyle = '#ffffff'; fitText(g, 'FORMULA ELECTRIC TEAM  ・  拓殖大学 電気自動車同好会', w * 0.92, h * 0.15, 800); g.fillText('FORMULA ELECTRIC TEAM  ・  拓殖大学 電気自動車同好会', w / 2, h * 0.89);
  });
  shared = A;
  return A;
}
