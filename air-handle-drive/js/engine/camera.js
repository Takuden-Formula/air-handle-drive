// カメラ：追従カメラ（スピード感の FOV 変化・揺れ）、テレビ中継風の固定カメラ、ヘリ、コースを飛ぶドローン（コース選択の背景）
// 使い方: rig.update(dt, target, track) を毎フレーム。target = { pos, fwd, up, right, speed, shake, rough }（ワールド座標）
import * as THREE from 'three';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class CameraRig {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 7000);
    this.mode = 'chase';
    this.shiftX = 0.5;               // 画面上で車が来る横位置（0.5 = 中央。右下のカメラ映像をよけるため 0.42 など）
    this.params = { dist: 4.7, height: 1.62, lookAhead: 7, lookH: 0.72, fov: 56, fovGain: 16, yawLag: 5.5 };
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._fov = 58; this._t = 0; this.snap = true;
    this.tv = null;                  // テレビカメラの位置 { pos, s }
    this.drone = { s: 0, side: 1 };
    this.w = 16; this.h = 9;
  }

  setMode(mode) { if (mode !== this.mode) { this.mode = mode; this.snap = true; this.tv = null; } }
  setShift(x) { this.shiftX = x; this._applyView(); }
  resize(w, h) { this.w = w; this.h = h; this.camera.aspect = w / h; this._applyView(); }
  _applyView() {
    const c = this.camera;
    if (Math.abs(this.shiftX - 0.5) > 1e-3) c.setViewOffset(this.w, this.h, (0.5 - this.shiftX) * this.w, 0, this.w, this.h);
    else c.clearViewOffset();
    c.updateProjectionMatrix();
  }

  // target: { pos, fwd, up, speed(m/s), topSpeed, shake(0〜1), rough(0〜1: 路面のがたがた) }
  update(dt, target, track) {
    this._t += dt;
    const cam = this.camera;
    switch (this.mode) {
      case 'chase': case 'grid': this._chase(dt, target); break;
      case 'tv': this._tv(dt, target, track); break;
      case 'heli': this._heli(dt, target); break;
      case 'drone': this._drone(dt, track); break;
      case 'orbit': this._orbit(dt, target); break;
    }
    this.snap = false;
    cam.updateMatrixWorld();
  }

  _chase(dt, T) {
    const P = this.params, cam = this.camera;
    const k = this.snap ? 1 : 1 - Math.exp(-dt * P.yawLag);
    // 車の向きに少し遅れてついていく（カーブで車の横が少し見える）
    this._fwd.lerp(T.fwd, k).normalize();
    this._up.lerp(T.up, this.snap ? 1 : 1 - Math.exp(-dt * 3)).normalize();
    const v01 = clamp(T.speed / (T.topSpeed || 30), 0, 1.2);
    const grid = this.mode === 'grid';
    const dist = (grid ? P.dist * 0.92 : P.dist) + v01 * 0.9;
    const hgt = (grid ? P.height * 0.85 : P.height) - v01 * 0.18;
    const pos = _a.copy(T.pos).addScaledVector(this._fwd, -dist).addScaledVector(this._up, hgt);
    const look = _b.copy(T.pos).addScaledVector(this._fwd, P.lookAhead).addScaledVector(this._up, P.lookH);
    // 揺れ（ぶつかった・コースアウト・縁石）
    const sh = (T.shake || 0) * 0.22 + (T.rough || 0) * 0.05 * v01;
    if (sh > 0) {
      const t = this._t * 37;
      pos.x += Math.sin(t * 1.3) * sh * 0.5; pos.y += Math.sin(t * 1.7 + 1) * sh; pos.z += Math.sin(t * 1.1 + 2) * sh * 0.5;
    }
    // 高速での細かい振動
    pos.y += Math.sin(this._t * 61) * 0.006 * v01;
    if (this.snap) { this._pos.copy(pos); this._look.copy(look); }
    else { this._pos.copy(pos); this._look.lerp(look, 1 - Math.exp(-dt * 20)); }
    cam.position.copy(this._pos); cam.up.copy(this._up); cam.lookAt(this._look);
    this._setFov(P.fov + P.fovGain * Math.min(1, v01) ** 1.4, dt);
  }

  // テレビ中継：コースの先の脇にカメラを置き、車が通り過ぎたら次の場所へ
  _tv(dt, T, track) {
    const cam = this.camera;
    if (!track) return this._chase(dt, T);
    const sCar = T.s ?? 0;
    if (!this.tv || track.wrap(sCar - this.tv.s + track.length / 2) - track.length / 2 > 25) {
      const s = sCar + 70 + Math.random() * 40, side = Math.random() < 0.5 ? -1 : 1;
      const d = side * (track.barrierD(s, side) + 3 + Math.random() * 6);
      const p = track.toWorld(s, d, 2.5 + Math.random() * 5);
      this.tv = { s: track.wrap(s), pos: p };
    }
    cam.position.copy(this.tv.pos); cam.up.set(0, 1, 0);
    _b.copy(T.pos).addScaledVector(T.fwd, 2).y += 0.6;
    cam.lookAt(_b);
    const dist = cam.position.distanceTo(T.pos);
    this._setFov(clamp(2 * Math.atan(9 / Math.max(1, dist)) * 180 / Math.PI, 8, 55), dt, true);
  }

  _heli(dt, T) {
    const cam = this.camera;
    this._fwd.lerp(T.fwd, this.snap ? 1 : 1 - Math.exp(-dt * 1.5)).normalize();
    const side = _c.crossVectors(this._fwd, _y).normalize();
    const pos = _a.copy(T.pos).addScaledVector(this._fwd, -22).addScaledVector(side, 10).add(_d.set(0, 14, 0));
    if (this.snap) this._pos.copy(pos); else this._pos.lerp(pos, 1 - Math.exp(-dt * 2));
    cam.position.copy(this._pos); cam.up.set(0, 1, 0);
    cam.lookAt(_b.copy(T.pos).addScaledVector(this._fwd, 6));
    this._setFov(42, dt);
  }

  // コース選択の背景：コースの上をゆっくり飛ぶ
  _drone(dt, track) {
    if (!track) return;
    const cam = this.camera, D = this.drone;
    D.s = track.wrap(D.s + dt * 14);
    const s = D.s;
    const p = track.toWorld(s - 30, D.side * 18, 16);
    const look = track.toWorld(s + 40, 0, 1);
    if (this.snap) this._pos.copy(p); else this._pos.lerp(p, 1 - Math.exp(-dt * 1.5));
    cam.position.copy(this._pos); cam.up.set(0, 1, 0);
    if (this.snap) this._look.copy(look); else this._look.lerp(look, 1 - Math.exp(-dt * 1.5));
    cam.lookAt(this._look);
    this._setFov(55, dt);
  }

  // 車のまわりを回る（タイトル・結果）
  _orbit(dt, T) {
    const cam = this.camera, a = this._t * 0.25;
    const pos = _a.set(Math.sin(a) * 7, 2.2, Math.cos(a) * 7).add(T.pos);
    cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(_b.copy(T.pos).add(_d.set(0, 0.6, 0)));
    this._setFov(45, dt);
  }

  _setFov(f, dt, instant = false) {
    this._fov = this.snap || instant ? f : this._fov + (f - this._fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) { this.camera.fov = this._fov; this.camera.updateProjectionMatrix(); }
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
