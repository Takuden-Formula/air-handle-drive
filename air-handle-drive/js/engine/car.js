// 自車：チーム実車のパイプフレーム（models/car.glb）に、カウル・タイヤ・サスペンション・ウイング・ドライバー・ランプを手続きで付ける。
// car.glb は「フレームだけ・1 メッシュ・法線なし・mm 単位・+X が前」。KHR_materials_pbrSpecularGlossiness は three r170 が読まないので
// マテリアルはここで差し替える。
// 車のローカル座標: 原点 = 前後の車軸の真ん中の地面、-Z が前、+X が右、+Y が上（単位 m）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { textTexture, TEX } from './textures.js';

// 寸法 [m]
export const CAR_DIM = {
  wheelbase: 1.6, trackF: 1.22, trackR: 1.18, tireR: 0.265, tireW: 0.2, rimR: 0.178,
  frameShiftZ: 1.05,   // フレームのモデル座標 x = 1.05 m を前後の中心にする
  frameLift: 0.04,     // 地上高
};
export const LIVERY = {
  body: 0x0f4fb4, accent: 0xffc928, stripe: 0xf4f6f8, frame: 0xe8eaee, carbon: 0x15171a, number: '21',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- マテリアル ----------
function carbonTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#121416'; g.fillRect(0, 0, 128, 128);
  const n = 8, s = 128 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const on = (x + y) % 2 === 0;
    const gr = on ? g.createLinearGradient(x * s, 0, x * s + s, 0) : g.createLinearGradient(0, y * s, 0, y * s + s);
    gr.addColorStop(0, '#0d0f11'); gr.addColorStop(0.5, on ? '#2a2e33' : '#22262a'); gr.addColorStop(1, '#0d0f11');
    g.fillStyle = gr; g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(6, 6); t.anisotropy = 4;
  return t;
}

function makeMaterials(liv) {
  const carbonMap = carbonTexture();
  return {
    frame: new THREE.MeshPhysicalMaterial({ color: liv.frame, roughness: 0.32, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    paint: new THREE.MeshPhysicalMaterial({ color: liv.body, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paintAccent: new THREE.MeshPhysicalMaterial({ color: liv.accent, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
    paintWhite: new THREE.MeshPhysicalMaterial({ color: liv.stripe, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: carbonMap, roughness: 0.38, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.88, metalness: 0 }),
    tireWall: new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.75, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.28, metalness: 0.9 }),
    rimLip: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.18, metalness: 1 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.35, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xd8282a, roughness: 0.35, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e2125, roughness: 0.6, metalness: 0.4 }),
    motor: new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.4, metalness: 0.8 }),
    battery: new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.5, metalness: 0.5 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.5 }),   // 高電圧ケーブル
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf5f5f5, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, roughness: 0.05, metalness: 0.9, clearcoat: 1 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.8 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.8 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x400606, emissive: 0xff1a1a, emissiveIntensity: 0.15, roughness: 0.3 }),
    tsal: new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0xff2a10, emissiveIntensity: 0, roughness: 0.3 }),
    blur: new THREE.MeshBasicMaterial({ color: 0x1a1b1e, transparent: true, opacity: 0, depthWrite: false }),
    shadow: new THREE.MeshBasicMaterial({ map: TEX.blobShadow(), transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  };
}

// ---------- 形を作る道具 ----------
// 断面（[x, y] の点列、同じ点数）を z に沿って並べた筒。sections: [{ z, pts }]
function loft(sections, { closeEnds = true } = {}) {
  const m = sections[0].pts.length, pos = [], uv = [], idx = [];
  sections.forEach((sec, i) => sec.pts.forEach(([x, y], j) => { pos.push(x, y, sec.z); uv.push(j / m, i / (sections.length - 1)); }));
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + (j + 1) % m, c = a + m, d = b + m;
    idx.push(a, b, c, b, d, c);
  }
  if (closeEnds) {
    for (const [k, flip] of [[0, false], [sections.length - 1, true]]) {
      const sec = sections[k]; let cx = 0, cy = 0; sec.pts.forEach(([x, y]) => { cx += x; cy += y; }); cx /= m; cy /= m;
      const c = pos.length / 3; pos.push(cx, cy, sec.z); uv.push(0.5, k ? 1 : 0);
      for (let j = 0; j < m; j++) { const a = k * m + j, b = k * m + (j + 1) % m; if (flip) idx.push(c, a, b); else idx.push(c, b, a); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// 角の丸い四角（超楕円）の断面。dip > 0 で上面の中央をへこませる（コックピットの開口）
function section(w, h, yc, { n = 40, p = 3.2, dip = 0, dipW = 0.7, yb = null } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;   // 下の中央から反時計回り…（x = cos, y = sin）
    const c = Math.cos(a), s = Math.sin(a);
    let x = Math.sign(c) * Math.abs(c) ** (2 / p) * w / 2;
    let y = yc + Math.sign(s) * Math.abs(s) ** (2 / p) * h / 2;
    if (yb != null && s < 0) y = Math.max(y, yb);
    if (dip > 0 && s > 0) { const u = Math.abs(x) / (w / 2 * dipW); y -= dip * clamp(1 - u ** 6, 0, 1); }
    pts.push([x, y]);
  }
  return pts;
}
// 翼の断面（NACA 風）を幅方向に押し出す。chord: 弦長、t: 厚み比、aoa: 迎え角 [rad]（+ で後ろ下がり=ダウンフォース）
function airfoil(chord, t, span, aoa) {
  const n = 18, top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos(i / n * Math.PI)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camber = 0.06 * x * (1 - x) * 4;
    top.push([x, camber + yt]); bot.push([x, camber - yt]);
  }
  const shape = new THREE.Shape();
  const P = (x, y) => [x * chord, -y * chord];   // 上下を逆にした翼（下面が膨らむ＝ダウンフォース）
  shape.moveTo(...P(...top[0]));
  for (let i = 1; i <= n; i++) shape.lineTo(...P(...top[i]));
  for (let i = n; i >= 0; i--) shape.lineTo(...P(...bot[i]));
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -span / 2);
  // 押し出しは z 方向 → 幅（x）方向へ。翼の弦は z（後ろ = +z）
  g.rotateY(-Math.PI / 2);     // 弦: x → z, 幅: z → x
  g.rotateX(-aoa);             // 後ろ上がり
  g.computeVertexNormals();
  return g;
}
function cyl(r1, r2, len, seg = 10) { return new THREE.CylinderGeometry(r1, r2, len, seg, 1); }
// 2 点を結ぶ棒
function rod(a, b, r, mat, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const m = new THREE.Mesh(cyl(r, r, L, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// ---------- 車 ----------
export class Car {
  constructor(livery = LIVERY) {
    this.livery = { ...LIVERY, ...livery };
    this.root = new THREE.Group(); this.root.name = 'car';
    this.body = new THREE.Group(); this.body.name = 'sprung';     // バネの上（ロール・ピッチする）
    this.root.add(this.body);
    this.wheels = [];
    this.mats = makeMaterials(this.livery);
    this.spin = 0; this.blink = 0; this._roll = 0; this._pitch = 0; this._steer = 0; this._bump = 0;
    this.loaded = false;
  }

  static async create(url = './models/car.glb', livery) {
    const c = new Car(livery);
    await c.load(url);
    return c;
  }

  async load(url) {
    let frameGeo = null;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.traverse((o) => { if (o.isMesh && !frameGeo) frameGeo = o.geometry; });
    } catch (e) { console.warn('car.glb を読めません（フレームなしで続けます）: ' + e.message); }
    if (frameGeo) this._addFrame(frameGeo);
    else this.env = defaultEnvelope();
    this._addBody(); this._addWheels(); this._addSuspension(); this._addWings(); this._addPowertrain(); this._addDriver(); this._addLights();
    // 足もとの影（影なしの軽量画質でも車が浮いて見えないように）
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.6).rotateX(-Math.PI / 2), this.mats.shadow);
    sh.position.y = 0.02; sh.renderOrder = 1; this.root.add(sh); this.contactShadow = sh;
    this._mergeStatic();
    this.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o !== sh) { o.castShadow = true; o.receiveShadow = true; } });
    this.loaded = true;
  }

  // 動かない部品を材質ごとに 1 つのメッシュにまとめる（描画の呼び出し回数を減らす）
  // 模様のない単色の材質は、頂点カラー＋共通の材質（粗さ・金属感・クリアコートが同じ物どうし）にまとめる
  _mergeStatic() {
    this._mergeGroup(this.body, [this.head, this.steeringWheel]);
    if (this.head) this._mergeGroup(this.head, []);
    if (this.steeringWheel) this._mergeGroup(this.steeringWheel, []);
  }
  _mergeGroup(group, skip) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map(), remove = [];
    const vcMats = this._vcMats || (this._vcMats = new Map());
    group.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material) || o.name === 'frame') return;
      for (let p = o.parent; p && p !== group; p = p.parent) if (skip.includes(p)) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(_mm.multiplyMatrices(inv, o.matrixWorld));
      let mat = o.material;
      const plain = !mat.map && !mat.transparent && !(mat.emissive && mat.emissive.getHex() && mat.emissiveIntensity > 0) && !mat.vertexColors;
      if (plain) {
        const n = g.attributes.position.count, a = new Float32Array(n * 3), c = mat.color;
        for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        const key = `${mat.type}|${Math.round(mat.roughness * 5)}|${Math.round(mat.metalness * 2)}|${Math.round((mat.clearcoat || 0) * 2)}`;
        let vm = vcMats.get(key);
        if (!vm) { vm = mat.clone(); vm.color.set(0xffffff); vm.vertexColors = true; vm.name = 'vc-' + key; vcMats.set(key, vm); }
        mat = vm;
      } else if (g.attributes.color) g.deleteAttribute('color');
      let a = byMat.get(mat); if (!a) byMat.set(mat, a = []);
      a.push(g); remove.push(o);
    });
    for (const o of remove) o.parent.remove(o);
    for (const [mat, list] of byMat) {
      const g = mergeGeometries(list); if (!g) continue;
      const m = new THREE.Mesh(g, mat); m.name = 'body-' + (mat.name || mat.type); group.add(m);
    }
  }

  // フレーム（GLB）を車の座標に直し、白い粉体塗装に。外形（断面の大きさ）も調べて、カウルの寸法に使う
  _addFrame(src) {
    let g = src.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g = mergeVertices(g, 0.5);             // mm 単位で 0.5 mm 以内の点をまとめる → なめらかな法線
    g.scale(0.001, 0.001, 0.001);
    g.rotateY(Math.PI / 2);                // モデルの +X（前）→ -Z
    g.translate(0, CAR_DIM.frameLift, CAR_DIM.frameShiftZ);
    g.computeVertexNormals();
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, this.mats.frame); m.name = 'frame';
    this.body.add(m);
    // 外形を 5 cm ごとに調べる
    const pos = g.attributes.position, bins = new Map(), B = 0.05;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = Math.round(z / B);
      let b = bins.get(k); if (!b) bins.set(k, b = { w: 0, y0: 9, y1: -9 });
      b.w = Math.max(b.w, Math.abs(x)); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
    const bb = g.boundingBox;
    this.env = { bins, B, zFront: bb.min.z, zRear: bb.max.z, top: bb.max.y };
  }
  _envAt(z) {
    const e = this.env; if (!e.bins) return { w: 0.25, y0: 0.04, y1: 0.5 };
    let b = null;
    for (let d = 0; d < 6 && !b; d++) b = e.bins.get(Math.round(z / e.B) + d) || e.bins.get(Math.round(z / e.B) - d);
    return b || { w: 0.2, y0: 0.04, y1: 0.4 };
  }

  // カウル（ノーズ・コックピットの周り・サイドポンツーン）
  _addBody() {
    const M = this.mats, e = this.env;
    const zF = e.zFront ?? -1.35;
    // フレームの外形より少し大きく。コックピット（メインフープ〜フロントフープ）は上をへこませる
    const secs = [];
    const zMainHoop = 0.23, zFrontHoop = -0.57;
    // フレームの上端を前後 ±0.15 m で最大にした線（パイプがカウルから飛び出さないように）
    const topAt = (z) => { let m = 0; for (let d = -0.15; d <= 0.15; d += 0.05) m = Math.max(m, this._envAt(z + d).y1); return m; };
    for (let z = zMainHoop + 0.06; z >= zF - 0.02; z -= 0.08) {
      const en = this._envAt(z);
      const inCock = z > zFrontHoop + 0.02;
      const w = en.w * 2 + 0.05 + (inCock ? 0.12 : 0);
      const top = inCock ? 0.46 : topAt(z) + 0.035;
      const yb = CAR_DIM.frameLift + 0.01;
      const h = top - yb;
      secs.push({ z, pts: section(w, h, yb + h / 2, { dip: inCock ? 0.2 : 0, dipW: 0.66, p: 3.4 }) });
    }
    // ノーズ（フロントバルクヘッドの先）
    const nose = [[zF - 0.08, 0.36, 0.36, 0.22], [zF - 0.2, 0.3, 0.29, 0.2], [zF - 0.32, 0.22, 0.2, 0.17], [zF - 0.42, 0.13, 0.12, 0.14], [zF - 0.47, 0.05, 0.05, 0.12]];
    for (const [z, w, h, yc] of nose) secs.push({ z, pts: section(w, h, yc, { p: 2.6 }) });
    secs.sort((a, b) => a.z - b.z);
    const tub = new THREE.Mesh(loft(secs), M.paint); tub.name = 'tub';
    this.body.add(tub);
    // 白と黄色のライン（ノーズの上の帯）
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.9), M.paintWhite);
    stripe.position.set(0, 0.56, zF + 0.32); stripe.rotation.x = 0.17; this.body.add(stripe);
    // サイドポンツーン（コックピットの両脇。冷却用の開口つき）
    for (const sx of [-1, 1]) {
      const sp = [];
      for (const [z, w, h] of [[0.2, 0.18, 0.28], [0.05, 0.24, 0.34], [-0.25, 0.26, 0.36], [-0.5, 0.2, 0.3], [-0.62, 0.08, 0.2]]) {
        sp.push({ z, pts: section(w, h, 0.06 + h / 2, { p: 3 }).map(([x, y]) => [sx * (0.36 + w / 2) + x, y]) });
      }
      sp.sort((a, b) => a.z - b.z);
      const pod = new THREE.Mesh(loft(sp), M.paint); this.body.add(pod);
      // ラジエータの口（黒）
      const inlet = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.2), M.dark);
      inlet.position.set(sx * 0.48, 0.22, -0.63); inlet.rotation.y = Math.PI; this.body.add(inlet);
      // 黄色のアクセントライン
      const ac = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.035, 0.7), M.paintAccent);
      ac.position.set(sx * (0.36 + 0.26), 0.26, -0.2); this.body.add(ac);
      // ゼッケン（横）
      const numMat = this._numMat || (this._numMat = new THREE.MeshStandardMaterial({ map: textTexture({ w: 256, h: 200, bg: '#ffffff', border: '#111', lines: [{ text: this.livery.number, size: 0.8, color: '#111' }] }), roughness: 0.4 }));
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), numMat);
      num.position.set(sx * (0.36 + 0.265), 0.22, -0.18); num.rotation.y = sx * Math.PI / 2; this.body.add(num);
    }
    // フロア（アンダートレイ）
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.012, 1.6), M.carbon);
    floor.position.set(0, 0.035, -0.2); this.body.add(floor);
    // ノーズ上のチーム名
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.07), new THREE.MeshStandardMaterial({ map: textTexture({ w: 512, h: 112, bg: '#0f4fb4', lines: [{ text: 'TAKUDEN', size: 0.75, color: '#ffffff' }] }), roughness: 0.35 }));
    logo.rotation.x = -Math.PI / 2 + 0.2; logo.position.set(0, 0.58, zF + 0.05); this.body.add(logo);
  }

  // タイヤ・ホイール・ブレーキ
  _addWheels() {
    const D = CAR_DIM, M = this.mats;
    // タイヤ（断面を回転させる）
    const pts = [];
    const R = D.tireR, W = D.tireW, r0 = D.rimR + 0.01;
    const prof = [[r0, -W / 2 + 0.01], [R - 0.03, -W / 2], [R - 0.008, -W / 2 + 0.02], [R, -W / 2 + 0.05], [R, W / 2 - 0.05], [R - 0.008, W / 2 - 0.02], [R - 0.03, W / 2], [r0, W / 2 - 0.01]];
    for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
    const tireG = new THREE.LatheGeometry(pts, 40); tireG.rotateZ(Math.PI / 2);   // 軸を X に
    // ホイール（スポーク 10 本）
    const rimParts = [];
    const barrel = new THREE.CylinderGeometry(D.rimR, D.rimR, W - 0.02, 32, 1, true); barrel.rotateZ(Math.PI / 2); rimParts.push(barrel);
    const hub = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 16); hub.rotateZ(Math.PI / 2); hub.translate(0.03, 0, 0); rimParts.push(hub);
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.BoxGeometry(0.018, D.rimR - 0.045, 0.026);
      sp.translate(0.035, (D.rimR - 0.045) / 2 + 0.04, 0); sp.rotateX((i / 10) * Math.PI * 2 + (i % 2) * 0.12);
      rimParts.push(sp);
    }
    const rimG = mergeGeometries(rimParts.map((g) => g.index ? g.toNonIndexed() : g));
    const lipG = new THREE.TorusGeometry(D.rimR, 0.008, 6, 40); lipG.rotateY(Math.PI / 2); lipG.translate(0.075, 0, 0);
    const blurG = new THREE.CircleGeometry(D.rimR - 0.004, 32); blurG.rotateY(Math.PI / 2); blurG.translate(0.06, 0, 0);
    const discG = new THREE.CylinderGeometry(0.11, 0.11, 0.012, 28); discG.rotateZ(Math.PI / 2);
    const calG = new THREE.BoxGeometry(0.04, 0.09, 0.05);
    const pos = [
      { x: -D.trackF / 2, z: -D.wheelbase / 2, front: true }, { x: D.trackF / 2, z: -D.wheelbase / 2, front: true },
      { x: -D.trackR / 2, z: D.wheelbase / 2, front: false }, { x: D.trackR / 2, z: D.wheelbase / 2, front: false },
    ];
    // ホイールとリム（色違いは頂点カラーで 1 つに）。左のタイヤ用は左右反転した形を別に作る（反転した行列だと面が裏返るため）
    const vc = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const strip = (g) => { g = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
    const wheelR = mergeGeometries([vc(strip(rimG), 0x2a2d31), vc(strip(lipG), 0xc9ccd1)]);
    const brakeR = mergeGeometries([vc(strip(discG).translate(-0.02, 0, 0), 0x777b80), vc(strip(calG).translate(-0.02, 0.07, 0), 0xd8282a)]);
    const mirror = (g) => { const m = g.clone(); m.scale(-1, 1, 1); const p = m.attributes.position; for (let i = 0; i < p.count; i += 3) for (const k of Object.keys(m.attributes)) { const at = m.attributes[k], sz = at.itemSize; for (let j = 0; j < sz; j++) { const t = at.array[(i + 1) * sz + j]; at.array[(i + 1) * sz + j] = at.array[(i + 2) * sz + j]; at.array[(i + 2) * sz + j] = t; } } return m; };   // scale(-1) で法線も反転済み
    const blurR = strip(blurG);
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.92, name: 'wheel' });
    const brakeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7, name: 'brake' });
    const IM = (g, mat, n, shadow = true) => { const m = new THREE.InstancedMesh(g, mat, n); m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; this.root.add(m); return m; };
    this.wheelIM = {
      tire: IM(strip(tireG), M.tire, 4),
      rim: [IM(mirror(wheelR), wheelMat, 2), IM(wheelR, wheelMat, 2)],
      blur: [IM(mirror(blurR), M.blur, 2, false), IM(blurR, M.blur, 2, false)],
      brake: [IM(mirror(brakeR), brakeMat, 2), IM(brakeR, brakeMat, 2)],
    };
    for (const p of pos) {
      // 位置と回転を計算するためだけの入れ物（中は空。描画は上のインスタンス）
      const steer = new THREE.Group(); steer.position.set(p.x, D.tireR, p.z);
      const spin = new THREE.Group(); steer.add(spin);
      this.wheels.push({ steer, spin, front: p.front, side: Math.sign(p.x), base: steer.position.clone(), lr: p.x < 0 ? 0 : 1, k: (p.front ? 0 : 1) });
    }
    this._placeWheels();
  }

  // タイヤのインスタンスの行列を、steer / spin の回転から作る
  _placeWheels() {
    const W = this.wheelIM; if (!W) return;
    this.wheels.forEach((w, i) => {
      w.steer.updateMatrix(); w.spin.updateMatrix();
      _ws.multiplyMatrices(w.steer.matrix, w.spin.matrix);
      W.tire.setMatrixAt(i, _ws);
      W.rim[w.lr].setMatrixAt(w.k, _ws);
      W.blur[w.lr].setMatrixAt(w.k, _ws);
      W.brake[w.lr].setMatrixAt(w.k, w.steer.matrix);
    });
    W.tire.instanceMatrix.needsUpdate = true;
    for (const k of ['rim', 'blur', 'brake']) for (const m of W[k]) m.instanceMatrix.needsUpdate = true;
  }

  // サスペンション（ダブルウィッシュボーン＋プッシュロッド）
  _addSuspension() {
    const D = CAR_DIM, M = this.mats, V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const w of this.wheels) {
      const s = w.side, zc = w.base.z, hx = w.base.x;
      const fw = this._envAt(zc).w;
      const inner = Math.max(0.16, fw - 0.02);
      const outerU = V(hx - s * 0.06, D.tireR + 0.09, zc), outerL = V(hx - s * 0.06, D.tireR - 0.1, zc);
      for (const [o, y] of [[outerU, 0.31], [outerL, 0.1]]) {
        this.body.add(rod(V(s * inner, y, zc - 0.17), o, 0.011, M.carbon));
        this.body.add(rod(V(s * inner, y, zc + 0.17), o, 0.011, M.carbon));
      }
      this.body.add(rod(V(s * (inner - 0.02), 0.42, zc - 0.04), V(hx - s * 0.08, D.tireR - 0.08, zc), 0.009, M.steel));   // プッシュロッド
      // アップライト
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.06), M.dark); up.position.set(hx - s * 0.055, D.tireR, zc); this.body.add(up);
    }
  }

  // フロントウイングとリアウイング（カーボン＋翼端板）
  _addWings() {
    const M = this.mats, zF = this.env.zFront ?? -1.35;
    const fw = new THREE.Group(); fw.name = 'frontWing';
    const span = 1.34;
    const els = [[0.32, 0.1, 0.06, 0.0], [0.17, 0.12, 0.2, 0.2], [0.12, 0.12, 0.38, 0.3]];   // [弦, 厚み, 前からの位置, 角度]
    els.forEach(([c, t, off, a], i) => {
      const g = airfoil(c, t, span, a + 0.05);
      const m = new THREE.Mesh(g, i ? M.paint : M.carbon);
      m.position.set(0, 0.075 + i * 0.045, zF - 0.62 + off + i * 0.02); fw.add(m);
    });
    for (const sx of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.5), M.carbon);
      ep.position.set(sx * span / 2, 0.13, zF - 0.36); fw.add(ep);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.03, 0.5), M.paintAccent);
      st.position.set(sx * span / 2, 0.19, zF - 0.36); fw.add(st);
    }
    // ステー
    for (const sx of [-0.12, 0.12]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.16), M.carbon); st.position.set(sx, 0.17, zF - 0.38); fw.add(st); }
    this.body.add(fw);
    // リアウイング
    const rw = new THREE.Group(); rw.name = 'rearWing';
    const rs = 0.98, zr = 1.08;
    [[0.34, 0.12, 0, 0.12], [0.22, 0.11, 0.24, 0.42], [0.15, 0.1, 0.4, 0.7]].forEach(([c, t, off, a], i) => {
      const g = airfoil(c, t, rs, a);
      const m = new THREE.Mesh(g, i === 1 ? M.paint : M.carbon);
      m.position.set(0, 0.86 + i * 0.07 + off * 0.18, zr - 0.08 + off * 0.6); rw.add(m);
    });
    for (const sx of [-1, 1]) {
      // 翼端板（チーム名入り）
      const tex = textTexture({ w: 512, h: 320, bg: '#17191d', bg2: '#0c0d10', lines: [{ text: 'TAKUDEN', size: 0.24, color: '#ffffff', y: 0.42 }, { text: 'FORMULA EV', size: 0.12, color: '#ffc928', y: 0.66 }],
        draw: (g, w, h) => { g.fillStyle = '#0f4fb4'; g.fillRect(0, h * 0.82, w, h * 0.18); g.fillStyle = '#ffc928'; g.fillRect(0, h * 0.8, w, h * 0.03); } });
      const epm = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 });
      // 翼端板（カーボン）の外側と内側に文字の板を貼る
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.36, 0.56), M.carbon);
      ep.position.set(sx * rs / 2, 0.97, zr + 0.16); rw.add(ep);
      for (const side of [1, -1]) {
        const lg = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), this._epm || (this._epm = epm));
        lg.position.set(sx * rs / 2 + side * 0.0065, 0.97, zr + 0.16); lg.rotation.y = side * Math.PI / 2; rw.add(lg);
      }
    }
    // ステー（メインフープの後ろのフレームから）
    for (const sx of [-0.2, 0.2]) {
      rw.add(rod(new THREE.Vector3(sx, 0.38, 0.85), new THREE.Vector3(sx * 0.9, 0.92, zr + 0.05), 0.012, M.carbon));
    }
    rw.add(rod(new THREE.Vector3(0, 1.12, 0.3), new THREE.Vector3(0, 1.0, zr), 0.01, M.carbon));
    this.body.add(rw);
    // ディフューザー
    const df = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.012, 0.6), M.carbon);
    df.position.set(0, 0.12, 1.05); df.rotation.x = -0.28; this.body.add(df);
    for (const sx of [-0.25, 0, 0.25]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.12, 0.55), M.carbon); f.position.set(sx, 0.1, 1.04); f.rotation.x = -0.28; this.body.add(f); }
  }

  // モータ・インバータ・バッテリー（後ろ側）
  _addPowertrain() {
    const M = this.mats;
    const mot = new THREE.Mesh(cyl(0.11, 0.11, 0.26, 20), M.motor); mot.rotation.z = Math.PI / 2; mot.position.set(0, 0.25, 0.82); this.body.add(mot);
    const diff = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.16), M.dark); diff.position.set(0, 0.25, 0.66); this.body.add(diff);
    const shaft = new THREE.Mesh(cyl(0.018, 0.018, CAR_DIM.trackR - 0.15, 8), M.steel); shaft.rotation.z = Math.PI / 2; shaft.position.set(0, CAR_DIM.tireR, CAR_DIM.wheelbase / 2); this.body.add(shaft);
    // バッテリー箱（メインフープの後ろ。高電圧マーク）
    const acc = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.36), M.battery); acc.position.set(0, 0.3, 0.45); this.body.add(acc);
    const hv = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), new THREE.MeshStandardMaterial({ map: hvTexture(), transparent: true, roughness: 0.5 }));
    hv.position.set(0, 0.4, 0.632); this.body.add(hv);
    for (const sx of [-1, 1]) {
      const hv2 = hv.clone(); hv2.position.set(sx * 0.232, 0.38, 0.45); hv2.rotation.y = sx * Math.PI / 2; this.body.add(hv2);
      this.body.add(rod(new THREE.Vector3(sx * 0.15, 0.2, 0.62), new THREE.Vector3(sx * 0.06, 0.2, 0.76), 0.012, M.orange));
    }
  }

  // ドライバー（ヘルメット・体・腕・ハンドル）
  _addDriver() {
    const M = this.mats, g = new THREE.Group(); g.name = 'driver';
    const head = new THREE.Group(); head.position.set(0, 0.95, 0.08); g.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 20), M.helmet); helmet.scale.set(1, 1.05, 1.12); head.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.137, 28, 12, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2), M.visor);
    visor.rotation.y = Math.PI; visor.scale.set(1, 1.05, 1.12); head.add(visor);
    const strip = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.012, 6, 32, Math.PI), M.paint); strip.rotation.set(0, Math.PI / 2, 0); strip.scale.set(1.12, 1.05, 1); head.add(strip);
    const strip2 = new THREE.Mesh(new THREE.TorusGeometry(0.139, 0.006, 6, 32, Math.PI), M.paintAccent); strip2.rotation.set(0.25, Math.PI / 2, 0); strip2.scale.set(1.12, 1.05, 1); head.add(strip2);
    this.head = head;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), M.suit); torso.position.set(0, 0.6, 0.12); torso.rotation.x = -0.35; g.add(torso);
    const hans = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16, Math.PI), M.dark); hans.rotation.set(Math.PI / 2 + 0.2, 0, 0); hans.position.set(0, 0.8, 0.12); g.add(hans);
    // ハンドル
    const sw = new THREE.Group(); sw.position.set(0, 0.6, -0.36); sw.rotation.x = -0.35; g.add(sw);
    const rimS = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 8, 24), M.dark); sw.add(rimS);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.02), M.carbon); sw.add(plate);
    this.steeringWheel = sw;
    for (const sx of [-1, 1]) {
      const sh = new THREE.Vector3(sx * 0.15, 0.74, 0.08), hand = new THREE.Vector3(sx * 0.11, 0.62, -0.32), elbow = new THREE.Vector3(sx * 0.22, 0.6, -0.1);
      g.add(rod(sh, elbow, 0.045, M.suit)); g.add(rod(elbow, hand, 0.04, M.suit));
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), M.glove); gl.position.copy(hand); g.add(gl);
    }
    this.body.add(g);
  }

  // ブレーキランプ（レインライト）と TSAL（メインフープの上の高電圧表示灯）
  _addLights() {
    const M = this.mats;
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.03), M.brake); rl.position.set(0, 0.42, 1.18); this.body.add(rl);
    const rlHousing = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.03), M.dark); rlHousing.position.set(0, 0.42, 1.165); this.body.add(rlHousing);
    this.body.add(rod(new THREE.Vector3(0, 0.3, 1.0), new THREE.Vector3(0, 0.4, 1.16), 0.01, M.dark));
    const ts = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), M.tsal); ts.position.set(0, (this.env.top ?? 1.18) + 0.03, 0.24); this.body.add(ts);
  }

  // 位置と向き（ワールド）。pos = 前後の車軸の真ん中の地面、quat = 車の向き
  setPose(pos, quat) { this.root.position.copy(pos); this.root.quaternion.copy(quat); }

  // 見た目の動き。st: { speed, steer(-1〜1), braking, latAcc, accel, rough(0〜1), tsal(bool), dt }
  update(dt, st) {
    const D = CAR_DIM;
    this.spin = (this.spin + (st.speed || 0) / D.tireR * dt) % (Math.PI * 2);
    this._steer += ((st.steer || 0) * 0.42 - this._steer) * Math.min(1, dt * 12);
    const blurA = clamp(((st.speed || 0) - 4) / 14, 0, 0.92);
    for (const w of this.wheels) {
      w.spin.rotation.x = -this.spin;
      if (w.front) w.steer.rotation.y = -this._steer;
    }
    this.mats.blur.opacity = blurA;
    this._placeWheels();
    if (this.steeringWheel) this.steeringWheel.rotation.z = -this._steer * 2.2;
    if (this.head) this.head.rotation.z = clamp(-(st.latAcc || 0) * 0.006, -0.12, 0.12);
    // ロール・ピッチ（バネの上だけ）
    const rollT = clamp((st.latAcc || 0) * 0.0035, -0.035, 0.035), pitchT = clamp(-(st.accel || 0) * 0.0035, -0.03, 0.03);
    this._roll += (rollT - this._roll) * Math.min(1, dt * 6); this._pitch += (pitchT - this._pitch) * Math.min(1, dt * 6);
    this._bump = (st.rough || 0) > 0 ? (Math.sin(performance.now() / 23) * 0.006 + (Math.random() - 0.5) * 0.008) * st.rough : this._bump * 0.8;
    this.body.rotation.set(this._pitch, 0, this._roll);
    this.body.position.y = this._bump;
    // ランプ
    this.mats.brake.emissiveIntensity = st.braking ? 9 : 0.25;
    this.blink += dt;
    this.mats.tsal.emissiveIntensity = st.tsal ? (Math.floor(this.blink * 8) % 2 ? 8 : 0.3) : 0.3;
  }
}

function hvTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd400'; g.strokeStyle = '#111'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(64, 6); g.lineTo(122, 106); g.lineTo(6, 106); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#111'; g.beginPath(); g.moveTo(70, 30); g.lineTo(48, 70); g.lineTo(64, 70); g.lineTo(56, 96); g.lineTo(82, 56); g.lineTo(66, 56); g.lineTo(76, 30); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const _mm = new THREE.Matrix4(), _ws = new THREE.Matrix4();
function defaultEnvelope() { return { bins: null, zFront: -1.35, zRear: 1.05, top: 1.18 }; }
