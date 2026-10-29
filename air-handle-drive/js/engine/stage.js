// コース（js/courses/*.js の定義）から、走れる「ステージ」を組み立てる。
// ステージ = 中心線（Track）＋路面・地形・景色のメッシュ＋コーン＋速度の上限＋コースマップ＋環境
// 作るのに時間がかかるので、同じ設定ならキャッシュを使い回す（StageCache）。
import * as THREE from 'three';
import { Track, buildTrackMeshes, groundHeight } from './track.js';
import { createHeightFn, buildTerrain } from './terrain.js';
import * as props from './props.js';
import { MergeBuilder, Forest } from './props.js';
import { MAT, TEX, mulberry32, textTexture } from './textures.js';
import { buildSpeedProfile, Sim, PHYS } from '../physics.js';

// course: コースの定義, opts: { length: 'short'|'normal'|'long', cones: bool, deco: 0〜1（景色の量）, seed }
export function buildStage(course, opts = {}) {
  const t0 = performance.now();
  const o = { length: 'normal', cones: true, deco: 1, seed: 7, ...opts };
  const layout = course.build(o);
  resolveMaterials(layout);
  const track = new Track(layout);
  checkLength(course, layout, track);
  const heightFn = layout.terrain === false ? ((x, z) => { const r = track.nearest(x, z, 2000); return r ? track.py[r.i] - 0.12 : 0; }) : createHeightFn(track, layout.terrain || {});
  const root = new THREE.Group(); root.name = 'stage-' + course.id;
  // 路面まわり
  const trackGroup = buildTrackMeshes(track, { heightFn, ...(layout.trackStyle || {}) });
  root.add(trackGroup);
  // 地形
  let terrain = null;
  if (layout.terrain !== false) { terrain = buildTerrain(track, heightFn, layout.terrain || {}); root.add(terrain); }
  // 走る範囲
  const startS = layout.startS ?? 0;
  const raceLength = layout.raceLength ?? Math.min(1000, track.length - startS - 200);
  const laps = layout.laps || 1;
  const finishS = track.wrap(startS + raceLength);
  // 景色（コースごと）
  const scenery = new THREE.Group(); scenery.name = 'scenery'; root.add(scenery);
  const mb = new MergeBuilder(), forest = new Forest();
  const updates = [];
  const ctx = {
    THREE, track, layout, opts: o, group: scenery, mb, forest, props, MAT, TEX, textTexture, heightFn,
    rnd: mulberry32((o.seed || 7) * 7919 + course.id.length), deco: o.deco ?? 1,
    startS, raceLength, finishS, laps,
    addUpdate: (fn) => updates.push(fn),
    // 道の脇 (s, d) の地面の高さ
    groundAt: (s, d) => groundHeight(track, heightFn, s, d),
    // (s, d) の地面に置く行列。正面（+Z）をコースに向ける。{ back: 反対向き, yaw: さらに回す [rad], h: 浮かせる高さ, scale }
    place: (s, d, { back = false, yaw = 0, h = 0, scale = 1 } = {}) => {
      let y = d < 0 ? -Math.PI / 2 : Math.PI / 2; if (back) y += Math.PI;
      const m = track.placeMatrix(s, d, 0, { yaw: y + yaw, scale });
      m.elements[13] = groundHeight(track, heightFn, s, d) + h;
      return m;
    },
  };
  let hooks = {};
  if (course.decorate) hooks = course.decorate(ctx) || {};
  const batches = mb.build(scenery);
  forest.build(scenery, { shadows: true });
  root.updateMatrixWorld(true);
  // コーン
  const cones = (layout.cones || []).map((c) => ({ ...c, hit: false }));
  // 速度の上限（コーナーの自動ブレーキ）
  const vprof = buildSpeedProfile(track, { latG: layout.latG ?? course.latG ?? PHYS.latG, caps: layout.caps || [] });
  // 地面の一番低い所（遠くの地面・山並みの高さ）
  let groundY = Infinity; for (let i = 0; i < track.n; i++) groundY = Math.min(groundY, track.py[i]);
  const b = track.bounds;
  const stage = {
    course, opts: o, layout, track, root, terrain, heightFn, startS, raceLength, finishS, laps, cones, vprof,
    env: { ...(course.env || {}), ...(layout.env || {}) }, grade: { ...(course.grade || {}), ...(layout.grade || {}) },
    center: { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, y: groundY - 2 },
    map: { pts: track.mapPoints(startS, startS + Math.min(raceLength, track.closed ? track.length : raceLength), 4), all: track.mapPoints(0, track.length, 6), closed: track.closed },
    hooks: {
      update: (dt, info) => { for (const f of updates) f(dt, info); if (hooks.update) hooks.update(dt, info); },
      setStartLights: (n, color) => { if (hooks.setStartLights) hooks.setStartLights(n, color); },
      onNight: hooks.onNight,
    },
    stats: { buildMs: 0, batches },
    // 景色の量（0〜1）。木の本数を減らす（軽い画質用）。作り直さずに表示する数だけ変える
    setDensity(k) {
      root.traverse((m) => { if (m.isInstancedMesh && m.userData.thin) m.count = Math.max(1, Math.round(m.userData.total * k)); });
    },
    _ideal: new Map(),
    // 理論最速 [秒]（topMs: 最高速の上限 [m/s]）
    idealTime(topMs) {
      const k = Math.round(topMs * 100);
      if (!this._ideal.has(k)) { const sim = new Sim(); sim.setCourse(this); this._ideal.set(k, sim.idealTime(topMs)); }
      return this._ideal.get(k);
    },
    dispose() {
      root.traverse((m) => { if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose(); });
    },
  };
  stage.stats.buildMs = performance.now() - t0;
  return stage;
}

// 片道コースで、走る距離が中心線より長いとゴールできないので縮める（コースの作りまちがいの保険）
function checkLength(course, layout, track) {
  if (track.closed) return;
  const max = track.length - (layout.startS ?? 0) - 40;
  if ((layout.raceLength ?? 0) > max) { console.warn(`${course.id}: 走る距離 ${layout.raceLength} m が中心線より長いので ${max.toFixed(0)} m にしました`); layout.raceLength = max; }
}

// build() は three.js を使わないデータなので、材質は名前（'concrete' など = MAT の名前）で書く。ここで本物の材質にする
function resolveMaterials(layout) {
  const R = (v) => (typeof v === 'string' ? (MAT[v] ? MAT[v]() : null) : v);
  if (layout.terrain && layout.terrain.material) layout.terrain = { ...layout.terrain, material: R(layout.terrain.material) };
  const ts = layout.trackStyle;
  if (ts) {
    layout.trackStyle = { ...ts, road: R(ts.road), vergeMat: R(ts.vergeMat), kerbMat: R(ts.kerbMat) };
    if (ts.runoffMats) { const m = {}; for (const k in ts.runoffMats) m[k] = R(ts.runoffMats[k]); layout.trackStyle.runoffMats = m; }
    for (const k of ['road', 'vergeMat', 'kerbMat']) if (layout.trackStyle[k] == null) delete layout.trackStyle[k];
  }
}

// 見た目を作らずに、走る形だけ作る（理論最速・目標タイムの計算用。速い）
const infoCache = new Map();
export function courseInfo(course, opts = {}) {
  const o = { length: 'normal', cones: true, seed: 7, ...opts };
  const key = [course.id, o.length, o.cones ? 1 : 0].join('|');
  if (infoCache.has(key)) return infoCache.get(key);
  const layout = course.build(o);
  const track = new Track(layout);
  checkLength(course, layout, track);
  const info = {
    course, track, layout, startS: layout.startS ?? 0, raceLength: layout.raceLength, laps: layout.laps || 1,
    cones: (layout.cones || []).map((c) => ({ ...c })),
    vprof: buildSpeedProfile(track, { latG: layout.latG ?? course.latG ?? PHYS.latG, caps: layout.caps || [] }),
    _ideal: new Map(),
    idealTime(topMs) {
      const k = Math.round(topMs * 100);
      if (!this._ideal.has(k)) { const sim = new Sim(); sim.setCourse(this); this._ideal.set(k, sim.idealTime(topMs)); }
      return this._ideal.get(k);
    },
  };
  infoCache.set(key, info);
  return info;
}

// 同じコース・同じ設定のステージを使い回す
export class StageCache {
  constructor(max = 4) { this.max = max; this.map = new Map(); }
  key(course, o) { return [course.id, o.length, o.cones ? 1 : 0].join('|'); }
  has(course, o) { return this.map.has(this.key(course, o)); }
  get(course, o) {
    const k = this.key(course, o);
    let s = this.map.get(k);
    if (!s) {
      s = buildStage(course, o);
      this.map.set(k, s);
      // 古い物を捨てる（同じコースの別設定から）
      while (this.map.size > this.max) { const [k0, s0] = this.map.entries().next().value; this.map.delete(k0); s0.dispose(); }
    } else { this.map.delete(k); this.map.set(k, s); }
    return s;
  }
  clear() { for (const s of this.map.values()) s.dispose(); this.map.clear(); }
}
