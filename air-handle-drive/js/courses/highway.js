// 高速道路：夕暮れ（マジックアワー）の首都高風の都市高速。
// 料金所（ETC レーンからスタート。開閉バーとスタートのシグナル）→ 3 車線へ合流 → 防音壁の区間 → 盛土で上って高架
// （町と川を見下ろす・ジャンクションの立体交差）→ トンネル（オレンジの照明が流れる）→ 谷の橋 → 山あいの区間 → 出口。
// 一般車（ゆっくり走るトラック・乗用車・バス）を追い越して走る。一般車に当たるとコーンと同じ +1 秒。
// 部品は highway/ 以下（layout = 形（three.js なし）、ground = 地面、structures / bridge / tunnel / plaza = 構造物、
// signs = 標識、town = 町・遠景、traffic = 一般車）。
import { LENGTH_FACTOR } from './common.js';
import { mulberry32 } from '../engine/textures.js';
import { buildLayout } from './highway/layout.js';
import { makeGround, buildGround, buildFarHills, groundMaterial } from './highway/ground.js';
import { buildTunnel } from './highway/tunnel.js';
import { buildBridges } from './highway/bridge.js';
import { buildTraffic } from './highway/traffic.js';
import { makeRuntime } from './highway/runtime.js';
import { buildPlaza } from './highway/plaza.js';
import { buildSigns, finishSigns, Atlas } from './highway/signs.js';
import { MergeBuilder } from '../engine/props.js';
import { MAT } from '../engine/textures.js';
import { buildTown } from './highway/town.js';
import { HMAT } from './highway/tex.js';
import * as THREE from 'three';
import { Batch, buildOpposite, buildWalls, buildLights } from './highway/structures.js';

export default {
  id: 'highway',
  name: '高速道路',
  nameEn: 'TAKUDEN EXPRESSWAY',
  desc: '夕暮れの高速道路を全開で。\n一般車をぬって追い越せ！',
  accent: '#2e7d32',
  difficulty: 1,
  latG: 2.0,
  thumb: { s: 560, d: -34, h: 20, look: 700 },   // カード：高架から町とジャンクション・トンネルの山を見る
  // 夕暮れ（マジックアワー）：太陽は北西の低い所。空は橙 → 青、街の明かりがつき始める
  env: {
    sunElevation: 3.5, sunAzimuth: 338, turbidity: 9, rayleigh: 3.2, mie: 0.012, mieG: 0.93, skyIntensity: 0.45, skySaturation: 1.3,
    clouds: { cover: 0.5, sharp: 0.3, scale: 0.75, speed: 0.006, opacity: 0.85, color: [1.0, 0.6, 0.45], bright: 1.0 },
    sunIntensity: 3.4, sunColor: [1.0, 0.52, 0.26], ambient: 1.05, envIntensity: 1.25, groundColor: [0.3, 0.22, 0.18],
    fogDensity: 0.0006, fogColor: [0.95, 0.5, 0.3],
    mountains: { count: 2, height: 360, dist: 3000, color: [0.05, 0.05, 0.12], seed: 21 },
    shadowSize: 120, night: 0.35,
  },
  grade: { exposure: 1.2, saturation: 1.12, contrast: 1.06, vignette: 0.32, tint: [1.02, 0.98, 0.96], bloom: { strength: 0.42, radius: 0.55, threshold: 1.5 } },

  build(opts) {
    return buildLayout(opts, LENGTH_FACTOR, mulberry32((opts.seed || 7) * 31 + 5));
  },

  decorate(ctx) {
    const { track, group, rnd } = ctx;
    // 景色はこのコースの道具で、大きな区画（1 km）ごとにまとめる（まっすぐ長いコースは先まで見えるので、描画の呼び出しを減らす方が効く）
    ctx = Object.create(ctx);
    ctx.mb = new MergeBuilder({ cell: 1000 });
    ctx.atlas = new Atlas();          // 看板・標識の文字の面（1 枚にまとめて 1 つの材質で描く）
    ctx.signFaces = new Batch();
    ctx.neon = { atlas: new Atlas(1024, 1024), faces: new Batch() };   // 光る看板（ビルの屋上）
    ctx.lines = new Batch();          // 白線（路面より少し手前に描くので、まとめずに別の形にする）
    ctx.glow = new Batch();   // 光る物はここに集めて最後に 1 つの形にする
    const G = makeGround(track, rnd);
    group.add(buildGround(track, G));
    group.add(buildFarHills(track, G));
    buildOpposite(ctx);
    buildWalls(ctx);
    buildLights(ctx);
    ctx.groundMat = groundMaterial();
    const tun = buildTunnel(ctx, G);
    buildBridges(ctx, G);
    const traffic = buildTraffic(ctx);
    group.userData.hwTraffic = traffic;   // 検証用（window.__dbg.stage.root から見える）
    const plaza = buildPlaza(ctx, G);
    buildSigns(ctx, G);
    const town = buildTown(ctx, G, { surfaceY: tun.surfaceY });
    let time = 0;
    const rt = makeRuntime(ctx, G);
    { const g = ctx.glow.build(); if (g) { const m = new THREE.Mesh(g, HMAT.glow()); m.name = 'hw-glow'; m.matrixAutoUpdate = false; m.frustumCulled = false; group.add(m); } }
    finishSigns(ctx);
    { const g = ctx.lines.build(); if (g) { const m = new THREE.Mesh(g, MAT.line()); m.name = 'hw-lines'; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); } }
    ctx.mb.build(group);
    return {
      setStartLights: (n, c) => plaza.setStartLights(n, c),
      update: (dt, info) => { time += dt; traffic.update(dt, info); rt.update(dt, info); plaza.update(dt, info); town.update(dt, time); },
      camOk: rt.camOk,
      traffic,
    };
  },
};
