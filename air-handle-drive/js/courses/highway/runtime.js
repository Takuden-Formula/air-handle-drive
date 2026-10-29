// 毎フレームの演出：トンネルの中の明かり（太陽の光・空の映り込みを弱め、ナトリウム灯の橙にする）、
// 中継カメラを使ってよい所（トンネルや深い切土の中では、外のカメラが山の中に入ってしまう）
import * as THREE from 'three';
import { SEC, FAR_Y } from './layout.js';
import { tunnelFactor } from './tunnel.js';

export function makeRuntime(ctx, G) {
  const { track } = ctx;
  let scene = null, hemi = null, sun = null, sky = null, saved = null, farGround = null;
  const orange = new THREE.Color(1.0, 0.6, 0.3), orangeG = new THREE.Color(0.5, 0.3, 0.14);
  const findScene = () => {
    let o = ctx.group; while (o.parent) o = o.parent;
    if (!o.isScene) return null;
    if (o !== scene) {
      scene = o; hemi = null; sun = null; sky = null; saved = null;
      for (const c of scene.children) { if (c.isHemisphereLight) hemi = c; else if (c.isDirectionalLight) sun = c; else if (c.name === 'sky') sky = c; else if (c.name === 'farGround') farGround = c; }
    }
    return scene;
  };
  // 切土の深さ（中継カメラの判断用）。10 m ごと
  const cut = new Float32Array(Math.ceil(track.length / 10) + 1);
  const v = new THREE.Vector3();
  for (let i = 0; i < cut.length; i++) {
    const s = Math.min(track.length, i * 10); let m = -99;
    for (const d of [-16, 26]) { track.toWorld(s, d, 0, v); m = Math.max(m, G.base(v.x, v.z) - track.heightAt(s, 0)); }
    cut[i] = m;
  }
  const deepCut = (s0, s1) => { for (let s = s0; s <= s1; s += 10) { const i = Math.round(s / 10); if (i >= 0 && i < cut.length && cut[i] > 5) return true; } return false; };
  let k = 0;
  return {
    update(dt) {
      if (!findScene() || !hemi) return;
      // 遠くの地面（world.js）は「道路の一番低い所 − 3.5 m」に置かれるが、このコースは谷底がそれより低いので下げる
      if (farGround && farGround.position.y > FAR_Y) farGround.position.y = FAR_Y;
      // カメラの位置（world.js が空の球をカメラの位置に置いている）でトンネルの中かを決める
      let target = 0;
      if (sky) {
        const p = sky.position, nr = track.nearest(p.x, p.z, 30);
        if (nr && nr.d > -9 && nr.d < 7.5 && p.y < track.heightAt(nr.s, 0) + 7.4) target = tunnelFactor(nr.s);
      }
      k = target;
      if (k > 0.002) {
        if (!saved) saved = { hi: hemi.intensity, hc: hemi.color.clone(), hg: hemi.groundColor.clone(), env: scene.environmentIntensity ?? 1, si: sun ? sun.intensity : 0 };
        hemi.intensity = saved.hi + (2.1 - saved.hi) * k;
        hemi.color.copy(saved.hc).lerp(orange, k); hemi.groundColor.copy(saved.hg).lerp(orangeG, k);
        scene.environmentIntensity = saved.env + (0.12 - saved.env) * k;
        if (sun && !sun.castShadow) sun.intensity = saved.si * (1 - k);
      } else if (saved) {
        hemi.intensity = saved.hi; hemi.color.copy(saved.hc); hemi.groundColor.copy(saved.hg); scene.environmentIntensity = saved.env;
        if (sun) sun.intensity = saved.si;
        saved = null;
      }
    },
    // 中継カメラ（mode）を、車が s の所にいるときに使ってよいか
    camOk(mode, s) {
      if (mode === 'chase' || mode === 'grid' || mode === 'orbit') return true;
      if (s > SEC.tunnel0 - 110 && s < SEC.tunnel1 + 30) return false;
      if (mode === 'tv' && deepCut(s + 40, s + 130)) return false;
      return true;
    },
    get tunnelK() { return k; },
  };
}
