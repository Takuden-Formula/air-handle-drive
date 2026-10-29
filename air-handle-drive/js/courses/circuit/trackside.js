// サーキットの路面とコース脇の「帯」もの：
//   rubberLine   … 走行ライン上のタイヤのゴム（黒ずみ）とブレーキ痕
//   runoffBands  … 舗装のランオフの縁石の外の緑の塗装帯
//   tireBelts    … タイヤバリアの前面のベルト（広告入り）
//   fenceBanners … 金網・ピットウォールの下のコンクリートに貼った広告
//   pitDebrisFence … ピットウォールの上の金網
//   roadPaint    … グリッドの番号・ピットレーンの白線と黄線・速度制限の線
// どれも 1 種類につき 1〜2 回の描画にまとめる。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT } from '../../engine/textures.js';
import { setSlotUV } from './atlas.js';
import { C, box } from './parts.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const inR = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);

// 帯を作る道具：rows = [[{p:[x,y,z], uv:[u,v], c:[r,g,b,a]?}, ...], ...]（同じ列数）
function ribbon(rows, { flip = false, color = false } = {}) {
  if (rows.length < 2) return null;
  const cols = rows[0].length, pos = [], uv = [], col = [], idx = [];
  for (const r of rows) for (const v of r) { pos.push(...v.p); uv.push(...v.uv); if (color) col.push(...(v.c || [1, 1, 1, 1])); }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
    if (!flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// 路面に貼る四角（s〜s+len、横 d0〜d1）の形
export function decalGeo(track, s, len, d0, d1, lift = 0.02, steps = 2) {
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const ss = s + len * i / steps;
    rows.push([[0, d0], [1, d1]].map(([j, d]) => { const p = track.toWorld(ss, d, lift); return { p: [p.x, p.y, p.z], uv: [j, i / steps] }; }));
  }
  return ribbon(rows);
}
function addMesh(ctx, geo, mat, { cast = false, order = 1 } = {}) {
  if (!geo) return null;
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = cast; m.matrixAutoUpdate = false; m.renderOrder = order;
  ctx.group.add(m); return m;
}

// ---------------------------------------------------------------------
// 走行ラインのゴム：コーナーの手前は外、頂点（エイペックス）は内、出口は外へ。曲率の「山の形」から作る。
// ブレーキをかける所（コーナーの手前）と頂点は濃く、直線は薄い。頂点の透明度で表す（vertex color の a）
// ---------------------------------------------------------------------
let rubberMat = null;
function rubberMaterial() {
  if (rubberMat) return rubberMat;
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const g = c.getContext('2d'), img = g.createImageData(64, 512), d = img.data;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const streak = new Float32Array(64); for (let x = 0; x < 64; x++) streak[x] = 0.6 + rnd() * 0.4;
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 64; x++) {
      const u = x / 63;
      // 左右の車輪が通る 2 本の帯（中央は少し薄い）
      const band = Math.exp(-(((u - 0.27) / 0.16) ** 2)) + Math.exp(-(((u - 0.73) / 0.16) ** 2));
      const edge = Math.min(1, Math.min(u, 1 - u) * 6);
      if (rnd() < 0.002) streak[x] = 0.5 + rnd() * 0.5;
      const a = clamp((0.35 + band * 0.75) * edge * streak[x] * (0.85 + rnd() * 0.3), 0, 1);
      const i = (y * 64 + x) * 4; d[i] = 14; d[i + 1] = 13; d[i + 2] = 12; d[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  rubberMat = new THREE.MeshStandardMaterial({
    name: 'rubber', map: t, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.62, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return rubberMat;
}
export function racingLine(track) {
  const n = track.n, ds = track.ds, K = track.kappaS;
  const at = (i) => K[track.closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  const W = Math.round(12 / ds), L1 = Math.round(32 / ds);
  const G = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -W; j <= W; j++) s += at(i + j); G[i] = s / (2 * W + 1); }
  const g = (i) => G[track.closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) { const half = track.half[i]; raw[i] = clamp((g(i) - 0.5 * (g(i - L1) + g(i + L1))) * 230, -1, 1) * half * 0.62; }
  const out = new Float32Array(n), S = Math.round(10 / ds);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -S; j <= S; j++) s += raw[track.closed ? (((i + j) % n) + n) % n : clamp(i + j, 0, n - 1)]; out[i] = s / (2 * S + 1); }
  return out;
}
export function rubberLine(ctx, { width = 2.1 } = {}) {
  const { track } = ctx, n = track.n, ds = track.ds;
  const line = racingLine(track);
  const K = track.kappaS;
  // 濃さ：コーナーの手前 40 m（ブレーキ）と頂点で濃く
  const dens = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let ahead = 0; for (let j = 0; j < 40 / ds; j += 2) ahead = Math.max(ahead, Math.abs(K[(i + j) % n]));
    dens[i] = clamp(0.32 + Math.abs(K[i]) * 14 + ahead * 10, 0.3, 0.95);
  }
  const rows = [];
  const end = track.closed ? n : n - 1;
  for (let i = 0; i <= end; i++) {
    const k = i % n, s = i * ds, d = line[k], a = dens[k];
    rows.push([-1, 0, 1].map((f, j) => {
      const p = track.toWorld(s, d + f * width / 2, 0.008);
      return { p: [p.x, p.y, p.z], uv: [j / 2, s / 24], c: [1, 1, 1, a] };
    }));
  }
  addMesh(ctx, ribbon(rows, { color: true }), rubberMaterial(), { order: 2 });
}

// ---------------------------------------------------------------------
// 舗装のランオフ：縁石の外 2 m を緑に塗る（実在のサーキットと同じ。はみ出したのが分かりやすい）
// ---------------------------------------------------------------------
let bandMat = null;
export function runoffBands(ctx, { width = 2.0 } = {}) {
  const { track } = ctx, n = track.n, ds = track.ds;
  if (!bandMat) bandMat = new THREE.MeshStandardMaterial({ name: 'runoff-green', color: 0x2f6e3c, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const geos = [];
  for (const side of [-1, 1]) {
    let rows = [];
    const flush = () => { const g = ribbon(rows, { flip: side < 0 }); if (g) geos.push(g); rows = []; };
    for (let i = 0; i <= n; i++) {
      const s = (i % n) * ds, e = track.edgeAt(s, side);
      if (!(e.runoff === 'asphalt' && e.kerb > 0.3 && e.runoffW > width + 1.5)) { flush(); continue; }
      const inner = track.halfWidth(s) + e.kerb;
      rows.push([0, 1].map((f) => { const d = side * (inner + 0.05 + f * width), p = track.toWorld(s, d, -0.02 - (f * width / e.runoffW) * 0.04 + 0.012); return { p: [p.x, p.y, p.z], uv: [f, s / 4] }; }));
    }
    flush();
  }
  if (geos.length) addMesh(ctx, mergeGeometries(geos), bandMat);
}

// ---------------------------------------------------------------------
// タイヤバリアの前のベルト（紅白・青の広告）。アトラスの 16:1 の帯を半分ずつ貼る
// ---------------------------------------------------------------------
export function tireBelts(ctx, A, { h0 = 0.12, h1 = 0.86, panel = 5.9 } = {}) {
  const { track, mb } = ctx;
  const n = track.n, ds = track.ds, geos = [];
  for (const side of [-1, 1]) {
    let run = [];
    const flush = () => {
      if (run.length > 3) {
        const s0 = run[0], s1 = run[run.length - 1], len = s1 - s0, np = Math.max(1, Math.round(len / panel)), pl = len / np;
        for (let k = 0; k < np; k++) {
          const slot = A.get(((Math.round(s0) + k) >> 2) % 2 ? 'belt-blue' : 'belt-takuden');
          const steps = Math.max(1, Math.ceil(pl / 1.5)), rows = [];
          for (let q = 0; q <= steps; q++) {
            const s = s0 + pl * (k + q / steps), d = side * (track.barrierD(track.wrap(s), side) - 0.13);
            rows.push([h0, h1].map((h) => { const p = track.toWorld(s, d, h); return { p: [p.x, p.y, p.z], uv: [(k % 2) * 0.5 + q / steps * 0.5, h === h0 ? 0 : 1] }; }));
          }
          // 列 = 下・上、行 = 進む向き。そのままだと左を向く面なので、左側の壁は裏返してコースに向ける
          const g = ribbon(rows, { flip: side < 0 });
          if (g) { setSlotUV(g, slot, side > 0); geos.push(g); }
        }
      }
      run = [];
    };
    for (let i = 0; i <= n; i++) {
      const s = i * ds, e = track.edgeAt(track.wrap(s), side);
      if (i < n && e.barrier === 'tires') run.push(s); else flush();
    }
  }
  if (geos.length) mb.add(mergeGeometries(geos), A.material(), null, { shadow: false });
}

// ---------------------------------------------------------------------
// 金網（fence）とピットウォール（wall）の下のコンクリートの広告
// ---------------------------------------------------------------------
export function fenceBanners(ctx, A) {
  const { track, mb } = ctx;
  const n = track.n, ds = track.ds, geos = [];
  const names = ['ad-takuden', 'ad-univ', 'ad-ev', 'ad-zero', 'ad-sf', 'ad-36kw', 'ad-circuit', 'ad-race', 'ad-univ2', 'ad-gp', 'ad-charge', 'ad-safety'];
  let ad = 0;
  for (const side of [-1, 1]) for (const [type, off, h0, h1] of [['fence', 0.17, 0.1, 0.92], ['wall', 0.12, 0.3, 0.9]]) {
    let run = [];
    const flush = () => {
      if (run.length > 6) {
        const s0 = run[0], s1 = run[run.length - 1], pl = (h1 - h0) * 8 + 0.3, np = Math.floor((s1 - s0) / pl);
        for (let k = 0; k < np; k++) {
          const slot = A.get(names[ad++ % names.length]);
          const rows = [], steps = 3;
          for (let q = 0; q <= steps; q++) {
            const s = s0 + (s1 - s0 - np * pl) / 2 + pl * k + 0.15 + (pl - 0.3) * q / steps, d = side * (track.barrierD(track.wrap(s), side) - off);
            rows.push([h0, h1].map((h) => { const p = track.toWorld(s, d, h); return { p: [p.x, p.y, p.z], uv: [q / steps, h === h0 ? 0 : 1] }; }));
          }
          const g = ribbon(rows, { flip: side < 0 });
          if (g) { setSlotUV(g, slot, side > 0); geos.push(g); }
        }
      }
      run = [];
    };
    for (let i = 0; i <= n; i++) {
      const s = i * ds, e = track.edgeAt(track.wrap(s), side);
      if (i < n && e.barrier === type) run.push(s); else flush();
    }
  }
  if (geos.length) mb.add(mergeGeometries(geos), A.material(), null, { shadow: false });
}

// ---------------------------------------------------------------------
// ピットウォールの上の金網（デブリフェンス）と支柱
// ---------------------------------------------------------------------
export function pitDebrisFence(ctx, s0, s1, { h0 = 0.95, h1 = 3.3 } = {}) {
  const { track, mb } = ctx;
  const rows = [], posts = [];
  for (let s = s0; s <= s1; s += 1) {
    const ss = track.wrap(s), d = track.barrierD(ss, 1) + 0.05;
    rows.push([h0, h1].map((h, j) => { const p = track.toWorld(ss, d, h); return { p: [p.x, p.y, p.z], uv: [s / 3, j * 1.2] }; }));
    if (Math.round(s) % 4 === 0) { const p = track.toWorld(ss, d, h0); posts.push(box(0.08, h1 - h0 + 0.2, 0.08).rotateY(-track.headingAt(ss)).translate(p.x, p.y, p.z)); }
  }
  addMesh(ctx, ribbon(rows), MAT.fence(), { order: 0 });
  if (posts.length) mb.add(mergeGeometries(posts.map((g) => g.toNonIndexed())), C.metal(0x9aa3ab));
}

// ---------------------------------------------------------------------
// 路面のペイント：グリッドの番号、ピットレーンの線（白・黄）、速度制限の線
// ---------------------------------------------------------------------
let numMat = null;
function numberMaterial() {
  if (numMat) return numMat;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const g = c.getContext('2d'); g.clearRect(0, 0, 1024, 128);
  g.fillStyle = '#f2f2ee'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 112px "Meiryo","IPAGothic",sans-serif';
  for (let i = 0; i < 8; i++) g.fillText(String(i + 1), i * 128 + 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  numMat = new THREE.MeshStandardMaterial({ name: 'grid-numbers', map: t, transparent: true, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  return numMat;
}
export function roadPaint(ctx, sLine, { pitS = 96, pitLen = 150, garages = 15 } = {}) {
  const { track, layout } = ctx, L = track.length, M = layout.marks;
  const half = track.halfWidth(sLine);
  // グリッドの番号（枠の前、車の向きに読める向き）
  const ng = [];
  for (let i = 0; i < 6; i++) {
    const s = sLine - 8 - i * 8, d = (i % 2 ? 1 : -1) * half * 0.35;
    const dn = d + (i % 2 ? 1 : -1) * 1.9;
    const g = decalGeo(track, s - 1.7, 1.4, dn - 0.55, dn + 0.55, 0.02, 1);
    // decalGeo の uv: u = 横（0〜1）、v = 進む向き。文字を進む向きに読むには u ↔ 横、v ↔ 縦
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); uv.setXY(k, (i + u) / 8, v); }
    ng.push(g);
  }
  addMesh(ctx, mergeGeometries(ng), numberMaterial(), { order: 3 });
  // グリッドの枠（白いかぎ形。common.js の startArea と同じ形を 1 つにまとめる）
  const grid = [];
  for (let i = 0; i < 6; i++) {
    const s = sLine - 8 - i * 8, d = (i % 2 ? 1 : -1) * half * 0.35;
    grid.push(decalGeo(track, s, 0.25, d - 1.0, d + 1.0, 0.02, 1), decalGeo(track, s - 1.6, 1.6, d - 1.0, d - 0.8, 0.02, 1), decalGeo(track, s - 1.6, 1.6, d + 0.8, d + 1.0, 0.02, 1));
  }
  // ピットレーンの線（白：本線とピットレーンの境・速度制限の線、黄：ガレージ前の作業エリア）
  const pitD1 = layout.pitD1 ?? (half + 15.5), wallD = track.barrierD(90, 1);
  const white = [...grid], yellow = [];
  // コースの右端の白線（1 周つながった帯）。circuit.js の trackStyle.markings の説明を参照
  {
    const rows = [], n = track.n, w = 0.2, inset = 0.25;
    for (let i = 0; i <= n; i++) {
      const s = i * track.ds, hw = track.halfWidth(s), dc = hw - inset - w / 2;
      rows.push([dc - w / 2, dc + w / 2].map((d, j) => { const p = track.toWorld(s, d, 0.012); return { p: [p.x, p.y, p.z], uv: [j, s] }; }));
    }
    white.push(ribbon(rows));
  }
  const sA = L - 34, sB = M.T1 + 12;
  // ピットの速い車線と作業エリアの境（白の実線）
  for (let s = sA; s < L + sB; s += 10) white.push(decalGeo(track, s, Math.min(10, L + sB - s), pitD1 - 5.2, pitD1 - 5.0, 0.03, 4));
  // 速度制限の線（ピットの入口・出口）
  for (const s of [L - 30, M.T1 + 8]) white.push(decalGeo(track, s, 0.5, wallD + 0.3, pitD1, 0.03, 1));
  // ガレージ前の黄色い区切り
  for (let s = pitS - pitLen / 2; s <= pitS + pitLen / 2 + 0.1; s += pitLen / garages) yellow.push(decalGeo(track, s - 0.1, 0.2, pitD1 - 4.8, pitD1 - 0.2, 0.03, 1));
  // ピットの出口の黄色い線（コースに合流するまで）
  for (let s = M.T1 + 8; s < M.T1 + 38; s += 5) { const f = (s - M.T1 - 8) / 30; const d = pitD1 - 5.1 - f * (pitD1 - 5.1 - (half + 1.2)); yellow.push(decalGeo(track, s, 5, d - 0.1, d + 0.1, 0.03, 2)); }
  for (let s = L - 70; s < L - 34; s += 4) { const f = (s - (L - 70)) / 36; const d = (half + 1.2) + f * (pitD1 - 5.1 - (half + 1.2)); yellow.push(decalGeo(track, s, 4, d - 0.1, d + 0.1, 0.03, 2)); }
  addMesh(ctx, mergeGeometries(white.filter(Boolean)), MAT.line(), { order: 1 });
  addMesh(ctx, mergeGeometries(yellow.filter(Boolean)), MAT.lineYellow(), { order: 1 });
}

// ---------------------------------------------------------------------
// ランオフの舗装に描いた大きなロゴ（中継カメラ・ヘリから見える）。コース側が文字の下になる向き
// ---------------------------------------------------------------------
let logoMat = null;
function logoMaterial() {
  if (logoMat) return logoMat;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'); g.clearRect(0, 0, 1024, 256);
  g.fillStyle = 'rgba(240,240,236,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'italic 900 200px "Meiryo","IPAGothic",sans-serif'; g.fillText('TAKUDEN', 512, 136, 980);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  logoMat = new THREE.MeshStandardMaterial({ name: 'runoff-logo', map: t, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  return logoMat;
}
export function runoffLogos(ctx, spots) {
  const { track } = ctx, geos = [];
  for (const { s, side, len = 22 } of spots) {
    const e = track.edgeAt(s, side), half = track.halfWidth(s);
    if (e.runoff !== 'asphalt' || e.runoffW < 8) continue;
    const dNear = half + e.kerb + 2.4, dFar = Math.min(half + e.kerb + e.runoffW - 0.8, dNear + len / 4);
    const rows = [], steps = 12;
    for (let i = 0; i <= steps; i++) {
      const ss = s - len / 2 + len * i / steps, f = i / steps;
      rows.push([dNear, dFar].map((d) => {
        const fw = (Math.abs(d) - dNear) / (dFar - dNear), rw = e.runoffW;
        const p = track.toWorld(ss, side * d, -0.02 - ((d - half - e.kerb) / rw) * 0.04 + 0.016);
        return { p: [p.x, p.y, p.z], uv: [side < 0 ? f : 1 - f, fw] };
      }));
    }
    geos.push(ribbon(rows, { flip: side < 0 }));
  }
  if (geos.length) addMesh(ctx, mergeGeometries(geos.filter(Boolean)), logoMaterial(), { order: 2 });
}
