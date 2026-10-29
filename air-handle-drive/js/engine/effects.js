// 演出：砂ぼこり・芝・白煙のパーティクル、ガードレールの火花、タイヤ痕、コーン（並べる・はね飛ばす）
// 使い方: fx.setStage(stage) → 毎フレーム fx.update(dt, car) / 当たったら fx.coneHit(i, ...) / fx.sparks(...)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';

const MAXP = 600, MAXS = 160, MARKS = 900;

// パイロン（三角コーン）の形。足もとの四角い台＋円すい＋白い反射帯（頂点カラー）
export function coneGeometry(h = 0.7) {
  const parts = [];
  const color = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.index ? g.toNonIndexed() : g; };
  const OR = [1.0, 0.24, 0.02], WH = [0.95, 0.95, 0.92];
  const base = new THREE.BoxGeometry(0.38, 0.035, 0.38); base.translate(0, 0.0175, 0); parts.push(color(base, [0.9, 0.2, 0.02]));
  const r0 = 0.15, r1 = 0.025;
  const R = (y) => r0 + (r1 - r0) * (y / h);
  const seg = (y0, y1, c) => { const g = new THREE.CylinderGeometry(R(y1), R(y0), y1 - y0, 16, 1, true); g.translate(0, (y0 + y1) / 2, 0); parts.push(color(g, c)); };
  seg(0.035, h * 0.38, OR); seg(h * 0.38, h * 0.58, WH); seg(h * 0.58, h, OR);
  const top = new THREE.CircleGeometry(R(h), 16); top.rotateX(-Math.PI / 2); top.translate(0, h, 0); parts.push(color(top, OR));
  const g = mergeGeometries(parts.map((p) => { const q = p.clone(); for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k); return q; }));
  g.computeBoundingSphere();
  return g;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'effects'; scene.add(this.group);
    // ---- パーティクル（ぼかした丸を点で描く）----
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAXP * 3); this.pCol = new Float32Array(MAXP * 4); this.pSize = new Float32Array(MAXP);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: TEX.smoke() }, scale: { value: 800 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: /* glsl */`attribute float size; attribute vec4 color; uniform float scale; varying vec4 vC; varying float vFog;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * scale / -mv.z, 0.0, 512.0); vFog = -mv.z; }`,
      fragmentShader: /* glsl */`uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity; varying vec4 vC; varying float vFog;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
          gl_FragColor = vec4(mix(vC.rgb, fogColor, f), t.a * vC.a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(pg, this.pMat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.group.add(this.points);
    this.parts = [];
    // ---- 火花（明るい線。ブルームで光る）----
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(MAXS * 6); this.sCol = new Float32Array(MAXS * 6);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparksLine = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sparksLine.frustumCulled = false; this.group.add(this.sparksLine);
    this.spk = [];
    // ---- タイヤ痕（地面に貼る帯。古い物から上書き）----
    const mg = new THREE.BufferGeometry();
    this.mPos = new Float32Array(MARKS * 4 * 3); this.mCol = new Float32Array(MARKS * 4 * 4);
    const mi = new Uint32Array(MARKS * 6);
    for (let i = 0; i < MARKS; i++) { const a = i * 4; mi.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6); }
    mg.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('color', new THREE.BufferAttribute(this.mCol, 4).setUsage(THREE.DynamicDrawUsage));
    mg.setIndex(new THREE.BufferAttribute(mi, 1));
    this.marks = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide }));
    this.marks.frustumCulled = false; this.marks.renderOrder = 2; this.group.add(this.marks);
    this.markN = 0; this.lastMark = [null, null];
    // ---- コーン ----
    this.coneGeo = coneGeometry();
    this.coneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    this.cones = null; this.coneData = [];
    this.quality = 2;
  }

  // stage: { track, cones:[{s, d, r, kind}] }
  setStage(stage) {
    this.track = stage.track;
    if (this.cones) { this.group.remove(this.cones); this.cones.dispose(); this.cones = null; }
    const list = stage.cones || [];
    this.coneData = list.map((c) => ({ c, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), w: new THREE.Vector3(), base: new THREE.Matrix4(), flying: false, rest: false, gy: 0 }));
    if (list.length) {
      const im = new THREE.InstancedMesh(this.coneGeo, this.coneMat, list.length);
      im.castShadow = true; im.receiveShadow = true; im.name = 'cones';
      this.cones = im; this.group.add(im);
    }
    this.reset();
  }

  reset() {
    const t = this.track;
    if (this.cones && t) {
      this.coneData.forEach((k, i) => {
        const p = t.toWorld(k.c.s, k.c.d, 0, k.pos);
        k.gy = p.y; k.flying = false; k.rest = false; k.vel.set(0, 0, 0); k.w.set(0, 0, 0);
        k.rot.setFromAxisAngle(_Y, -t.headingAt(k.c.s) + (k.c.yaw || 0));
        k.base.compose(p, k.rot, _one);
        this.cones.setMatrixAt(i, k.base);
      });
      this.cones.instanceMatrix.needsUpdate = true;
      this.cones.computeBoundingSphere();
    }
    this.parts.length = 0; this.spk.length = 0;
    this.mCol.fill(0); this.marks.geometry.attributes.color.needsUpdate = true; this.markN = 0; this.lastMark = [null, null];
  }

  // コーンをはね飛ばす。carVel: 車の速度ベクトル [m/s]、right: 車の右向き、rel: 車の中心から見たコーンの横位置（-:右側でぶつかった…）
  coneHit(i, carVel, right, rel = 0) {
    const k = this.coneData[i]; if (!k) return;
    k.flying = true; k.rest = false;
    const side = rel > 0 ? -1 : 1;   // 車の中心より左のコーンは左へ飛ぶ
    k.vel.copy(carVel).multiplyScalar(0.75).addScaledVector(right, side * (2 + Math.random() * 3)); k.vel.y = 3.5 + Math.random() * 2.5;
    k.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 18);
    for (let j = 0; j < 6; j++) this.emit('dust', k.pos, _v.set((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2), 0.6, 0.5);
  }

  // 火花（ガードレールに当たった所）
  sparks(pos, dir, n = 40) {
    for (let i = 0; i < n; i++) {
      if (this.spk.length >= MAXS) this.spk.shift();
      const v = new THREE.Vector3(dir.x * (2 + Math.random() * 8) + (Math.random() - 0.5) * 6, 1 + Math.random() * 5, dir.z * (2 + Math.random() * 8) + (Math.random() - 0.5) * 6);
      this.spk.push({ p: pos.clone().add(_v.set((Math.random() - 0.5) * 0.4, Math.random() * 0.4, (Math.random() - 0.5) * 0.4)), v, life: 0.35 + Math.random() * 0.45 });
    }
  }

  // パーティクルを 1 つ出す。kind: 'dust'（砂ぼこり）| 'grass'（芝）| 'smoke'（白煙）| 'spray'
  emit(kind, pos, vel, size = 0.8, life = 0.9) {
    if (this.parts.length >= MAXP) this.parts.shift();
    const C = { dust: [0.72, 0.62, 0.46, 0.5], grass: [0.3, 0.45, 0.18, 0.6], smoke: [0.86, 0.86, 0.86, 0.32], dirt: [0.45, 0.36, 0.25, 0.7] }[kind] || [1, 1, 1, 0.4];
    this.parts.push({ p: pos.clone(), v: vel.clone(), size, grow: kind === 'grass' ? 0.3 : 1.6, life, max: life, c: C, g: kind === 'grass' || kind === 'dirt' ? 6 : -0.2 });
  }

  // 毎フレーム。car: { pos, fwd, right, speed, surface, offroad, onKerb, autoBrake, latAcc, wheels:[{x,z} 後輪のワールド位置 ×2] }
  update(dt, car) {
    const q = this.quality;
    // ---- 走行中に出すもの ----
    if (car && car.speed > 2) {
      const v = car.speed;
      const rear = car.wheels || [];
      if (car.offroad && (car.surface === 'gravel' || car.surface === 'sand' || car.surface === 'grass' || car.surface === 'dirt')) {
        const kind = car.surface === 'grass' ? 'grass' : 'dust';
        const n = Math.min(4, Math.ceil(v * dt * (q >= 2 ? 3 : 1.5)));
        for (let i = 0; i < n; i++) for (const w of rear) {
          this.emit(kind, w, _v.copy(car.fwd).multiplyScalar(-v * 0.15).add(_u.set((Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2)), kind === 'dust' ? 0.9 : 0.35, kind === 'dust' ? 1.4 : 0.7);
          if (kind === 'dust' && Math.random() < 0.5) this.emit('dirt', w, _v.copy(car.fwd).multiplyScalar(-v * 0.2).add(_u.set((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3)), 0.12, 0.6);
        }
      }
      // タイヤ痕：コースアウト（土の跡）、自動ブレーキ・急なハンドル（ゴムの跡）
      const skid = car.autoBrake && v > 12 ? 0.35 : Math.abs(car.latAcc || 0) > 16 ? 0.25 : 0;
      const dirt = car.offroad;
      if (dirt || skid) {
        rear.forEach((w, j) => this._mark(j, w, car.right, dirt ? [0.28, 0.22, 0.14, 0.55] : [0.03, 0.03, 0.03, skid]));
      } else this.lastMark = [null, null];
      if (car.autoBrake && v > 18 && Math.random() < dt * 20 && q >= 2) for (const w of rear) this.emit('smoke', w, _v.set((Math.random() - 0.5), 0.5, (Math.random() - 0.5)), 0.7, 0.8);
    } else this.lastMark = [null, null];

    // ---- パーティクルを動かす ----
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt; if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.v.y -= p.g * dt; p.v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.p.addScaledVector(p.v, dt); p.size += p.grow * dt;
    }
    for (const p of this.parts) {
      const a = Math.min(1, p.life / p.max * 1.5);
      this.pPos.set([p.p.x, p.p.y, p.p.z], n * 3);
      this.pCol.set([p.c[0], p.c[1], p.c[2], p.c[3] * a], n * 4);
      this.pSize[n] = p.size; n++;
    }
    const pg = this.points.geometry;
    pg.setDrawRange(0, n);
    if (n) { pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true; pg.attributes.size.needsUpdate = true; }
    const fog = this.scene.fog;
    if (fog) { this.pMat.uniforms.fogColor.value.copy(fog.color); this.pMat.uniforms.fogDensity.value = fog.density || 0; }
    // ---- 火花 ----
    let m = 0;
    for (let i = this.spk.length - 1; i >= 0; i--) { const s = this.spk[i]; s.life -= dt; if (s.life <= 0) this.spk.splice(i, 1); else { s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); } }
    for (const s of this.spk) {
      const b = Math.min(1, s.life * 3) * 6;
      this.sPos.set([s.p.x, s.p.y, s.p.z, s.p.x - s.v.x * 0.025, s.p.y - s.v.y * 0.025, s.p.z - s.v.z * 0.025], m * 6);
      this.sCol.set([b, b * 0.7, b * 0.3, b * 0.6, b * 0.25, 0], m * 6); m++;
    }
    const sg = this.sparksLine.geometry; sg.setDrawRange(0, m * 2);
    if (m) { sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true; }
    // ---- 飛んだコーン ----
    if (this.cones) {
      let dirty = false;
      this.coneData.forEach((k, i) => {
        if (!k.flying) return;
        k.vel.y -= 9.8 * dt;
        k.pos.addScaledVector(k.vel, dt);
        const wl = k.w.length();
        if (wl > 1e-3) k.rot.premultiply(_q.setFromAxisAngle(_v.copy(k.w).divideScalar(wl), wl * dt));
        if (k.pos.y < k.gy + 0.12 && k.vel.y < 0) {
          k.pos.y = k.gy + 0.12; k.vel.y *= -0.35; k.vel.x *= 0.6; k.vel.z *= 0.6; k.w.multiplyScalar(0.6);
          if (k.vel.lengthSq() < 0.5) {
            // 横倒しで止まる
            k.flying = false; k.rest = true; k.pos.y = k.gy + 0.15;
            _e.setFromQuaternion(k.rot, 'YXZ'); k.rot.setFromEuler(_e.set(Math.PI / 2, _e.y, 0, 'YXZ'));
          }
        }
        _m.compose(k.pos, k.rot, _one); this.cones.setMatrixAt(i, _m); dirty = true;
      });
      if (dirty) { this.cones.instanceMatrix.needsUpdate = true; this.cones.computeBoundingSphere(); }
    }
  }

  _mark(j, w, right, col) {
    const last = this.lastMark[j];
    if (!last) { this.lastMark[j] = { x: w.x, y: w.y, z: w.z }; return; }
    const dx = w.x - last.x, dz = w.z - last.z;
    if (dx * dx + dz * dz < 0.09) return;
    const i = this.markN % MARKS, hw = 0.1;
    const y0 = last.y + 0.02, y1 = w.y + 0.02;
    this.mPos.set([last.x - right.x * hw, y0, last.z - right.z * hw, last.x + right.x * hw, y0, last.z + right.z * hw, w.x - right.x * hw, y1, w.z - right.z * hw, w.x + right.x * hw, y1, w.z + right.z * hw], i * 12);
    for (let k = 0; k < 4; k++) this.mCol.set(col, i * 16 + k * 4);
    this.markN++;
    this.lastMark[j] = { x: w.x, y: w.y, z: w.z };
    const g = this.marks.geometry; g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }

  setPointScale(h, fovDeg) { this.pMat.uniforms.scale.value = h / (2 * Math.tan(fovDeg * Math.PI / 360)); }
}
const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler();
