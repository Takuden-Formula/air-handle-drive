// コース共通の環境：空（大気散乱＋雲）、太陽の光と影（車に追従）、環境マップ（車の映り込み）、霧、遠くの山並み。
// コースは course.env で時間帯・天気を渡す（ENV_DEFAULT を参照）。
import * as THREE from 'three';
import { mulberry32 } from './textures.js';

// 環境の既定値。コースの env はこれに上書きされる
export const ENV_DEFAULT = {
  sunElevation: 38,        // 太陽の高さ [度]
  sunAzimuth: 210,         // 太陽の方角 [度]（0 = -Z（マップの上）、90 = +X、時計回り）
  turbidity: 3.2, rayleigh: 1.4, mie: 0.006, mieG: 0.82,   // 空の色（大気散乱）
  skyIntensity: 1.0, skySaturation: 1.25,
  clouds: { cover: 0.42, sharp: 0.18, scale: 0.9, speed: 0.004, opacity: 0.95, color: [1, 1, 1], bright: 1.1 },
  sunIntensity: 3.2, sunColor: null,   // null = 太陽の高さから自動
  ambient: 0.35,           // 半球光の強さ
  envIntensity: 1.0,       // 環境マップ（反射）の強さ
  groundColor: [0.20, 0.27, 0.14],   // 環境マップの下半分（地面の色）
  fogDensity: 0.0011,      // 霧（大気遠近）の濃さ
  fogColor: null,          // null = 地平線の空の色に合わせる
  mountains: { count: 3, height: 220, dist: 2600, color: [0.36, 0.46, 0.55], seed: 5 },
  shadowSize: 110,         // 影を落とす範囲 [m]
  night: 0,                // 0〜1（夜の度合い。街灯の明かりなどはコース側で）
  stars: 0,
};

const SkyShader = {
  uniforms: {
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, rayleigh: { value: 1.4 }, turbidity: { value: 3 }, mieCoefficient: { value: 0.006 }, mieDirectionalG: { value: 0.82 },
    intensity: { value: 1 }, time: { value: 0 }, cloudCover: { value: 0.42 }, cloudSharp: { value: 0.18 }, cloudScale: { value: 0.9 }, cloudOpacity: { value: 0.95 },
    cloudColor: { value: new THREE.Color(1, 1, 1) }, hazeColor: { value: new THREE.Color(0.7, 0.8, 0.9) }, envMode: { value: 0 }, wind: { value: new THREE.Vector2(1, 0.3) },
    stars: { value: 0 }, cloudBright: { value: 1.1 }, skySat: { value: 1.25 },
  },
  vertexShader: /* glsl */`
    uniform vec3 sunDir; uniform float rayleigh, turbidity, mieCoefficient;
    varying vec3 vDir; varying float vSunfade; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
    const float e = 2.718281828459045; const float pi = 3.141592653589793;
    const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
    const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
    const float cutoffAngle = 1.6110731556870734; const float steepness = 1.5; const float EE = 1000.0;
    void main(){
      vDir = normalize(position);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w;
      float zc = clamp(sunDir.y, -1.0, 1.0);
      vSunE = EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zc)) / steepness)));
      vSunfade = 1.0 - clamp(1.0 - exp(sunDir.y / 450000.0), 0.0, 1.0);
      vBetaR = totalRayleigh * (rayleigh - (1.0 - vSunfade));
      vBetaM = 0.434 * (0.2 * turbidity) * 10E-18 * MieConst * mieCoefficient;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 sunDir; uniform float mieDirectionalG, intensity, time, cloudCover, cloudSharp, cloudScale, cloudOpacity, envMode, stars, cloudBright, skySat;
    uniform vec3 cloudColor, hazeColor; uniform vec2 wind;
    varying vec3 vDir; varying float vSunfade; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
    const float pi = 3.141592653589793;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += noise(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    void main(){
      vec3 dir = normalize(vDir);
      vec3 up = vec3(0.0, 1.0, 0.0);
      float zenithAngle = acos(max(0.0, dot(up, dir)));
      float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
      vec3 Fex = exp(-(vBetaR * 8.4E3 * inv + vBetaM * 1.25E3 * inv));
      float cosTheta = dot(dir, sunDir);
      float rPhase = 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
      float g2 = mieDirectionalG * mieDirectionalG;
      float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * mieDirectionalG * cosTheta + g2, 1.5));
      vec3 bR = vBetaR * rPhase, bM = vBetaM * mPhase;
      vec3 Lin = pow(vSunE * ((bR + bM) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
      Lin *= mix(vec3(1.0), pow(vSunE * ((bR + bM) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, sunDir), 5.0), 0.0, 1.0));
      vec3 L0 = vec3(0.1) * Fex;
      // 太陽（環境マップ用はまぶしすぎないよう小さく）
      float disk = smoothstep(0.99990, 0.99996, cosTheta);
      L0 += vSunE * (envMode > 0.5 ? 60.0 : 1600.0) * Fex * disk;
      L0 += vSunE * 0.6 * pow(max(cosTheta, 0.0), 300.0) * Fex;     // 太陽のまわりの光
      vec3 col = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
      col = pow(col, vec3(1.0 / (1.2 + 1.2 * vSunfade)));
      { float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = max(mix(vec3(l), col, skySat), 0.0); }   // 空の青さ
      // 星（夜）
      if (stars > 0.0 && dir.y > 0.0) { vec2 sp = floor(dir.xz / (dir.y + 0.3) * 400.0); float st = step(0.9975, hash(sp)); col += vec3(st) * stars * smoothstep(0.0, 0.3, dir.y); }
      // 雲（平面に投影した fBm）
      if (dir.y > 0.0 && cloudOpacity > 0.0) {
        vec2 p = dir.xz / (dir.y + 0.12) * cloudScale + wind * time;
        float n = fbm(p * 1.3);
        float dens = smoothstep(cloudCover, cloudCover + cloudSharp, n);
        float n2 = fbm(p * 1.3 + sunDir.xz * 0.06);
        float lit = clamp(0.6 + (n - n2) * 5.0, 0.45, 1.15);
        float sunL = pow(max(cosTheta, 0.0), 8.0);
        vec3 sunC = vec3(1.0, 0.93, 0.85) * clamp(vSunE / 700.0, 0.0, 1.4);
        // 雲は空より明るく（空全体の intensity で暗くなりすぎないよう、ここで割り戻す）
        vec3 cc = cloudColor * (0.55 + 0.6 * lit) * mix(vec3(0.72, 0.77, 0.86), sunC, 0.6) + sunC * sunL * 0.5 * dens;
        cc *= cloudBright / max(intensity, 0.05);
        float fade = smoothstep(0.0, 0.22, dir.y);
        col = mix(col, cc, dens * fade * cloudOpacity);
      }
      // 地平線の霞（霧の色と合わせる）と、地平線より下
      float h = smoothstep(-0.02, 0.16, dir.y);
      col = mix(hazeColor, col, mix(0.35, 1.0, h));
      if (dir.y < 0.0) col = hazeColor;
      gl_FragColor = vec4(col * intensity, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    scene.matrixWorldAutoUpdate = true;
    // 空
    this.skyMat = new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 48, 24), this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10; this.sky.name = 'sky';
    scene.add(this.sky);
    // 太陽の光（影は車のまわりだけ。カメラに追従）
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 600;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a4a2a, 0.35);
    scene.add(this.hemi);
    // 遠くの地面（地形の外側。霧に溶ける）
    this.farGround = new THREE.Mesh(new THREE.CircleGeometry(9000, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x55703a }));
    this.farGround.name = 'farGround'; this.farGround.receiveShadow = false; scene.add(this.farGround);
    this.mountains = null;
    // 環境マップ用の空（太陽は小さく）
    this.envScene = new THREE.Scene();
    this.envSkyMat = this.skyMat.clone(); this.envSkyMat.uniforms = THREE.UniformsUtils.clone(SkyShader.uniforms); this.envSkyMat.uniforms.envMode.value = 1;
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.envSkyMat));
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(90, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x334422 }));
    this.envGround.position.y = -8; this.envScene.add(this.envGround);
    this.pmrem = new THREE.PMREMGenerator(renderer.renderer);
    this.envRT = null;
    this.shadowMapSize = 2048;
    this.env = null;
    this.focus = new THREE.Vector3(); this.focusDir = new THREE.Vector3(0, 0, -1);
    this.time = 0;
    this.apply({});
  }

  // コースの環境を当てはめる
  apply(envIn = {}) {
    const env = this.env = { ...ENV_DEFAULT, ...envIn, clouds: { ...ENV_DEFAULT.clouds, ...(envIn.clouds || {}) }, mountains: { ...ENV_DEFAULT.mountains, ...(envIn.mountains || {}) } };
    const el = env.sunElevation * Math.PI / 180, az = env.sunAzimuth * Math.PI / 180;
    this.sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    for (const m of [this.skyMat, this.envSkyMat]) {
      const u = m.uniforms;
      u.sunDir.value.copy(this.sunDir); u.rayleigh.value = env.rayleigh; u.turbidity.value = env.turbidity;
      u.mieCoefficient.value = env.mie; u.mieDirectionalG.value = env.mieG; u.intensity.value = env.skyIntensity;
      u.cloudCover.value = env.clouds.cover; u.cloudSharp.value = env.clouds.sharp; u.cloudScale.value = env.clouds.scale;
      u.cloudOpacity.value = env.clouds.opacity; u.cloudColor.value.setRGB(...env.clouds.color); u.stars.value = env.stars || 0;
      u.cloudBright.value = env.clouds.bright ?? 1.1; u.skySat.value = env.skySaturation ?? 1.25;
    }
    // 地平線の色を空のシェーダと同じ式で見積もるのは大変なので、太陽の高さから決める（コースで fogColor を指定してもよい）
    const fogC = env.fogColor ? new THREE.Color().setRGB(...env.fogColor) : this._autoHaze(env);
    this.fogColor = fogC;
    this.skyMat.uniforms.hazeColor.value.copy(fogC); this.envSkyMat.uniforms.hazeColor.value.copy(fogC);
    this.scene.fog = new THREE.FogExp2(fogC.clone(), env.fogDensity);
    this.scene.background = null;
    // 太陽の色（低いほど赤い）
    const sc = env.sunColor ? new THREE.Color().setRGB(...env.sunColor) : new THREE.Color().setRGB(1, 0.62 + 0.36 * Math.min(1, Math.sin(el) * 2.2), 0.38 + 0.56 * Math.min(1, Math.sin(el) * 1.9));
    this.sun.color.copy(sc); this.sun.intensity = env.sunIntensity;
    this.hemi.intensity = env.ambient;
    this.hemi.color.copy(fogC).lerp(new THREE.Color(0.55, 0.7, 1), 0.5);
    this.hemi.groundColor.setRGB(...env.groundColor);
    this.farGround.material.color.setRGB(...env.groundColor).multiplyScalar(0.9);
    this.envGround.material.color.setRGB(...env.groundColor);
    this.scene.environmentIntensity = env.envIntensity;
    this._buildMountains(env);
    this.updateEnvMap();
  }

  _autoHaze(env) {
    const e = Math.max(0, env.sunElevation);
    const day = new THREE.Color(0.70, 0.80, 0.90), dusk = new THREE.Color(0.86, 0.62, 0.46), night = new THREE.Color(0.05, 0.07, 0.12);
    const c = e > 15 ? day.clone() : dusk.clone().lerp(day, e / 15);
    if (env.sunElevation < 0) c.lerp(night, Math.min(1, -env.sunElevation / 8));
    return c.lerp(new THREE.Color(0.8, 0.82, 0.84), Math.min(0.5, (env.turbidity - 2) * 0.06));
  }

  // 環境マップを作り直す（コースが変わったとき）
  updateEnvMap() {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 400);
    this.scene.environment = this.envRT.texture;
  }

  // 遠くの山並み（霧の外。色に霞を混ぜておく）
  _buildMountains(env) {
    if (this.mountains) { this.scene.remove(this.mountains); this.mountains.geometry.dispose(); this.mountains = null; }
    const M = env.mountains; if (!M || !M.count) return;
    const rnd = mulberry32(M.seed || 5);
    const pos = [], col = [], idx = [];
    const haze = this.fogColor;
    for (let layer = 0; layer < M.count; layer++) {
      const R = M.dist * (1 + layer * 0.22), H = M.height * (1 - layer * 0.18), N = 160;
      const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
      const base = pos.length / 3;
      const k = 0.45 + layer * 0.17;   // 遠いほど霞む
      const c = new THREE.Color().setRGB(...M.color).lerp(haze, Math.min(0.92, k));
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const h = H * Math.max(0.05, 0.55 + 0.3 * Math.sin(a * 3 + ph[0]) + 0.18 * Math.sin(a * 7.3 + ph[1]) + 0.1 * Math.sin(a * 17.1 + ph[2]) + (rnd() - 0.5) * 0.08);
        const x = Math.sin(a) * R, z = -Math.cos(a) * R;
        pos.push(x, -30, z, x, h, z);
        const top = c.clone().multiplyScalar(1.06);
        col.push(c.r, c.g, c.b, top.r, top.g, top.b);
      }
      for (let i = 0; i < N; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.name = 'mountains'; m.renderOrder = -5; m.frustumCulled = false;
    this.mountains = m; this.scene.add(m);
  }

  // コースの中心（山並み・遠くの地面の位置）。groundY = 地面の一番低い所
  setCenter(x, z, groundY = 0) {
    if (this.mountains) this.mountains.position.set(x, groundY, z);
    this.farGround.position.set(x, groundY - 1.5, z);
  }

  // 影の解像度（0 で影なし）
  setShadowQuality(size, extent) {
    this.shadowMapSize = size;
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    if (extent) this.shadowExtent = extent;
  }

  // 毎フレーム：focus（車の位置）と dir（前向き）で影の範囲を動かす。camera の位置に空を追従させる
  update(dt, camera, focus, dir) {
    this.time += dt;
    this.skyMat.uniforms.time.value = this.time * (this.env.clouds.speed || 0);
    this.sky.position.copy(camera.position);
    if (focus) {
      const ext = this.shadowExtent || this.env.shadowSize || 110;
      const c = _c.copy(focus).addScaledVector(dir || _z, ext * 0.28);
      const sc = this.sun.shadow.camera;
      sc.left = -ext / 2; sc.right = ext / 2; sc.top = ext / 2; sc.bottom = -ext / 2; sc.updateProjectionMatrix();
      // 影のちらつきを防ぐため、影のテクスチャの 1 ピクセル単位で位置をそろえる
      const texel = ext / Math.max(256, this.shadowMapSize);
      _m.lookAt(_o, _l.copy(this.sunDir).negate(), _up);
      _inv.copy(_m).invert();
      const p = _p.copy(c).applyMatrix4(_inv);
      p.x = Math.round(p.x / texel) * texel; p.y = Math.round(p.y / texel) * texel;
      p.applyMatrix4(_m);
      this.sun.target.position.copy(p);
      this.sun.position.copy(p).addScaledVector(this.sunDir, 300);
      this.sun.target.updateMatrixWorld();
    }
  }
}
const _c = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, -1), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _l = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3();
