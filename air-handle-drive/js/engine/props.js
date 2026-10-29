// 景色の部品（コースの外に置く物）と、たくさん置くための道具。
//   MergeBuilder … 動かない物を材質ごと・区画ごとに 1 つのメッシュにまとめる（描画呼び出しを減らす）
//   Forest       … 木をインスタンシングで大量に置く
//   各部品の関数 … mb（MergeBuilder）と行列（置く位置と向き）を受け取って形を足す
// 部品の向き：+Z が正面（観客席なら客席がコースを向く側）、+Y が上、原点は地面。placeFacing() で正面をコースに向けられる。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, TEX, textTexture, mulberry32 } from './textures.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

// コースの横 d に置き、正面（+Z）をコースの中心線に向ける行列。back: 正面をコースと反対へ
export function placeFacing(track, s, d, h = 0, { back = false, scale = 1, out = new THREE.Matrix4() } = {}) {
  let yaw = d < 0 ? -Math.PI / 2 : Math.PI / 2;
  if (back) yaw += Math.PI;
  return track.placeMatrix(s, d, h, { yaw, scale, out });
}
// ワールドの位置と向き（yaw: Y 軸まわり [rad]）から行列
export function mat4(x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(sx, sy, sz));
}

// ---------- 静的なまとめ描画 ----------
export class MergeBuilder {
  constructor({ cell = 400 } = {}) { this.cell = cell; this.items = new Map(); }
  // geo: BufferGeometry（使い回してよい。中で複製する）, mat: Material, m: Matrix4（省略で単位行列）
  add(geo, mat, m = null, { shadow = true } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    // 模様のない単色の材質は、頂点カラー＋共通の材質にまとめる（色ごとに描画の呼び出しが増えないように）
    const plain = plainKey(mat);
    if (plain) {
      const n = g.attributes.position.count, a = new Float32Array(n * 3), c = mat.color;
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      mat = sharedVC(plain);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(_p);
    const key = Math.floor(c.x / this.cell) + ',' + Math.floor(c.z / this.cell);
    const mk = mat.uuid + (shadow ? 's' : 'n');
    let e = this.items.get(mk); if (!e) this.items.set(mk, e = { mat, shadow, cells: new Map() });
    let arr = e.cells.get(key); if (!arr) e.cells.set(key, arr = []);
    arr.push(g);
    return this;
  }
  // まとめたメッシュを group に入れる
  build(group) {
    let count = 0;
    for (const e of this.items.values()) {
      const vc = !!e.mat.vertexColors;
      for (const arr of e.cells.values()) {
        for (const g of arr) {
          if (vc && !g.attributes.color) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
          if (!vc && g.attributes.color) g.deleteAttribute('color');
        }
        const merged = mergeGeometries(arr);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, e.mat);
        mesh.castShadow = e.shadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
        group.add(mesh); count++;
        arr.forEach((g) => g.dispose());
      }
    }
    this.items.clear();
    return count;
  }
}

// 単色の MeshStandardMaterial なら、粗さ・金属感の段階のキー。まとめられない材質は null
function plainKey(mat) {
  if (!mat || mat.type !== 'MeshStandardMaterial' || mat.vertexColors || mat.transparent || mat.alphaTest > 0 || mat.side !== THREE.FrontSide) return null;
  if (mat.map || mat.normalMap || mat.roughnessMap || mat.emissiveMap || mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null;
  if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0) return null;
  return `r${Math.round(mat.roughness * 5) / 5}m${Math.round(mat.metalness * 4) / 4}`;
}
const vcShared = new Map();
function sharedVC(key) {
  let m = vcShared.get(key);
  if (!m) {
    const r = parseFloat(key.slice(1)), mt = parseFloat(key.split('m')[1]);
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: mt, name: 'vc-' + key });
    vcShared.set(key, m);
  }
  return m;
}

// 頂点カラーを付ける（MergeBuilder で色違いを 1 つの材質にまとめるとき）
export function tint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(), c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);   // 底面が y
let vcMat = null;
export function vertexColorMat() { if (!vcMat) vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, name: 'vc' }); return vcMat; }

// ---------- 木（インスタンシング） ----------
function leafTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const rnd = mulberry32(kind === 'conifer' ? 8 : 9);
  g.clearRect(0, 0, 256, 256);
  if (kind === 'conifer') {
    // 針葉樹のシルエット（枝の重なり）
    for (let layer = 0; layer < 9; layer++) {
      const y = 20 + layer * 26, w = 18 + layer * 13;
      for (let i = 0; i < 26; i++) {
        const x = 128 + (rnd() - 0.5) * 2 * w * (0.4 + rnd() * 0.6), yy = y + rnd() * 30;
        const l = 40 + rnd() * 40;
        g.fillStyle = `rgb(${30 + rnd() * 30 | 0},${70 + rnd() * 50 | 0},${36 + rnd() * 26 | 0})`;
        g.beginPath(); g.ellipse(x, yy, l * 0.12, l * 0.36, (x - 128) / 90, 0, Math.PI * 2); g.fill();
      }
    }
  } else {
    for (let i = 0; i < 700; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 110;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r * 0.9;
      const sh = 0.75 + (1 - r / 110) * 0.15 - (y - 128) / 700;
      g.fillStyle = `rgb(${(50 + rnd() * 45) * sh | 0},${(98 + rnd() * 60) * sh | 0},${(32 + rnd() * 26) * sh | 0})`;
      g.beginPath(); g.ellipse(x, y, 5 + rnd() * 5, 3 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const treeCache = {};
function treeParts(kind) {
  if (treeCache[kind]) return treeCache[kind];
  const rnd = mulberry32(kind.length * 7 + 1);
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(kind), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, name: 'leaf-' + kind });
  const barkMat = MAT.color(0x5a4330, { rough: 0.95 });
  let leaf, trunk;
  const quads = [];
  const quad = (cx, cy, cz, nx, ny, nz, size, rot, center) => {
    // 中心から外を向く四角形。法線は木の中心からの向き（ふんわりした陰影にする）
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    const t = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const b = new THREE.Vector3().crossVectors(n, t);
    t.applyAxisAngle(n, rot); b.applyAxisAngle(n, rot);
    const P = [], N = [], U = [];
    [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]].forEach(([a, c, u, v]) => {
      const p = new THREE.Vector3(cx, cy, cz).addScaledVector(t, a * size / 2).addScaledVector(b, c * size / 2);
      P.push(p.x, p.y, p.z); const nn = p.clone().sub(center).normalize(); nn.y = nn.y * 0.7 + 0.3; nn.normalize(); N.push(nn.x, nn.y, nn.z); U.push(u, v);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); quads.push(g);
  };
  if (kind === 'conifer') {
    const H = 11, center = new THREE.Vector3(0, 5.5, 0);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI;
      const g = new THREE.PlaneGeometry(5.2, H - 1, 1, 1); g.rotateY(a); g.translate(0, 1 + (H - 1) / 2, 0);
      // 法線を外向きに
      const p = g.attributes.position, nrm = g.attributes.normal;
      for (let k = 0; k < p.count; k++) { const v = new THREE.Vector3(p.getX(k), 0, p.getZ(k)); if (v.lengthSq() < 1e-4) v.set(Math.cos(a), 0, -Math.sin(a)); v.normalize(); v.y = 0.35; v.normalize(); nrm.setXYZ(k, v.x, v.y, v.z); }
      quads.push(g);
    }
    void center;
    trunk = new THREE.CylinderGeometry(0.12, 0.22, 2.4, 6).translate(0, 1.2, 0);
  } else if (kind === 'bush') {
    const center = new THREE.Vector3(0, 0.7, 0);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, e = rnd() * 0.9 - 0.1;
      const nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e), nz = Math.sin(a) * Math.cos(e);
      quad(nx * 0.8, 0.7 + ny * 0.5, nz * 0.8, nx, ny, nz, 1.7, rnd() * 6, center);
    }
    trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5).translate(0, 0.2, 0);
  } else {
    const center = new THREE.Vector3(0, 5.2, 0);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, e = rnd() * 1.4 - 0.45;
      const nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e), nz = Math.sin(a) * Math.cos(e);
      quad(nx * 2.1, 5.2 + ny * 1.8, nz * 2.1, nx, ny, nz, 3.0 + rnd() * 0.8, rnd() * 6, center);
    }
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; quad(Math.cos(a) * 0.6, 5.0, Math.sin(a) * 0.6, Math.cos(a), 0.2, Math.sin(a), 3.2, rnd() * 6, center); }
    trunk = mergeGeometries([new THREE.CylinderGeometry(0.16, 0.28, 4.4, 7).translate(0, 2.2, 0), new THREE.CylinderGeometry(0.05, 0.1, 2.0, 5).rotateZ(0.7).translate(0.6, 4.0, 0), new THREE.CylinderGeometry(0.05, 0.1, 2.0, 5).rotateZ(-0.8).translate(-0.6, 4.2, 0.2)].map((g) => g.toNonIndexed()));
  }
  leaf = mergeGeometries(quads.map((g) => g.index ? g.toNonIndexed() : g));
  treeCache[kind] = { leaf, trunk, leafMat, barkMat };
  return treeCache[kind];
}

export class Forest {
  constructor() { this.list = { broadleaf: [], conifer: [], bush: [] }; }
  // kind: 'broadleaf' | 'conifer' | 'bush'
  add(kind, x, y, z, scale = 1, yaw = Math.random() * 6.28, colorJitter = 0) {
    (this.list[kind] || this.list.broadleaf).push([x, y, z, scale, yaw, colorJitter]); return this;
  }
  get count() { return Object.values(this.list).reduce((a, l) => a + l.length, 0); }
  build(group, { shadows = true } = {}) {
    const meshes = [];
    for (const kind in this.list) {
      const L = this.list[kind]; if (!L.length) continue;
      const P = treeParts(kind);
      const leaf = new THREE.InstancedMesh(P.leaf, P.leafMat, L.length), trunk = new THREE.InstancedMesh(P.trunk, P.barkMat, L.length);
      const col = new THREE.Color();
      L.forEach(([x, y, z, s, yaw, cj], i) => {
        _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(s, s * (0.9 + (i % 5) * 0.05), s));
        leaf.setMatrixAt(i, _m); trunk.setMatrixAt(i, _m);
        const k = 0.82 + ((i * 7919) % 100) / 100 * 0.32 + cj;
        leaf.setColorAt(i, col.setRGB(k, k * (0.96 + ((i * 31) % 10) / 100), k * 0.92));
      });
      leaf.castShadow = shadows; trunk.castShadow = shadows; leaf.receiveShadow = true; trunk.receiveShadow = true;
      leaf.name = 'trees-' + kind; trunk.name = 'trunks-' + kind;
      // 軽い画質では表示する本数を減らす（stage.setDensity）。並びは乱数なので先頭から減らしても均一に減る
      leaf.userData.thin = trunk.userData.thin = true; leaf.userData.total = trunk.userData.total = L.length;
      leaf.computeBoundingSphere(); trunk.computeBoundingSphere();
      group.add(leaf); group.add(trunk); meshes.push(leaf, trunk);
    }
    return meshes;
  }
}

// ---------- 部品 ----------
// 観客席（屋根つき）。length: 長さ [m]、rows: 段数。正面（+Z）がコース側
export function grandstand(mb, m, { length = 60, rows = 12, roof = true, color = 0xc62828, sign = null } = {}) {
  const stepH = 0.5, stepD = 0.85, D = rows * stepD, H = rows * stepH;
  const parts = [];
  // 客席の段（観客のテクスチャを段の立ち上がりと座面に）
  const crowd = new THREE.BufferGeometry(), P = [], U = [], I = [];
  for (let r = 0; r < rows; r++) {
    const z0 = D / 2 - r * stepD, y0 = 1.2 + r * stepH;
    const base = P.length / 3;
    // 立ち上がり（前を向く面）と座面
    P.push(-length / 2, y0, z0, length / 2, y0, z0, -length / 2, y0 + stepH, z0, length / 2, y0 + stepH, z0);
    P.push(-length / 2, y0 + stepH, z0, length / 2, y0 + stepH, z0, -length / 2, y0 + stepH, z0 - stepD, length / 2, y0 + stepH, z0 - stepD);
    // 立ち上がりに観客の 1 列ぶん（テクスチャの 1/4）、座面は段の色だけ
    const u = length / 12, v0 = (r % 4) / 4, v1 = v0 + 0.25;
    U.push(0, v0, u, v0, 0, v1, u, v1, 0, v0 + 0.005, u, v0 + 0.005, 0, v0 + 0.02, u, v0 + 0.02);
    I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 4, base + 5, base + 6, base + 5, base + 7, base + 6);
  }
  crowd.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); crowd.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); crowd.setIndex(I); crowd.computeVertexNormals();
  mb.add(crowd.applyMatrix4(m), MAT.crowd());
  // 骨組み（側面の壁・裏の壁・前の壁）
  const wall = MAT.concrete();
  parts.push([box(length, 1.2, 0.3, 0, 0, D / 2 + 0.15), wall]);
  parts.push([box(length, H + 1.4, 0.4, 0, 0, -D / 2 - 0.2), wall]);
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(-D / 2, 0); sh.lineTo(D / 2, 0); sh.lineTo(D / 2, 1.2); sh.lineTo(-D / 2, H + 1.4); sh.lineTo(-D / 2, 0);
    // 形の x（奥行き）→ z、押し出し（厚み 0.4）→ -x の向きになる
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: false }); g.rotateY(-Math.PI / 2); g.translate(sx * length / 2 + 0.2, 0, 0);
    parts.push([g, wall]);
  }
  // 前の手すり
  parts.push([box(length, 0.06, 0.06, 0, 2.2, D / 2 + 0.1), MAT.steel()]);
  if (roof) {
    const rh = H + 5.5;
    const rg = new THREE.BoxGeometry(length + 2, 0.35, D + 3); rg.rotateX(-0.08); rg.translate(0, rh, 0.6);
    parts.push([rg, MAT.color(0xe9ecef, { rough: 0.5, metal: 0.3 })]);
    parts.push([box(length + 2, 0.5, 0.1, 0, rh - 0.3, D / 2 + 2.1), MAT.color(color, { rough: 0.5 })]);
    for (let x = -length / 2; x <= length / 2 + 0.1; x += 12) parts.push([box(0.35, rh, 0.35, x, 0, -D / 2 - 0.2), MAT.steel()]);
  }
  if (sign) {
    const t = textTexture({ w: 1024, h: 128, bg: '#11161d', lines: [{ text: sign, size: 0.62, color: '#ffffff' }] });
    const sm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25 });
    const g = new THREE.PlaneGeometry(Math.min(length * 0.7, 40), Math.min(length * 0.7, 40) / 8); g.translate(0, (roof ? H + 6.3 : H + 2.4), D / 2 + 2.2);
    mb.add(g.applyMatrix4(m), sm, null, { shadow: false });
  }
  for (const [g, mat] of parts) mb.add(g, mat, m);
}

// ピットの建物（ガレージが並ぶ）。正面（+Z）がピットレーン側
export function pitBuilding(mb, m, { length = 90, depth = 14, height = 7, garages = 8, team = 'TAKUDEN FORMULA' } = {}) {
  const parts = [];
  parts.push([box(length, height, depth, 0, 0, -depth / 2), MAT.color(0xeceff1, { rough: 0.6 })]);
  parts.push([box(length + 1, 0.6, depth + 3, 0, height, -depth / 2 + 1.5), MAT.color(0x37474f, { rough: 0.5, metal: 0.4 })]);
  // 2 階のガラス
  parts.push([box(length - 2, 2.2, 0.1, 0, height - 3, 0.02), MAT.color(0x23384d, { rough: 0.08, metal: 0.9 })]);
  const gw = length / garages;
  for (let i = 0; i < garages; i++) {
    const x = -length / 2 + gw * (i + 0.5);
    parts.push([box(gw - 1.6, 3.4, 0.12, x, 0, 0.03), MAT.color(i % 2 ? 0x2b3a46 : 0x31424f, { rough: 0.5, metal: 0.5 })]);
    parts.push([box(gw - 1.4, 0.3, 0.14, x, 3.4, 0.04), MAT.color(0xffc928, { rough: 0.5 })]);
  }
  for (const [g, mat] of parts) mb.add(g, mat, m);
  // 看板（長い建物には何枚か並べる）
  const t = textTexture({ w: 1024, h: 96, bg: '#0f4fb4', lines: [{ text: `PIT  ・  ${team}`, size: 0.6, color: '#ffffff' }] });
  const sm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  const sw = Math.min(28, length * 0.8), n = Math.max(1, Math.floor(length / 60));
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(sw, sw / 10.6); g.translate(-length / 2 + length * (i + 0.5) / n, height - 1.2, 0.08);
    mb.add(g.applyMatrix4(m), sm, null, { shadow: false });
  }
}

// 広告看板。text（または texture）。足つき。正面（+Z）
const adMats = new Map();
export function billboard(mb, m, { w = 8, h = 2, text = 'TAKUDEN FORMULA', bg = '#0f4fb4', fg = '#ffffff', sub = null, legs = 1.2, bg2 = null } = {}) {
  const key = [text, bg, fg, sub, bg2].join('|');
  let mat = adMats.get(key);
  if (!mat) {
    const lines = sub ? [{ text, size: 0.46, color: fg, y: 0.4 }, { text: sub, size: 0.22, color: fg, y: 0.78 }] : [{ text, size: 0.56, color: fg }];
    mat = new THREE.MeshStandardMaterial({ map: textTexture({ w: 1024, h: Math.round(1024 * h / w), bg, bg2, lines }), roughness: 0.55 });
    adMats.set(key, mat);
  }
  const face = new THREE.PlaneGeometry(w, h); face.translate(0, legs + h / 2, 0.06);
  mb.add(face, mat, m, { shadow: false });
  mb.add(box(w + 0.2, h + 0.2, 0.1, 0, legs - 0.1, 0), MAT.darkSteel(), m);
  if (legs > 0) for (const x of [-w * 0.35, w * 0.35]) mb.add(box(0.14, legs, 0.14, x, 0, -0.05), MAT.darkSteel(), m);
}

// スタート・ゴールのゲート（門型の柱＋梁）。lights: 5 組の赤ランプ（setLights(n) で点灯）
// 戻り値: { group, setLights(n) }。group は直接シーンに入れる（ランプが光るので個別の材質）
export function gantry(m, { width = 16, height = 6.5, label = 'TAKUDEN GRAND PRIX', lights = true, checker = false } = {}) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(m); g.matrixWorldNeedsUpdate = true;
  const frameMat = MAT.color(0x2b2f36, { rough: 0.45, metal: 0.6 });
  const add = (geo, mat) => { const x = new THREE.Mesh(geo, mat); x.castShadow = true; x.receiveShadow = true; g.add(x); return x; };
  // 柱と梁（とランプの箱）は 1 つの形にまとめる
  const parts = [box(0.6, height + 1.6, 0.6, -width / 2, 0, 0), box(0.6, height + 1.6, 0.6, width / 2, 0, 0), box(width + 0.6, 1.4, 0.8, 0, height, 0)];
  if (lights) for (let i = 0; i < 5; i++) parts.push(box(0.7, 1.6, 0.4, (i - 2) * 0.95, height - 1.7, 0.3));
  add(mergeGeometries(parts.map((q) => q.toNonIndexed())), frameMat);
  const tex = checker
    ? textTexture({ w: 1024, h: 96, bg: '#ffffff', draw: (c, w, h) => { const n = 32; for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) { c.fillStyle = '#111'; c.fillRect(i * w / n, j * h / 3, w / n, h / 3); } } })
    : textTexture({ w: 1024, h: 96, bg: '#0f4fb4', lines: [{ text: label, size: 0.62, color: '#ffffff' }] });
  const panelGeos = [];
  for (const z of [0.41, -0.41]) { const p = new THREE.PlaneGeometry(width, 1.2); if (z < 0) p.rotateY(Math.PI); p.translate(0, height + 0.7, z); panelGeos.push(p); }
  g.add(new THREE.Mesh(mergeGeometries(panelGeos), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })));
  if (checker) {
    const t2 = textTexture({ w: 512, h: 96, bg: '#d32f2f', lines: [{ text: label || 'FINISH', size: 0.66, color: '#ffffff' }] });
    const pg = [];
    for (const z of [0.42, -0.42]) { const p = new THREE.PlaneGeometry(width * 0.4, 0.75); if (z < 0) p.rotateY(Math.PI); p.translate(0, height - 0.45, z); pg.push(p); }
    g.add(new THREE.Mesh(mergeGeometries(pg), new THREE.MeshStandardMaterial({ map: t2, roughness: 0.5 })));
  }
  // ランプ（5 列 × 2 段 × 前後）は 1 つのインスタンスにまとめ、点灯は色で変える（明るい色はブルームで光る）
  let lamps = null;
  if (lights) {
    lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }), 20);
    lamps.userData.col = [];
    let k = 0;
    for (let i = 0; i < 5; i++) for (let r = 0; r < 2; r++) for (const z of [0.51, 0.09]) {
      const mm = new THREE.Matrix4().compose(new THREE.Vector3((i - 2) * 0.95, height - 0.65 - r * 0.6, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, z < 0.3 ? Math.PI : 0, 0)), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(k, mm); lamps.userData.col.push(i); k++;
    }
    g.add(lamps);
  }
  const off = new THREE.Color(0x2a0505), on = new THREE.Color();
  const api = {
    group: g,
    setLights(n, color = 0xff1010) {
      if (!lamps) return;
      on.setHex(color).multiplyScalar(14);
      lamps.userData.col.forEach((col, k) => lamps.setColorAt(k, col < n ? on : off));
      lamps.instanceColor.needsUpdate = true;
    },
  };
  api.setLights(0);
  return api;
}

// 照明塔
export function lightTower(mb, m, { height = 22 } = {}) {
  mb.add(new THREE.CylinderGeometry(0.22, 0.38, height, 8).translate(0, height / 2, 0), MAT.steel(), m);
  mb.add(box(4, 1.6, 0.4, 0, height, 0), MAT.darkSteel(), m);
  const lamp = new THREE.PlaneGeometry(3.6, 1.2); lamp.translate(0, height + 0.8, 0.22);
  mb.add(lamp, MAT.glow(0xfff4d6, 1.6), m, { shadow: false });
}

// マーシャルポスト（小屋＋旗を持った係員）
export function marshalPost(mb, m) {
  mb.add(box(2.4, 2.4, 2.0), MAT.color(0xeceff1, { rough: 0.6 }), m);
  mb.add(box(2.8, 0.25, 2.4, 0, 2.4, 0), MAT.color(0xf57c00, { rough: 0.5 }), m);
  mb.add(box(1.6, 0.8, 0.05, 0, 1.2, 1.01), MAT.color(0x37474f, { rough: 0.2, metal: 0.6 }), m);
  // 係員
  mb.add(box(0.45, 0.9, 0.3, 1.8, 0.85, 0.6), MAT.color(0xff6d00, { rough: 0.7 }), m);
  mb.add(box(0.4, 0.85, 0.28, 1.8, 0, 0.6), MAT.color(0x263238, { rough: 0.8 }), m);
  mb.add(new THREE.SphereGeometry(0.15, 10, 8).translate(1.8, 1.92, 0.6), MAT.color(0xf1c9a5, { rough: 0.8 }), m);
  mb.add(new THREE.CylinderGeometry(0.02, 0.02, 1.6).rotateZ(-0.5).translate(2.25, 2.0, 0.6), MAT.darkSteel(), m);
  mb.add(new THREE.PlaneGeometry(0.7, 0.5).translate(2.95, 2.55, 0.6), MAT.color(0xffd600, { rough: 0.8 }), m, { shadow: false });
}

// ブレーキの目安の距離看板（150 / 100 / 50）
export function distanceBoard(mb, m, label = '100') {
  const bars = label === '150' ? 3 : label === '100' ? 2 : 1;
  const t = textTexture({ w: 256, h: 320, bg: '#ffffff', border: '#111', lines: [{ text: label, size: 0.28, color: '#111', y: 0.82 }], draw: (g, w, h) => { g.fillStyle = '#111'; for (let i = 0; i < bars; i++) g.fillRect(w * 0.15, h * (0.1 + i * 0.16), w * 0.7, h * 0.09); } });
  const key = 'dist' + label;
  let mat = adMats.get(key); if (!mat) adMats.set(key, mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  mb.add(new THREE.PlaneGeometry(1.0, 1.25).translate(0, 1.6, 0.05), mat, m, { shadow: false });
  mb.add(box(1.05, 1.3, 0.08, 0, 0.95, 0), MAT.darkSteel(), m);
  mb.add(box(0.1, 1.0, 0.1, 0, 0, -0.02), MAT.darkSteel(), m);
}

// カーブの矢印看板（紅白の山形）。dir: 1 = 右カーブ, -1 = 左
export function chevron(mb, m, dir = 1) {
  const key = 'chev' + dir;
  let mat = adMats.get(key);
  if (!mat) {
    const t = textTexture({ w: 256, h: 160, bg: '#ffffff', border: '#222', draw: (g, w, h) => {
      g.fillStyle = '#d32f2f';
      for (let i = 0; i < 2; i++) { const x = 70 + i * 90; g.beginPath();
        if (dir > 0) { g.moveTo(x - 30, 20); g.lineTo(x + 5, 20); g.lineTo(x + 45, 80); g.lineTo(x + 5, 140); g.lineTo(x - 30, 140); g.lineTo(x + 10, 80); }
        else { g.moveTo(x + 45, 20); g.lineTo(x + 10, 20); g.lineTo(x - 30, 80); g.lineTo(x + 10, 140); g.lineTo(x + 45, 140); g.lineTo(x + 5, 80); }
        g.closePath(); g.fill(); }
    } });
    adMats.set(key, mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  }
  mb.add(new THREE.PlaneGeometry(1.6, 1.0).translate(0, 1.4, 0.05), mat, m, { shadow: false });
  mb.add(box(1.65, 1.05, 0.06, 0, 0.88, 0), MAT.darkSteel(), m);
  mb.add(box(0.1, 0.9, 0.1, 0, 0, -0.02), MAT.darkSteel(), m);
}

// テント（学生フォーミュラのパドック）。color: 屋根の色
export function tent(mb, m, { w = 6, d = 6, h = 2.6, color = 0x1565c0, sides = true } = {}) {
  const roofMat = MAT.color(color, { rough: 0.8 });
  const r = new THREE.ConeGeometry(Math.hypot(w, d) / 2, 1.2, 4, 1); r.rotateY(Math.PI / 4); r.scale(w / Math.hypot(w, d) * Math.SQRT2, 1, d / Math.hypot(w, d) * Math.SQRT2); r.translate(0, h + 0.6, 0);
  mb.add(r, roofMat, m);
  mb.add(box(w, 0.3, d, 0, h - 0.3, 0), roofMat, m);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.add(new THREE.CylinderGeometry(0.04, 0.04, h).translate(x * w / 2, h / 2, z * d / 2), MAT.steel(), m);
  if (sides) mb.add(box(w, h - 0.3, 0.03, 0, 0, -d / 2), MAT.color(color, { rough: 0.85 }), m);
}

// ビル（窓の模様つき）。style: 0〜3、night: 窓の明かり
export function building(mb, m, { w = 20, d = 20, h = 40, style = 0, roof = true } = {}) {
  const T = TEX.windows(style);
  const key = 'bld' + style;
  let mat = adMats.get(key);
  if (!mat) adMats.set(key, mat = new THREE.MeshStandardMaterial({ map: T.map, emissiveMap: T.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.45, metalness: 0.3 }));
  // 側面の UV を「4 m × 3.5 m で 1 マス、8×8 マスで 1 枚」にする
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, p = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = nrm.getX(i), nz = nrm.getZ(i), ny = nrm.getY(i);
    const along = Math.abs(nx) > 0.5 ? p.getZ(i) : p.getX(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, 0, 0);
    else uv.setXY(i, along / 32, (p.getY(i) + h / 2) / 28);
    void nz;
  }
  g.translate(0, h / 2, 0);
  mb.add(g, mat, m);
  if (roof) mb.add(box(w * 0.4, 2.5, d * 0.4, 0, h, 0), MAT.color(0x8d959e, { rough: 0.7 }), m);
}
export function buildingMaterials() { return [...adMats.entries()].filter(([k]) => k.startsWith('bld')).map(([, v]) => v); }

// 観覧車（ゆっくり回る）。戻り値 { group, update(dt) }
export function ferrisWheel(m, { radius = 26 } = {}) {
  const g = new THREE.Group(); g.name = 'ferrisWheel'; g.matrixAutoUpdate = false; g.matrix.copy(m);
  const steel = MAT.color(0xf0f0f0, { rough: 0.4, metal: 0.6 });
  const wheel = new THREE.Group(); wheel.position.y = radius + 4; g.add(wheel);
  // 輪とスポークは 1 つの形（回る）、脚も 1 つ（止まっている）、ゴンドラは色違いのインスタンス
  const N = 24, wg = [];
  for (const z of [-1.2, 1.2]) {
    wg.push(new THREE.TorusGeometry(radius, 0.25, 6, 64).translate(0, 0, z));
    wg.push(new THREE.TorusGeometry(radius * 0.55, 0.15, 6, 48).translate(0, 0, z));
  }
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    wg.push(new THREE.CylinderGeometry(0.1, 0.1, radius).rotateZ(a + Math.PI / 2).translate(Math.cos(a) * radius / 2, Math.sin(a) * radius / 2, 0));
  }
  wheel.add(new THREE.Mesh(mergeGeometries(wg.map((q) => q.toNonIndexed())), steel));
  const legs = [];
  for (const sx of [-1, 1]) for (const z of [-3, 3]) {
    const L = Math.hypot(radius * 0.55, radius + 4);
    legs.push(new THREE.CylinderGeometry(0.4, 0.6, L).rotateZ(-sx * Math.atan2(radius * 0.55, radius + 4)).translate(sx * radius * 0.27, (radius + 4) / 2, z));
  }
  g.add(new THREE.Mesh(mergeGeometries(legs.map((q) => q.toNonIndexed())), steel));
  const cabs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 10).rotateX(Math.PI / 2), MAT.color(0xffffff, { rough: 0.4 }), N);
  const cols = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0x8e24aa, 0xfb8c00];
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) cabs.setColorAt(i, c.setHex(cols[i % cols.length]));
  g.add(cabs);
  const mm = new THREE.Matrix4(), v = new THREE.Vector3();
  let rot = 0;
  const place = () => {
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2 + rot;
      mm.makeTranslation(v.set(Math.cos(a) * radius, radius + 4 + Math.sin(a) * radius - 1.3, 0));
      cabs.setMatrixAt(i, mm);
    }
    cabs.instanceMatrix.needsUpdate = true;
  };
  place();
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return { group: g, update(dt) { rot += dt * 0.05; wheel.rotation.z = rot; place(); } };
}

// 歩道橋（コースをまたぐ広告つきの橋）。span: 長さ [m]。橋の向きは +X 方向にコースを横切る
export function footBridge(mb, m, { span = 30, height = 6, text = 'TAKUDEN FORMULA' } = {}) {
  const deck = MAT.color(0xdfe3e8, { rough: 0.6, metal: 0.3 });
  mb.add(box(span, 0.6, 3, 0, height, 0), deck, m);
  for (const sx of [-1, 1]) {
    mb.add(box(1.2, height, 1.2, sx * span / 2, 0, 0), MAT.concrete(), m);
    mb.add(box(span, 1.1, 0.08, 0, height + 0.6, sx * 1.46), MAT.color(0x90a4ae, { rough: 0.3, metal: 0.8 }), m);
  }
  const t = textTexture({ w: 1024, h: 128, bg: '#ffc928', lines: [{ text, size: 0.6, color: '#0f2f6b' }] });
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  for (const sz of [1, -1]) { const g = new THREE.PlaneGeometry(span * 0.8, 1.2); if (sz < 0) g.rotateY(Math.PI); g.translate(0, height - 0.75, sz * 1.52); mb.add(g, mat, m, { shadow: false }); }
}

// 観客（柵の向こうの人の列）。length [m]
export function spectators(mb, m, { length = 20, rows = 2 } = {}) {
  const g = new THREE.PlaneGeometry(length, 1.8 * rows / 2 + 0.6);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length / 12, uv.getY(i) * 0.5 + 0.5);
  g.translate(0, (1.8 * rows / 2 + 0.6) / 2, 0);
  mb.add(g, MAT.crowd(), m, { shadow: false });
}

// 路面に貼る平らな四角（スタートライン・チェッカー・グリッドなど）。track の上 s〜s+len、横 d0〜d1
export function roadDecal(track, s, len, d0, d1, material, { lift = 0.015, steps = 4 } = {}) {
  const P = [], U = [], I = [];
  for (let i = 0; i <= steps; i++) {
    const ss = s + len * i / steps;
    for (const [j, d] of [[0, d0], [1, d1]]) { const p = track.toWorld(ss, d, lift); P.push(p.x, p.y, p.z); U.push(j, i / steps); }
  }
  for (let i = 0; i < steps; i++) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.renderOrder = 1;
  return mesh;
}
export function checkerMaterial(nx = 12, ny = 2) {
  const t = textTexture({ w: 512, h: 128, bg: '#f4f4f0', draw: (g, w, h) => { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if ((i + j) % 2) { g.fillStyle = '#141414'; g.fillRect(i * w / nx, j * h / ny, w / nx + 1, h / ny + 1); } } });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}
