// コース定義で使う共通の道具（コーンの並べ方・長さの設定・ゲートやスタートの飾り）
// ここの関数は全コースで使うので、変えるときは引数を増やすだけにして、今の呼び方を壊さないこと。
import * as THREE from 'three';
import { gantry, roadDecal, checkerMaterial } from '../engine/props.js';
import { MAT } from '../engine/textures.js';

// 設定「コースの長さ」→ 走る距離の倍率（片道コース）
export const LENGTH_FACTOR = { short: 0.55, normal: 1, long: 1.5 };

// コーンを置く。zones: [{ s0, s1, kind: 'slalom' | 'lane' | 'gate', step }]
//   slalom: 左右交互に 1 本ずつ / lane: 3 車線のうち 2 車線をふさぐ（旧版と同じ）/ gate: 両脇に 1 本ずつ（間を通る）
// 戻り値: [{ s, d, r, kind: 'obstacle' }]
//   lane の空いている車線は、前の列のとなりか同じ車線にする（横に動ける速さ = 0.25 × 車速 なので、
//   2 車線いっぺんに動くには約 4 × 横の距離 [m] 進む必要がある）。列の間は 5 × 車線の幅以上あける
export function coneZones(track, zones, rnd, { laneK = 0.66, slalomK = 0.45 } = {}) {
  const out = [];
  for (const z of zones) {
    let k = 0, free = 1;
    const half0 = track.halfWidth(z.s0);
    const step = z.step || (z.kind === 'slalom' ? 14 : Math.max(19, 5 * laneK * half0));
    for (let s = z.s0 + 6; s < z.s1 - 3; s += step) {
      const half = track.halfWidth(s);
      if (z.kind === 'slalom') out.push({ s, d: (k % 2 ? 1 : -1) * slalomK * half, r: 0.18, kind: 'obstacle' });
      else if (z.kind === 'gate') { const c = (rnd() - 0.5) * half * 0.6; for (const sd of [-1, 1]) out.push({ s, d: c + sd * 1.6, r: 0.18, kind: 'obstacle' }); }
      else {
        const r = rnd();
        free = k === 0 ? Math.floor(r * 3) : Math.max(0, Math.min(2, free + (r < 0.4 ? -1 : r < 0.8 ? 1 : 0)));
        [-laneK, 0, laneK].forEach((o, i) => { if (i !== free) out.push({ s, d: o * half, r: 0.18, kind: 'obstacle' }); });
      }
      k++;
    }
  }
  return out;
}

// コースの両脇にコーンを並べる（学生フォーミュラのコース）。every [m] ごと、端から inset [m] 内側
export function boundaryCones(track, s0, s1, { every = 5, inset = 0.25 } = {}) {
  const out = [];
  for (let s = s0; s <= s1; s += every) {
    for (const side of [-1, 1]) out.push({ s, d: side * (track.halfWidth(s, side) + inset), r: 0.18, kind: 'boundary' });
  }
  return out;
}

// スタートライン・グリッド・スタートのゲート（ランプつき）を置く。戻り値 { setStartLights(n) }
export function startArea(ctx, sLine, { label = 'TAKUDEN GRAND PRIX', gate = true, grid = 3, finishHere = false } = {}) {
  const { track, group } = ctx;
  const half = track.halfWidth(sLine);
  // スタートライン（白）とチェッカー（ゴールと同じ場所のとき）
  group.add(roadDecal(track, sLine - 0.3, 0.6, -half, half, MAT.line()));
  if (finishHere) group.add(roadDecal(track, sLine + 0.3, 1.6, -half, half, checkerMaterial(Math.round(half * 2 / 0.8), 2)));
  // グリッド（白いかぎ形）
  for (let i = 0; i < grid; i++) {
    const s = sLine - 8 - i * 8, d = (i % 2 ? 1 : -1) * half * 0.35;
    group.add(roadDecal(track, s, 0.25, d - 1.0, d + 1.0, MAT.line()));
    group.add(roadDecal(track, s - 1.6, 1.6, d - 1.0, d - 0.8, MAT.line()));
    group.add(roadDecal(track, s - 1.6, 1.6, d + 0.8, d + 1.0, MAT.line()));
  }
  if (!gate) return { setStartLights() {} };
  const w = (track.barrierD(sLine, -1) + track.barrierD(sLine, 1)) / 2;
  const m = track.placeMatrix(sLine + 1.5, 0, 0);
  const gt = gantry(m, { width: Math.max(half * 2 + 3, Math.min(w * 2 - 1, half * 2 + 8)), label, lights: true });
  group.add(gt.group);
  return { setStartLights: (n, color) => gt.setLights(n, color) };
}

// ゴールのゲート（チェッカー）とゴールライン
export function finishArea(ctx, sLine, { label = 'FINISH', gate = true } = {}) {
  const { track, group } = ctx;
  const half = track.halfWidth(sLine);
  group.add(roadDecal(track, sLine, 1.6, -half, half, checkerMaterial(Math.round(half * 2 / 0.8), 2)));
  if (gate) {
    const m = track.placeMatrix(sLine + 0.8, 0, 0);
    const gt = gantry(m, { width: half * 2 + 3, label, lights: false, checker: true });
    group.add(gt.group);
  }
}

// 区間 [s0, s1] を step ごとに回す（周回コースの継ぎ目も考える）
export function forRange(track, s0, s1, step, fn) {
  for (let s = s0; s <= s1; s += step) fn(track.wrap(s), s);
}

// 視点の高さ・向きに合わせて、コースの外の点の地面の高さを得る
export function groundAt(ctx, x, z) { return ctx.heightFn ? ctx.heightFn(x, z) : 0; }

export { THREE };
