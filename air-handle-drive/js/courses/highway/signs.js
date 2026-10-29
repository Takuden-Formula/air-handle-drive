// 標識：門型の案内標識（緑・白文字）・情報板（電光）・路側の標識（速度・トンネル・出口）・キロポスト・非常電話・
// 視線誘導標・ゴールの門。文字の面は 1 枚のアトラス（大きなキャンバス）にまとめて、1 つの材質で描く。
import * as THREE from 'three';
import { MAT, mulberry32 } from '../../engine/textures.js';
import { checkerMaterial, roadDecal } from '../../engine/props.js';
import { Batch, box, at } from './structures.js';
import { glowRGB, FONT } from './tex.js';
import { SEC, wallL, wallR, oppEdges, wallKind, HALF } from './layout.js';

const GREEN = '#0a6b3d';
// ---------------- 文字の面のアトラス（棚詰め） ----------------
export class Atlas {
  constructor(W = 2048, H = 2560) {
    this.W = W; this.H = H; this.x = 0; this.y = 0; this.row = 0;
    this.c = document.createElement('canvas'); this.c.width = W; this.c.height = H;
    this.g = this.c.getContext('2d'); this.g.fillStyle = '#7a8088'; this.g.fillRect(0, 0, W, H);
  }
  // w × h [px] の場所を取り、draw(g, w, h) で描く。戻り値は UV の範囲 [u0, v0, u1, v1]
  add(w, h, draw) {
    if (this.x + w > this.W) { this.x = 0; this.y += this.row + 4; this.row = 0; }
    const x = this.x, y = this.y;
    this.x += w + 4; this.row = Math.max(this.row, h);
    const g = this.g; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore();
    return [x / this.W, 1 - (y + h) / this.H, (x + w) / this.W, 1 - y / this.H];
  }
  get used() { return this.y + this.row; }
  texture() { const t = new THREE.CanvasTexture(this.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
}
// 板（幅 w・高さ h [m]）に UV の範囲を当てる
export function panel(w, h, uv) {
  const g = new THREE.PlaneGeometry(w, h), a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + (uv[2] - uv[0]) * a.getX(i), uv[1] + (uv[3] - uv[1]) * a.getY(i));
  return g;
}
// 文字（大きさは高さに対する割合）
function text(g, s, x, y, size, { color = '#fff', weight = 800, align = 'left', base = 'alphabetic', font = FONT, maxW = 0 } = {}) {
  g.fillStyle = color; g.font = `${weight} ${Math.round(size)}px ${font}`; g.textAlign = align; g.textBaseline = base;
  if (maxW) g.fillText(s, x, y, maxW); else g.fillText(s, x, y);
}
// 緑の案内標識の地と白い縁
function guideBase(g, w, h, bg = GREEN) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#f4f4f0'; g.lineWidth = h * 0.025; const m = h * 0.04; g.beginPath(); g.roundRect(m, m, w - 2 * m, h - 2 * m, h * 0.05); g.stroke();
  // うっすら汚れ
  const r = mulberry32(w * 7 + h); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 4 + r() * 30, 2 + r() * 12); }
}
// 路線番号（E20 など）
function shield(g, x, y, s, label, bg = GREEN) {
  g.fillStyle = bg; g.beginPath(); g.roundRect(x, y, s * 1.5, s, s * 0.18); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = s * 0.08; g.stroke();
  text(g, label, x + s * 0.75, y + s * 0.53, s * 0.62, { align: 'center', base: 'middle', weight: 900, font: 'Arial,Helvetica,sans-serif' });
}
// 矢印（下向き = 車線の指定、斜め = 分岐）
function arrow(g, x, y, s, dir = 'down') {
  g.save(); g.translate(x, y); g.rotate({ down: 0, upleft: Math.PI * 0.75, up: Math.PI, left: Math.PI / 2 }[dir] || 0);
  g.fillStyle = '#fff'; g.beginPath();
  g.moveTo(-s * 0.12, -s * 0.5); g.lineTo(s * 0.12, -s * 0.5); g.lineTo(s * 0.12, s * 0.1); g.lineTo(s * 0.3, s * 0.1); g.lineTo(0, s * 0.5); g.lineTo(-s * 0.3, s * 0.1); g.lineTo(-s * 0.12, s * 0.1);
  g.fill(); g.restore();
}

export function buildSigns(ctx, G) {
  const { track, mb, group } = ctx;
  const L = track.length, R = (s) => track.heightAt(s, 0);
  const atlas = ctx.atlas;
  const faces = [];          // [geometry, matrix]
  const steel = MAT.color(0x8d959c, { rough: 0.4, metal: 0.8 }), backC = MAT.color(0x6d747b, { rough: 0.6, metal: 0.5 });
  const frame = new Batch(), backs = new Batch();
  const PX = 104;            // 1 m あたりのピクセル（看板）。アトラス 2048 × 2560 に収まるように

  // ---------------- 門型の標識 ----------------
  // panels: [{ d: 中心の横位置, w, h, draw }]。opp: 反対車線（裏を見る）
  const gantry = (s, panels, { opp = false, beamH = 6.9 } = {}) => {
    const dl = opp ? oppEdges(s).inner - 0.35 : -(wallL(s) - 0.05), dr = opp ? oppEdges(s).wall + 0.05 : wallR(s);
    const span = dr - dl, cx = (dl + dr) / 2;
    const m = at(track, s, 0, 0);
    // 柱（壁の上）と梁（トラス）
    for (const d of [dl, dr]) { frame.add(box(0.4, beamH + 1.0, 0.4, d, 0, 0), m); frame.add(box(0.9, 0.08, 0.9, d, 0.86, 0), m); }
    frame.add(box(span + 0.4, 0.22, 0.22, cx, beamH, 0.0), m);
    frame.add(box(span + 0.4, 0.22, 0.22, cx, beamH + 1.0, 0.0), m);
    for (let x = dl + 0.6; x < dr - 0.4; x += 1.4) { frame.add(box(0.08, 1.0, 0.08, x, beamH, 0), m); frame.add(new THREE.BoxGeometry(0.06, 1.7, 0.06).rotateZ(0.95).translate(x + 0.7, beamH + 0.6, 0), m); }
    for (const p of panels) {
      const y = beamH + 0.5 - p.h / 2 + (p.dy || 0);
      const px = Math.min(PX, 1900 / p.w);   // アトラスの幅に収める
      const uv = atlas.add(Math.round(p.w * px), Math.round(p.h * px), p.draw);
      // 表（-s を向く。反対車線の物は +s を向く）
      const pm = opp ? at(track, s - 0.2, p.d, y, Math.PI) : at(track, s - 0.2, p.d, y);
      faces.push([panel(p.w, p.h, uv), pm.clone().multiply(new THREE.Matrix4().makeTranslation(0, p.h / 2, 0))]);
      backs.add(box(p.w + 0.06, p.h + 0.06, 0.1, 0, -0.03, -0.06), pm);   // 裏（ローカルの -Z = 板の後ろ）
    }
  };
  // 路側の標識（1 本足）。side = -1: 左の路肩の外 / 1: 中央分離帯の上
  const roadSign = (s, side, w, h, draw, { pole = 3.2 } = {}) => {
    const d = side < 0 ? -(wallL(s) + 0.6) : wallR(s);
    const m = at(track, s, d, 0);
    frame.add(box(0.12, pole + h * 0.5, 0.12, 0, 0, -0.1), m);
    const uv = atlas.add(Math.round(w * PX), Math.round(h * PX), draw);
    faces.push([panel(w, h, uv), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, pole + h / 2, 0))]);
    backs.add(box(w + 0.04, h + 0.04, 0.06, 0, pole - 0.02, -0.04), m);
  };

  // ---- 案内標識の中身 ----
  const jctPanel = (dist) => (g, w, h) => {
    guideBase(g, w, h);
    shield(g, w * 0.05, h * 0.1, h * 0.22, 'C4');
    text(g, '拓殖 JCT', w * 0.06, h * 0.62, h * 0.3, { maxW: w * 0.58 });
    text(g, 'Takushoku JCT', w * 0.07, h * 0.86, h * 0.14, { weight: 700 });
    text(g, dist, w * 0.94, h * 0.66, h * 0.28, { align: 'right', font: 'Arial,Helvetica,sans-serif', weight: 900 });
  };
  const cityPanel = (jp, en, dist, route = 'E20') => (g, w, h) => {
    guideBase(g, w, h);
    shield(g, w * 0.08, h * 0.12, h * 0.2, route);
    text(g, jp, w * 0.5, h * 0.58, h * 0.32, { align: 'center' });
    text(g, en, w * 0.5, h * 0.78, h * 0.13, { align: 'center', weight: 700 });
    if (dist) text(g, dist, w * 0.5, h * 0.95, h * 0.13, { align: 'center', font: 'Arial,Helvetica,sans-serif', weight: 900 });
    arrow(g, w * 0.86, h * 0.45, h * 0.42, 'down');
  };
  const branchPanel = (g, w, h) => {
    guideBase(g, w, h);
    shield(g, w * 0.06, h * 0.1, h * 0.2, 'E20');
    text(g, '中央道', w * 0.32, h * 0.5, h * 0.3);
    text(g, '八王子', w * 0.32, h * 0.78, h * 0.22);
    text(g, 'Chuo Expwy  Hachioji', w * 0.32, h * 0.93, h * 0.1, { weight: 700 });
    arrow(g, w * 0.16, h * 0.62, h * 0.42, 'upleft');
  };
  const exitPanel = (dist) => (g, w, h) => {
    guideBase(g, w, h);
    g.fillStyle = '#f2c21b'; g.beginPath(); g.roundRect(w * 0.06, h * 0.12, w * 0.3, h * 0.3, h * 0.04); g.fill();
    text(g, '出口', w * 0.21, h * 0.33, h * 0.17, { align: 'center', color: '#16181b', weight: 900 });
    text(g, 'EXIT', w * 0.21, h * 0.4, h * 0.07, { align: 'center', color: '#16181b', weight: 900, font: 'Arial,sans-serif' });
    text(g, '拓殖', w * 0.42, h * 0.48, h * 0.32);
    text(g, 'Takushoku', w * 0.43, h * 0.68, h * 0.13, { weight: 700 });
    text(g, dist, w * 0.94, h * 0.9, h * 0.22, { align: 'right', font: 'Arial,Helvetica,sans-serif', weight: 900 });
  };
  // 電光の情報板（黒地に橙・緑の文字）
  const vms = (g, w, h) => {
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.04)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
    text(g, '拓殖トンネル', w * 0.04, h * 0.42, h * 0.3, { color: '#ffb02e', weight: 900 });
    text(g, '渋滞なし', w * 0.96, h * 0.42, h * 0.3, { color: '#47e06b', weight: 900, align: 'right' });
    text(g, '東京まで 15分', w * 0.04, h * 0.85, h * 0.3, { color: '#ffb02e', weight: 900 });
    text(g, '安全運転で', w * 0.96, h * 0.85, h * 0.3, { color: '#47e06b', weight: 900, align: 'right' });
  };

  // ---- 門型の標識を並べる ----
  gantry(258, [{ d: -1.75, w: 6.6, h: 3.0, draw: jctPanel('2km') }, { d: 3.6, w: 4.0, h: 3.0, draw: cityPanel('東京', 'Tokyo', '18km') }]);
  gantry(486, [{ d: -1.9, w: 6.2, h: 3.0, draw: (g, w, h) => { jctPanel('1km')(g, w, h); } }, { d: 3.6, w: 4.0, h: 3.0, draw: cityPanel('東京', 'Tokyo', '17km') }]);
  gantry(604, [{ d: 0, w: 9.6, h: 2.0, draw: vms }]);
  gantry(698, [{ d: -2.2, w: 6.0, h: 3.0, draw: branchPanel }, { d: 3.4, w: 4.4, h: 3.0, draw: cityPanel('東京', 'Tokyo', '', 'C4') }]);
  if (L > 1500) {
    gantry(1468, [{ d: -1.0, w: 7.4, h: 3.0, draw: exitPanel('1km') }]);
    gantry(1646, [{ d: -1.0, w: 7.4, h: 3.0, draw: exitPanel('500m') }]);
  }
  // 反対車線の標識（裏が見える）
  for (const s of [380, 1290 + 200]) if (s < L - 20) gantry(s, [{ d: oppEdges(s).lanesIn + 5.2, w: 6.4, h: 3.0, draw: (g, w, h) => { guideBase(g, w, h); text(g, '拓殖', w * 0.5, h * 0.6, h * 0.36, { align: 'center' }); } }], { opp: true });

  // ---- 路側の標識 ----
  const speed = (lim) => (g, w, h) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d32f2f'; g.lineWidth = w * 0.11; g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2); g.stroke();
    text(g, String(lim), w / 2, h * 0.53, h * 0.42, { align: 'center', base: 'middle', color: '#1e3a8a', weight: 900, font: 'Arial,Helvetica,sans-serif' });
  };
  const roundPanel = (w, h, draw) => ({ w, h, draw: (g, W, H) => { g.fillStyle = '#7a8088'; g.fillRect(0, 0, W, H); draw(g, W, H); } });
  for (const s of [140, 760, 1300]) { const p = roundPanel(1.2, 1.2, speed(100)); roadSign(s, -1, p.w, p.h, p.draw); roadSign(s + 2, 1, p.w, p.h, p.draw, { pole: 2.6 }); }
  // トンネルの手前：トンネル名と長さ・ライト点灯
  roadSign(SEC.tunnel0 - 85, -1, 2.6, 1.5, (g, w, h) => { guideBase(g, w, h, '#f4f4f0'); g.strokeStyle = '#1e3a8a'; text(g, '拓殖トンネル', w / 2, h * 0.48, h * 0.3, { align: 'center', color: '#1e3a8a' }); text(g, '長さ 200m', w / 2, h * 0.84, h * 0.24, { align: 'center', color: '#1e3a8a' }); });
  roadSign(SEC.tunnel0 - 60, -1, 1.4, 1.4, (g, w, h) => { g.fillStyle = '#1e5bb8'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); text(g, 'ライト', w / 2, h * 0.45, h * 0.24, { align: 'center' }); text(g, '点灯', w / 2, h * 0.8, h * 0.28, { align: 'center' }); });
  roadSign(SEC.tunnel1 + 50, -1, 3.0, 1.6, exitPanel('2km'));
  roadSign(330, -1, 2.4, 1.6, (g, w, h) => { g.fillStyle = '#1e5bb8'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16); text(g, '車間距離', w / 2, h * 0.45, h * 0.26, { align: 'center' }); text(g, '確認', w / 2, h * 0.82, h * 0.26, { align: 'center' }); });

  // ---- キロポスト（100 m ごと、左の路肩の外） ----
  for (let s = 100; s < L - 5; s += 100) {
    if (wallKind(s) === 'tunnel' || wallKind(s) === 'plaza') continue;
    const km = (12 + s / 1000).toFixed(1);
    const uv = atlas.add(96, 72, (g, w, h) => { g.fillStyle = GREEN; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8); text(g, km, w / 2, h * 0.56, h * 0.5, { align: 'center', base: 'middle', font: 'Arial,sans-serif', weight: 900 }); });
    const m = at(track, s, -(wallL(s) - 0.3), 0);
    faces.push([panel(0.42, 0.32, uv), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.42, 0.02))]);
    frame.add(box(0.06, 1.3, 0.06, 0, 0.3, -0.04), m);
  }
  // ---- 非常電話（約 500 m ごと） ----
  const phoneUV = atlas.add(128, 160, (g, w, h) => { g.fillStyle = '#f39c12'; g.fillRect(0, 0, w, h); text(g, '非常', w / 2, h * 0.36, h * 0.24, { align: 'center', color: '#111', weight: 900 }); text(g, '電話', w / 2, h * 0.66, h * 0.24, { align: 'center', color: '#111', weight: 900 }); text(g, 'SOS', w / 2, h * 0.92, h * 0.18, { align: 'center', color: '#c0392b', weight: 900, font: 'Arial,sans-serif' }); });
  for (const s of [360, 860, 1460, 1960]) {
    if (s > L - 10) continue;
    const m = at(track, s, -(wallL(s) - 0.35), 0, -Math.PI / 2);   // 道の方を向く
    faces.push([panel(0.55, 0.7, phoneUV), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.6, 0.36))]);
    backs.add(box(0.6, 1.1, 0.7, 0, 0.9, 0), m);
    ctx.glow.add(new THREE.OctahedronGeometry(0.1).translate(0, 2.15, 0.1), m, glowRGB(0xff3b1a, 6));
  }
  // ---- 視線誘導標（壁の上の反射板。10 m ごと） ----
  {
    const refl = new THREE.PlaneGeometry(0.08, 0.08).translate(0, 0, 0);
    for (let s = 60; s < L; s += 10) {
      const k = wallKind(s);
      if (k === 'tunnel' || k === 'plaza') continue;
      const hL = k === 'tall' || k === 'jersey' ? 0.95 : 1.18;
      ctx.glow.add(refl, at(track, s, -(wallL(s) - 0.2), hL), glowRGB(0xffffff, 2.2));
      ctx.glow.add(refl, at(track, s, wallR(s) - 0.12, 0.95), glowRGB(0xffa020, 2.2));
    }
  }

  // ---- ゴール（門型＋チェッカーの帯）----
  {
    const sF = ctx.startS + ctx.raceLength;
    const goal = (g, w, h) => {
      g.fillStyle = '#0d0f12'; g.fillRect(0, 0, w, h);
      const n = 24, cw = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f0'; g.fillRect(i * cw, j * h * 0.11, cw, h * 0.11); g.fillRect(i * cw, h * 0.78 + j * h * 0.11, cw, h * 0.11); }
      text(g, 'ゴール  GOAL', w / 2, h * 0.52, h * 0.4, { align: 'center', base: 'middle', color: '#ffd54f', weight: 900 });
    };
    gantry(sF + 1.0, [{ d: -0.75, w: 13.2, h: 2.4, draw: goal, dy: 0.3 }], { beamH: 7.2 });
    const half = HALF;
    group.add(roadDecal(track, sF, 1.6, -half, half, checkerMaterial(Math.round(half * 2 / 0.8), 2)));
    // 両脇の旗のような光（ゴールが遠くから分かるように）
    for (const d of [-(wallL(sF) - 0.05), wallR(sF)]) for (let k = 0; k < 6; k++) ctx.glow.add(new THREE.BoxGeometry(0.16, 0.16, 0.16), at(track, sF + 1.0, d, 1.4 + k * 1.0), glowRGB(k % 2 ? 0xffffff : 0xffc928, 5));
  }

  // ---- まとめる（文字の面は finishSigns でほかの看板と一緒に作る）----
  for (const [g, m] of faces) ctx.signFaces.add(g, m);
  mb.add(frame.build(), steel);
  mb.add(backs.build(), backC);
}

// 文字の面（標識・料金所の看板など、ctx.atlas に描いて ctx.signFaces に足した物）をまとめて 1 つの材質で作る
export function finishSigns(ctx) {
  const g = ctx.signFaces.build(); if (!g) return;
  if (ctx.atlas.used > ctx.atlas.H) console.warn('highway: 看板のアトラスがあふれました', ctx.atlas.used);
  const tex = ctx.atlas.texture();
  const mat = new THREE.MeshStandardMaterial({ name: 'hw-signs', map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.1 });
  const m = new THREE.Mesh(g, mat); m.name = 'hw-signs'; m.matrixAutoUpdate = false; ctx.group.add(m);
  const ng = ctx.neon.faces.build();
  if (ng) { const nt = ctx.neon.atlas.texture(); const nm = new THREE.Mesh(ng, new THREE.MeshBasicMaterial({ name: 'hw-neon', map: nt, color: new THREE.Color(1.7, 1.7, 1.7) })); nm.name = 'hw-neon'; nm.matrixAutoUpdate = false; ctx.group.add(nm); }
}
