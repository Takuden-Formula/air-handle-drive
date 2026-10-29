// 描画の土台：WebGLRenderer、ポストエフェクト（ブルーム・スピード感のぼかし・周辺減光・色調整・トーンマップ・FXAA）、
// 画質の段階（品質ティア）、画面サイズの変更。
// 使い方: const r = new Renderer(canvas); r.setQuality(2); 毎フレーム r.render(scene, camera, { speed01, flash, ... })
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { setMaxAnisotropy } from './textures.js';

// 画質の段階。低いほど軽い。scale = 描画解像度の倍率、shadow = 影の解像度（0 で影なし）、msaa = アンチエイリアスのサンプル数
export const QUALITY = [
  { name: '低', scale: 0.6, shadow: 0, msaa: 0, post: false, bloom: false, fxaa: false, deco: 0.35, maxDpr: 1 },
  { name: '中', scale: 0.8, shadow: 1024, msaa: 0, post: true, bloom: true, fxaa: true, deco: 0.6, maxDpr: 1 },
  { name: '高', scale: 1.0, shadow: 2048, msaa: 4, post: true, bloom: true, fxaa: false, deco: 1, maxDpr: 1 },
  { name: '最高', scale: 1.0, shadow: 4096, msaa: 4, post: true, bloom: true, fxaa: false, deco: 1, maxDpr: 1.5 },
];

// 仕上げのシェーダ：放射状のぼかし（速さ）→ 色調整 → 周辺減光 → ACES トーンマップ → sRGB
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, exposure: { value: 1 }, blur: { value: 0 }, center: { value: new THREE.Vector2(0.5, 0.5) },
    vignette: { value: 0.35 }, saturation: { value: 1.05 }, contrast: { value: 1.04 }, tint: { value: new THREE.Color(1, 1, 1) },
    lift: { value: new THREE.Color(0, 0, 0) }, flash: { value: new THREE.Vector4(1, 1, 1, 0) }, grain: { value: 0.025 }, time: { value: 0 },
    aspect: { value: 1.78 }, chroma: { value: 0.0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float exposure, blur, vignette, saturation, contrast, grain, time, aspect, chroma;
    uniform vec2 center; uniform vec3 tint, lift; uniform vec4 flash;
    varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
    vec3 aces(vec3 c){
      const mat3 i = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
      const mat3 o = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
      c *= exposure / 0.6; c = i * c; c = RRTAndODTFit(c); c = o * c; return clamp(c, 0.0, 1.0);
    }
    vec3 srgb(vec3 c){ return mix(c * 12.92, pow(c, vec3(1.0/2.4)) * 1.055 - 0.055, step(0.0031308, c)); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec2 d = vUv - center;
      float r = length(d * vec2(aspect, 1.0));
      vec3 col;
      if (blur > 0.001) {
        // 中心から外へ向かってぼかす（中心付近はぼかさない）。chroma > 0 なら赤と青を少しずらす（色収差）
        float k = blur * smoothstep(0.12, 0.9, r);
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          vec2 o = d * k * t * 0.08;
          col.r += texture2D(tDiffuse, vUv - o * (1.0 + chroma)).r;
          col.g += texture2D(tDiffuse, vUv - o).g;
          col.b += texture2D(tDiffuse, vUv - o * (1.0 - chroma)).b;
        }
        col /= 8.0;
      } else col = texture2D(tDiffuse, vUv).rgb;
      col = col * tint + lift;
      col = aces(col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col *= 1.0 - vignette * smoothstep(0.35, 1.05, r);
      col = mix(col, flash.rgb, flash.a);
      col = clamp(col, 0.0, 1.0);
      col = srgb(col);
      col += (hash(vUv * 731.0) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;   // ポストエフェクトなし（低画質）のときに使う
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    setMaxAnisotropy(r.capabilities.getMaxAnisotropy());
    this.tier = -1; this.exposure = 1; this.grade = {};
    this.size = new THREE.Vector2();
    this.final = new THREE.ShaderMaterial({ ...FinalShader, uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms), depthTest: false, depthWrite: false, toneMapped: false });
    this.finalQuad = new FullScreenQuad(this.final);
    this.fxaa = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
    this.fxaaQuad = new FullScreenQuad(this.fxaa);
    this.sceneRT = null; this.ldrRT = null; this.bloom = null;
    this.onQualityChange = null;   // (tier) => {}  影の解像度などを外で変えるとき
    window.addEventListener('resize', () => this.resize());
    this.setQuality(2);
  }

  get renderer() { return this.r; }
  get quality() { return this.tier; }
  get q() { return QUALITY[this.tier]; }

  setQuality(tier) {
    tier = Math.max(0, Math.min(QUALITY.length - 1, tier | 0));
    if (tier === this.tier) return;
    this.tier = tier;
    const q = QUALITY[tier];
    this.r.shadowMap.enabled = q.shadow > 0;
    this.r.shadowMap.needsUpdate = true;
    this._disposeTargets();
    this.resize(true);
    if (this.onQualityChange) this.onQualityChange(tier, q);
  }

  _disposeTargets() {
    if (this.sceneRT) this.sceneRT.dispose(); if (this.ldrRT) this.ldrRT.dispose(); if (this.bloom) this.bloom.dispose();
    this.sceneRT = this.ldrRT = this.bloom = null;
  }

  // 描画解像度 = 画面の CSS サイズ × devicePixelRatio（上限あり）× 段階の倍率。1920×1080 を超えないようにする
  resize(force = false) {
    const q = QUALITY[this.tier];
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    let pr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.scale;
    const cap = Math.min(1, (q.maxDpr > 1 ? 2560 : 1920) / (w * pr), (q.maxDpr > 1 ? 1440 : 1080) / (h * pr));
    pr *= cap;
    if (!force && this._w === w && this._h === h && this._pr === pr) return;
    this._w = w; this._h = h; this._pr = pr;
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, true);
    this.r.getDrawingBufferSize(this.size);
    const W = this.size.x, H = this.size.y;
    if (q.post) {
      if (!this.sceneRT) {
        this.sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true });
        this.ldrRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
        if (q.bloom) this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.5, 1.5);
      } else {
        this.sceneRT.setSize(W, H); this.ldrRT.setSize(W, H); if (this.bloom) this.bloom.setSize(W, H);
      }
      this.fxaa.uniforms.resolution.value.set(1 / W, 1 / H);
    }
    this.final.uniforms.aspect.value = W / H;
    if (this.onResize) this.onResize(w, h);
  }

  // 色調整（コースの雰囲気）。g: { exposure, saturation, contrast, tint:[r,g,b], lift:[r,g,b], vignette, bloom: {strength, radius, threshold} }
  setGrade(g = {}) {
    this.grade = g;
    const u = this.final.uniforms;
    this.exposure = g.exposure ?? 1;
    u.saturation.value = g.saturation ?? 1.06; u.contrast.value = g.contrast ?? 1.04;
    u.tint.value.setRGB(...(g.tint || [1, 1, 1])); u.lift.value.setRGB(...(g.lift || [0, 0, 0]));
    u.vignette.value = g.vignette ?? 0.32;
    this.bloomParams = { strength: 0.35, radius: 0.5, threshold: 1.5, ...(g.bloom || {}) };   // しきい値は明るい空より上（ランプ・太陽・発光だけ光る）
  }

  // fx: { blur(0〜1), flash:[r,g,b,a], chroma }
  render(scene, camera, fx = {}) {
    const r = this.r, q = QUALITY[this.tier];
    r.info.reset();
    if (!q.post) {
      r.toneMappingExposure = this.exposure;
      r.setRenderTarget(null); r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.sceneRT); r.render(scene, camera);
    if (this.bloom) {
      const bp = this.bloomParams || {};
      this.bloom.strength = bp.strength ?? 0.35; this.bloom.radius = bp.radius ?? 0.5; this.bloom.threshold = bp.threshold ?? 1.5;
      this.bloom.render(r, null, this.sceneRT, 0, false);
    }
    const u = this.final.uniforms;
    u.tDiffuse.value = this.sceneRT.texture; u.exposure.value = this.exposure;
    u.blur.value = fx.blur || 0; u.chroma.value = fx.chroma || 0;
    u.time.value = (performance.now() / 1000) % 100;
    if (fx.flash) u.flash.value.set(...fx.flash); else u.flash.value.w = 0;
    if (fx.center) u.center.value.set(fx.center[0], fx.center[1]); else u.center.value.set(0.5, 0.5);
    if (q.fxaa) {
      r.setRenderTarget(this.ldrRT); this.finalQuad.render(r);
      this.fxaa.uniforms.tDiffuse.value = this.ldrRT.texture;
      r.setRenderTarget(null); this.fxaaQuad.render(r);
    } else {
      r.setRenderTarget(null); this.finalQuad.render(r);
    }
  }

  // 小さな画像として描く（コース選択のサムネイル用）。戻り値: canvas
  snapshot(scene, camera, w = 480, h = 270) {
    const r = this.r;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const out = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
    const aspect = camera.aspect; camera.aspect = w / h; camera.updateProjectionMatrix();
    r.setRenderTarget(rt); r.render(scene, camera);
    const u = this.final.uniforms;
    u.tDiffuse.value = rt.texture; u.exposure.value = this.exposure; u.blur.value = 0; u.flash.value.w = 0; u.center.value.set(0.5, 0.5);
    const asp = u.aspect.value; u.aspect.value = w / h;
    r.setRenderTarget(out); this.finalQuad.render(r);
    u.aspect.value = asp;
    const px = new Uint8Array(w * h * 4); r.readRenderTargetPixels(out, 0, 0, w, h, px);
    r.setRenderTarget(null);
    camera.aspect = aspect; camera.updateProjectionMatrix();
    rt.dispose(); out.dispose();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // 上下反転
    g.putImageData(img, 0, 0);
    return c;
  }
}
