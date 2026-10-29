// 高速道路コースの「形」（three.js も DOM も使わない。設定画面の理論最速の計算でも呼ばれる）
// 中心線・区間（料金所・防音壁・盛土・高架・トンネル・谷の橋）・高さ・道幅・道の脇・一般車の走り方の計画。
import { PathBuilder, profile } from '../../engine/track.js';
import { motorAccel, TOP_MS } from '../../physics.js';

export const LANE_W = 3.5;            // 車線の幅 [m]
export const HALF = LANE_W * 1.5;     // 片側 3 車線の半幅（5.25 m）
export const SHOULDER_L = 2.5;        // 左の路肩（広い）
export const SHOULDER_R = 1.0;        // 右の路肩（中央分離帯の側）
export const LANES = [-LANE_W, 0, LANE_W];   // 車線の中心（左・中・右）
export const START_S = 30;            // 車の中心のスタート位置（料金所の ETC レーンの中）
export const LINE_S = 33.5;           // スタートライン（ETC の開閉バー）
export const BOOTH = { s0: 10, s1: 42, pitch: 4.5, islandW: 1.4, n: 7 };   // 料金所のブース（島）。レーンの間隔 4.5 m
export const PLAZA_HALF = BOOTH.pitch * BOOTH.n / 2;   // 料金所の広場の半幅（15.75 m）
export const ISLAND_END = 56;         // ここまでは ETC レーンの両脇の島（見えない壁）で車を通す
// 土地の基準の高さ [m]。谷が深いので全体を持ち上げる（world の遠くの地面は「道路の一番低い所 − 3.5 m」に置かれるため、
// 谷底や川がそれより下だと遠くの地面に隠れてしまう）
export const BASE = 30;
export const FAR_Y = BASE - 38;   // 遠くの地面（谷底より下）
export const TRAFFIC_V = 16.7;        // 一般車の速さ [m/s]（60 km/h）。全車同じ速さ → 並び方が変わらず、必ずどこかの車線が空く

// 区間（中心線の距離 s [m]）。景色もこの値を見て作る
export const SEC = {
  plazaEnd: 90, taperEnd: 225,          // 料金所の広場 → 3 車線へ合流
  embank0: 360, bridge0: 525,            // 盛土（上り坂）→ 高架の始まり（橋台）
  jct: 735, river: 842,                  // ジャンクションの立体交差・川
  bridge1: 905,                          // 高架の終わり
  tunnel0: 965, tunnel1: 1165,           // トンネル（入口・出口の坑口）
  valley0: 1262, valley1: 1418,          // 谷を渡る橋
  shift0: 900, shift1: 952, shift2: 1170, shift3: 1228,   // 反対車線がトンネルの前後で離れる区間
};

// 中心線（向き 0 = -Z = 北。ゆるいカーブだけ。turn(半径 [m], 角度 [度]（+ = 右）)）
export function makePath() {
  const p = new PathBuilder({ x: 0, z: 0, heading: 0 });
  p.mark('plaza').straight(240)
    .mark('c1').turn(800, -24).mark('c1x')
    .straight(40).mark('c2')
    .turn(560, 42).mark('c2x')
    .straight(70).mark('c3')
    .turn(700, -18, { entry: 40, exit: 40 }).mark('c3x')
    .straight(50).mark('c4')
    .turn(520, -26).mark('c4x')
    .straight(40).mark('c5')
    .turn(650, 30).mark('c5x')
    .straight(70).mark('end');
  return p;
}

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 道の半幅：料金所の広場（7 レーン）から 3 車線へなめらかに狭まる
export function halfWidth(s) {
  if (s <= SEC.plazaEnd) return PLAZA_HALF;
  return PLAZA_HALF + (HALF - PLAZA_HALF) * sstep(SEC.plazaEnd, SEC.taperEnd, s);
}
// 見た目の壁の位置（中心線からの距離）。左 = 防音壁 / 右 = 中央分離帯
export const wallL = (s) => halfWidth(s) + SHOULDER_L + 0.3;
export const wallR = (s) => halfWidth(s) + SHOULDER_R + 0.3;
// 反対車線がトンネルの前後で外へ離れる量 [m]
export function oppShift(s) { return 9 * sstep(SEC.shift0, SEC.shift1, s) * (1 - sstep(SEC.shift2, SEC.shift3, s)); }
// 反対車線（d の + 側）。内側の端（中央分離帯の側）・外側の端・車線の中心
//   inner: 舗装の内側の端 / lanesIn〜lanesOut: 車線 / outer: 舗装の外側の端 / wall: 外側の壁の中心 / sep: 内側に自分の分離帯の壁があるか
export function oppEdges(s) {
  const sh = oppShift(s);
  const inner = wallR(s) + 0.3 + sh;
  const lanesIn = inner + 0.75;
  const half2 = halfWidth(s);
  const lanesOut = lanesIn + half2 * 2;
  const outer = lanesOut + SHOULDER_L;
  return { inner, lanesIn, lanesOut, outer, wall: outer + 0.3, half: half2, sep: sh > 0.6 };
}

// 区間の種類（地面の作り方）。'fill' = 地面を道路に合わせる（平地・盛土・切土）、'bridge' = 高架・橋（地面はそのまま）、'tunnel'
export function sectionAt(s) {
  if (s >= SEC.bridge0 && s <= SEC.bridge1) return 'bridge';
  if (s >= SEC.valley0 && s <= SEC.valley1) return 'bridge';
  if (s >= SEC.tunnel0 && s <= SEC.tunnel1) return 'tunnel';
  return 'fill';
}
// 地面を道路に合わせる重み（橋台の前後で 1 → 0。盛土の端はなだらかな斜面になる）
export function fillWeight(s) {
  const w1 = 1 - sstep(SEC.bridge0 - 18, SEC.bridge0 + 14, s) * (1 - sstep(SEC.bridge1 - 14, SEC.bridge1 + 18, s));
  const w2 = 1 - sstep(SEC.valley0 - 16, SEC.valley0 + 14, s) * (1 - sstep(SEC.valley1 - 14, SEC.valley1 + 16, s));
  return Math.min(w1, w2);
}
// 道の外側の壁の種類：'tall'（町の近く。高い防音壁）/ 'clear'（高架。透明板）/ 'low'（谷の橋。高欄＋手すり）/
//   'jersey'（山あい・切土。コンクリートの低い壁だけ。法面や谷の景色が見える）/ 'plaza'（料金所）/ 'tunnel'（トンネルの中）
export function wallKind(s) {
  if (s < SEC.taperEnd - 30) return 'plaza';
  if (s >= SEC.tunnel0 - 2 && s <= SEC.tunnel1 + 2) return 'tunnel';
  if (s >= SEC.valley0 - 6 && s <= SEC.valley1 + 6) return 'low';
  if (s >= SEC.bridge0 - 10 && s <= SEC.bridge1 + 8) return 'clear';
  if (s > SEC.bridge1 + 8) return 'jersey';
  return 'tall';
}

// 一般車の計画（決まった並び。追い越しを楽しむ）。
//   全車が同じ速さ TRAFFIC_V で走るので、車どうしの並びは変わらない。「列」ごとに 1〜2 台で、必ず 1 車線は空け、
//   空いている車線は前の列のとなりか同じ（2 車線いっぺんの移動は間に合わない）。プレイヤーが標準的な速さで走ると
//   ちょうど encounter [m] の位置で追いつくように、最初の位置 s0 を逆算する（スタートのランプが消える瞬間 = 時刻 0）。
export function trafficPlan({ startS, raceLength, rnd, pathLength }) {
  // 標準的なプレイヤー（アクセル全開）がスタートから x [m] 進むのにかかる時間
  const tAt = (() => { const tab = []; let v = 0, x = 0, t = 0; const dt = 1 / 60; while (x < pathLength + 50) { tab.push([x, t]); const a = motorAccel(v).a; const nv = Math.min(TOP_MS, v + a * dt); x += (v + nv) / 2 * dt; v = nv; t += dt; } tab.push([x, t]); return (q) => { let lo = 0, hi = tab.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m][0] < q) lo = m; else hi = m; } const [x0, t0] = tab[lo], [x1, t1] = tab[hi]; return t0 + (t1 - t0) * (q - x0) / Math.max(1e-6, x1 - x0); }; })();
  const V = TRAFFIC_V;
  const TYPES = { car: [0.6, ['sedan', 'sedan', 'kei', 'minivan', 'suv', 'sedan', 'kei']], big: [0.4, ['truck', 'truck', 'bus', 'truck', 'van']] };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  const list = [];
  const sEnd = startS + raceLength - 35;
  let free = 1, k = 0;
  for (let se = 330; se < sEnd; k++) {
    // この列の空き車線と、ふさぐ車線
    const r = rnd();
    free = k === 0 ? 2 : Math.max(0, Math.min(2, free + (r < 0.35 ? -1 : r < 0.7 ? 1 : 0)));
    const two = k > 0 && rnd() < 0.42;
    let lanes = [0, 1, 2].filter((i) => i !== free);
    if (!two) lanes = [lanes[Math.floor(rnd() * lanes.length) % lanes.length]];
    for (const ln of lanes) {
      // 左の車線（走行車線）はトラック・バスが多い
      const big = ln === 0 ? rnd() < 0.65 : rnd() < 0.18;
      const type = pick(big ? TYPES.big[1] : TYPES.car[1]);
      const seC = se + (rnd() - 0.5) * 6;
      const s0 = seC - V * tAt(seC - startS);
      if (s0 < 125) continue;   // スタートのランプの間に料金所の中に見えてしまう車は出さない
      list.push({ s0, lane: ln, type, seed: Math.floor(rnd() * 1e6), enc: seC });
    }
    // 次の列までの間隔（追いつく位置で 64〜86 m）
    se += 64 + rnd() * 22;
  }
  // 並びの確認：同じ車線の車どうしは前後 14 m 以上あける（重なり防止）
  list.sort((a, b) => a.s0 - b.s0);
  for (let i = 0; i < list.length; i++) for (let j = 0; j < i; j++) {
    if (list[j].lane === list[i].lane && list[i].s0 - list[j].s0 < 16) list[i].s0 = list[j].s0 + 16;
  }
  return list;
}

// layout（コースの build() の戻り値）を作る
export function buildLayout(opts, LENGTH_FACTOR, rnd) {
  const p = makePath();
  const path = p.build({ ds: 1 });
  const L = p.length;
  // 道路の高さ：料金所は平ら → 盛土で上って高架（約 11 m）→ トンネルでゆっくり下る → 谷の橋 → 下り
  const elev0 = profile([[0, 0], [SEC.embank0, 0.2], [SEC.bridge0, 9.8], [SEC.bridge0 + 80, 11.2], [SEC.jct, 11.6], [SEC.bridge1, 11.0],
    [SEC.tunnel0, 10.2], [SEC.tunnel1, 7.4], [SEC.valley0, 7.8], [SEC.valley1, 7.2], [1600, 5.2], [1800, 3.4], [L, 2.6]]);
  const elevation = (s) => BASE + elev0(s);
  const edges = (s, side) => {
    const isl = s < ISLAND_END;
    const kind = sectionAt(s);
    const verge = kind === 'bridge' ? 0.6 : kind === 'tunnel' ? 0.4 : 1.2;
    return side < 0
      ? { kerb: 0, runoff: 'asphalt', runoffW: SHOULDER_L, barrier: 'wall', barrierD: isl ? BOOTH.pitch / 2 - BOOTH.islandW / 2 + 0.0 : wallL(s), verge }
      : { kerb: 0, runoff: 'asphalt', runoffW: SHOULDER_R, barrier: 'wall', barrierD: isl ? BOOTH.pitch / 2 - BOOTH.islandW / 2 + 0.0 : wallR(s), verge: 0.5 };
  };
  const startS = START_S;
  const raceLength = Math.round(1150 * (LENGTH_FACTOR[opts.length] || 1));
  // 一般車（コーン ON のときの障害物。コーンと同じく当たると +1 秒）
  const traffic = opts.cones ? trafficPlan({ startS, raceLength, rnd, pathLength: L }) : [];
  return {
    path, width: (s) => halfWidth(s) * 2, elevation, edges, ground: 'grass', startS, raceLength, cones: [], marks: p.marks,
    traffic, sLine: LINE_S, pathLength: L,
    farGroundY: FAR_Y + 1.5,   // 遠くの地面の高さの希望（stage.js が対応したら使われる。今は runtime.js で下げている）
    terrain: false,     // 地面はこのコースが自分で作る（高架の下・トンネルの山・谷のため）
    trackStyle: {
      vergeMat: 'concrete', barriers: false, chunk: 1150,   // 路面の区画を大きく（まっすぐ長いコースは先まで見えるので、描画の呼び出しを減らす）
      markings: [
        { edge: -1, inset: 0.15, w: 0.2, from: SEC.plazaEnd + 10 }, { edge: 1, inset: 0.15, w: 0.2, from: SEC.plazaEnd + 10 },
        { d: -LANE_W / 2, w: 0.15, dash: [8, 12], from: SEC.taperEnd - 5 }, { d: LANE_W / 2, w: 0.15, dash: [8, 12], from: SEC.taperEnd - 5 },
      ],
    },
  };
}
