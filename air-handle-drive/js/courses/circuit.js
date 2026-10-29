// サーキット：1 周約 1.4 km の国際格式のクローズドコース（鈴鹿・富士のような作り）。
// メインストレート → 1・2 コーナー → 上りの S 字 → 右の高速コーナー → 下りの東ストレート → 2 連の右（デグナー風）
// → ヘアピン → スプーン（180° の右）→ 下りのバックストレート → 高速の右（130R 風）→ シケイン → 最終コーナー。
// 景色は js/courses/circuit/scenery.js（サーキット専用の部品）で作る。
// 他のコースを作るときもこのファイルの形（build と decorate）をまねる。
import { PathBuilder, profile, defaultEdges } from '../engine/track.js';
import { coneZones } from './common.js';
import { decorateCircuit } from './circuit/scenery.js';

// 中心線（時計回り）。数値は直線の長さ [m]、turn(半径 [m], 角度 [度]（+ = 右）)
// main と back の 2 本の直線の長さは、継ぎ目がぴったり閉じるように自動で決まる
function makePath() {
  const p = new PathBuilder({ x: 0, z: 0, heading: 0 });
  p.mark('main').straight(220, { id: 'main' })
    .mark('T1').turn(55, 60).mark('T2').turn(28, 60).mark('T2x')
    .straight(10)
    .mark('S1').turn(34, -50).mark('S2').turn(34, 60).mark('S3').turn(34, -60).mark('S4').turn(38, 40).mark('Sx')
    .straight(10)
    .mark('dunlop').turn(55, 60).mark('dunlopX')
    .straight(120).mark('east')
    .mark('degner').turn(30, 40).mark('degner2').straight(8).turn(22, 60).mark('degnerX')
    .straight(30)
    .mark('hairpin').turn(14, -180).mark('hairpinX')
    .straight(30)
    .mark('spoon').turn(32, 180).mark('spoonX')
    .straight(200, { id: 'back' }).mark('back')
    .mark('r130').turn(90, 25).mark('r130x')
    .straight(30)
    .mark('chicane').turn(13, 45).mark('chicane2').turn(13, -45).mark('chicaneX')
    .straight(20)
    .mark('final').turn(40, 65).mark('end');
  return p;
}

export const HALF = 6;        // 道幅 12 m
export const PIT = { d0: HALF + 3.2, d1: HALF + 15.5 };   // ピットレーン（メインストレートの右）の横の範囲 [m]

export default {
  id: 'circuit',
  name: 'サーキット',
  nameEn: 'TAKUDEN CIRCUIT',
  desc: '国際格式のサーキットを1周。\nS字・ヘアピン・スプーン・シケイン',
  accent: '#e53935',
  difficulty: 2,
  latG: 2.0,          // コーナーでこの横 G まで自動で減速する
  // コース選択のカードの視点：グリッドの後ろの斜め上から、スタンドとピットとガントリーを見る
  thumb: { s: -32, d: 13, h: 15, look: 70 },
  // 晴れた日の昼過ぎ（太陽は南南西）。空気は澄んで、遠くの山がくっきり
  env: {
    sunElevation: 40, sunAzimuth: 212, turbidity: 2.4, rayleigh: 1.15, mie: 0.004, skyIntensity: 0.6,
    clouds: { cover: 0.38, sharp: 0.32, scale: 0.75, speed: 0.006, opacity: 0.92, bright: 1.15 },
    sunIntensity: 3.6, ambient: 0.36, envIntensity: 0.95, fogDensity: 0.00065, groundColor: [0.2, 0.24, 0.17],
    mountains: { count: 4, height: 300, dist: 2300, color: [0.30, 0.40, 0.48], seed: 11 },
  },
  grade: { exposure: 1.0, saturation: 1.12, contrast: 1.07, vignette: 0.28 },

  // 走るための形（three.js を使わないデータ）。opts: { length, cones }
  build(opts) {
    const p = makePath();
    const path = p.build({ ds: 1, close: true, solve: ['main', 'back'] });
    const M = p.marks, L = p.length, half = HALF;
    // 高低差：メインストレートは平ら。S 字で上ってダンロップ（右の高速）が一番高く、東ストレートを下ってヘアピン、
    // スプーンで少し上ってバックストレートを下る（実在のサーキットと同じく勾配は 5% 以下）
    const elevation = profile([
      [0, 0], [M.T1, -0.4], [M.T2x, -1.2], [M.S1 + 20, -0.8], [M.S3, 4.0], [M.Sx, 8.6], [M.dunlopX, 11.6],
      [M.east, 7.6], [M.degnerX, 4.0], [M.hairpin, 3.0], [M.hairpinX, 3.0], [M.spoon + 40, 4.2], [M.spoonX, 5.8],
      [M.spoonX + 60, 4.8], [M.back, 1.4], [M.r130x, 0.2], [M.chicaneX, 0], [L, 0],
    ], { period: L });
    // 少しだけバンク（右コーナーは右が低い = +）
    const bank = profile([
      [0, 0], [M.T1 + 10, 0.025], [M.T2x, 0.01], [M.spoon + 20, 0.04], [M.spoonX - 20, 0.04], [M.spoonX + 30, 0],
      [M.r130 + 10, 0.03], [M.r130x, 0], [L, 0],
    ], { period: L });
    const inR = (s, a, b) => (a <= b ? s >= a && s <= b : s >= a || s <= b);
    // 道の脇
    const edges = (s, side, info) => {
      // メインストレート：左（西）はグランドスタンドの前の金網、右はピットウォール（その外がピットレーン）
      if (inR(s, L - 38, M.T1 - 6)) {
        return side < 0
          ? { kerb: 0, runoff: 'asphalt', runoffW: 2.6, barrier: 'fence', barrierD: half + 3.4, verge: 18 }
          : { kerb: 0, runoff: 'asphalt', runoffW: PIT.d1 - half, barrier: 'wall', barrierD: half + 2.2, verge: 2 };
      }
      // ピットの入口（最終コーナーの内側）と出口（1 コーナーの内側）：舗装を広げてピットレーンにつなぐ
      if (side > 0 && (inR(s, L - 75, L - 38) || inR(s, M.T1 - 6, M.T1 + 40))) {
        const e = defaultEdges(s, side, info);
        return { ...e, runoff: 'asphalt', runoffW: PIT.d1 - half - 2, barrier: 'none', barrierD: PIT.d1 + 1, verge: 3 };
      }
      const e = defaultEdges(s, side, info);
      const k = Math.abs(info.kappa), outside = Math.sign(info.kappa) === -side, corner = k > 1 / 140;
      // シケイン：両側に縁石と舗装のランオフ（ショートカットしても砂利で止まらないように）、外はタイヤバリア
      if (inR(s, M.chicane - 12, M.chicaneX + 10)) return { kerb: 1.4, runoff: 'asphalt', runoffW: 9, barrier: 'tires', barrierD: half + 1.4 + 10 };
      // 速いコーナーの外（1 コーナー・ダンロップ・130R・最終）は舗装のランオフ＋タイヤバリア（現代のサーキット）
      if (corner && outside && (inR(s, M.T1 - 10, M.T2) || inR(s, M.dunlop - 10, M.dunlopX + 10) || inR(s, M.r130 - 10, M.r130x + 10) || inR(s, M.final - 10, L - 38))) {
        return { kerb: 1.5, runoff: 'asphalt', runoffW: 13, barrier: 'tires', barrierD: half + 1.5 + 14.5 };
      }
      // 遅いコーナーの外（2 コーナー・ヘアピン・スプーン・デグナー）は砂利＋タイヤバリア（既定）
      if (corner && outside) return { ...e, kerb: 1.4, runoffW: k > 1 / 25 ? 15 : 12, barrierD: half + 1.4 + (k > 1 / 25 ? 16 : 13) };
      // バックストレート：観客の土手の前は金網
      if (!corner && inR(s, M.spoonX + 15, M.back - 5)) return { kerb: 0, runoff: 'grass', runoffW: 7, barrier: 'fence', barrierD: half + 8, verge: 10 };
      return e;
    };
    // 長さの設定：ふつう = 1 周、みじかい = 東ストレートでゴール（約半周）、ながい = 1 周してもう一度東ストレートの入口まで（約 1.4 周）
    // ながいを 2 周にしないのは、理論最速が 100 秒を越えて既定の制限時間（90 秒）に収まらないため（ほかのコースも「ながい」は 1.5 倍）
    const sLine = 46;                         // スタート / ゴールライン
    const startS = sLine - 3;                 // 車の中心のスタート位置（ラインの 3 m 手前）
    const shortLen = (M.east - 12) - startS;
    let raceLength;
    const laps = 1;
    if (opts.length === 'short') raceLength = shortLen;
    else if (opts.length === 'long') raceLength = L + (M.dunlopX + 40) - startS;   // 目標タイム（理論最速 +20%）が 90 秒に収まる長さ
    else raceLength = L + 3;
    // コーン（練習用のパイロン）：バックストレートの前半はスラローム、後半は車線ふさぎ。
    // ゴールの後（みじかい・ながいのゴールは東ストレート）に惰性で走ってコーンに当たらないよう、東ストレートには置かない
    const rnd = mulberry(opts.seed || 7);
    const tmp = { halfWidth: () => half };
    const zones = [
      { s0: M.spoonX + 6, s1: M.spoonX + 68, kind: 'slalom', step: 12 },
      { s0: M.spoonX + 72, s1: M.back - 6, kind: 'lane' },
    ];
    const cones = opts.cones ? coneZones(tmp, zones, rnd) : [];   // 2 回通るときも同じコーン（はね飛ばした物はそのまま）
    return {
      path, width: half * 2, elevation, bank, edges, ground: 'grass',
      startS, raceLength, laps, cones, sLine, marks: M, pitD1: PIT.d1,
      terrain: { amp: 26, scale: 300, flat: 46, ramp: 240, seed: 4 },
      // 白線：左端は track.js、右端は circuit/trackside.js の roadPaint で描く（track.js は同じ色の線を 2 本にすると
      // 区画の中で線の終わりと次の線の始まりが細い三角形でつながってしまうため。直ったら 2 本ともここに戻してよい）
      trackStyle: { markings: [{ edge: -1, inset: 0.25, w: 0.2 }] },
    };
  },

  // 景色（three.js）。ctx は engine/stage.js を参照。中身は js/courses/circuit/scenery.js
  decorate(ctx) { return decorateCircuit(ctx); },
};

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
