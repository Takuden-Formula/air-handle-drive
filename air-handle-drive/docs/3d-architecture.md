# エアハンドル・ドライブ 3D 版の構成

Canvas2D の疑似3D（旧 `game.js`）を、Three.js r170 による本物の 3D 描画に置き換えた。
このドキュメントは「並列で作り込む人が、自分の担当ファイルだけ触れば済む」ための設計書。
**境界（だれがどのファイルを持つか・公開 API）を変えるときは、この文書も一緒に直すこと。**

## 1. 全体の流れ

```
index.html ── css/style.css
   └ <script type=module src=js/main.js>（importmap で "three" と "three/addons/" を lib/three に割り当て）
js/main.js（ゲーム進行）
   ├ app/  … storage（設定・集計）/ serial（ESP32）/ pose（カメラ・MediaPipe・../../wheel.js）/ audio（効果音・../../sound.js）
   ├ ui/   … course-select（コース選択）/ hud（レース表示）/ minimap（コースマップ）
   ├ physics.js（車の性能・運動・理論最速・自動運転。three を使わない）
   ├ courses/index.js → circuit / highway / city / fsae（コース定義）＋ common.js（共通の道具）
   └ engine/
        renderer.js（WebGLRenderer・ポストエフェクト・品質ティア）
        world.js   （空・太陽・影の追従・環境マップ・霧・山並み）
        stage.js   （コース定義 → 走れるステージを組み立てる・キャッシュ）
        track.js   （中心線・問い合わせ・路面/縁石/ランオフ/草地/壁のメッシュ）
        terrain.js （地形の高さと地面メッシュ）
        props.js   （景色の部品・まとめ描画・木のインスタンシング）
        textures.js（手続き生成のテクスチャとマテリアル）
        car.js     （car.glb のフレーム＋手続きのカウル・タイヤ・ウイング・ドライバー・ランプ）
        effects.js （砂ぼこり・火花・タイヤ痕・コーン）
        camera.js  （追従カメラ・中継カメラ・ドローン）
```

ゲームの状態（`main.js` の `state`）:
`loading` → `idle`（待機デモ：自動運転でコースを巡回）→ `select`（コース選択）→ `lights`（F1 スタートランプ）→ `race` → `result` → `idle`

- 待機中に「ハンドルを握るポーズ」を 1.5 秒（または ← → を押し続ける / Space / ESP32 の BTN）→ コース選択
- コース選択：ハンドルを左右に傾けて選ぶ、まっすぐ握ったまま 2.4 秒で決定（キー ← → / 1〜4 / Enter、マウスはカードをクリック）
- 設定「コース選択画面を出す」を OFF にすると、設定のコースで直接スタート（旧版と同じ流れ）

## 2. 座標と単位（全ファイル共通）

- 単位は **m・秒・rad**。Y が上。three.js の右手系。
- コースの中心線は「距離 `s` [m]」で表す。中心線からの横の位置 `d` [m] は **+ が進行方向の右**。
- 向き（heading）0 は **-Z 方向**（コースマップの上）、+ で右回り。曲率 `kappa` は **+ が右カーブ**。
- 車のローカル座標：原点 = 前後の車軸の真ん中の地面、**-Z が前、+X が右、+Y が上**。
- 景色の部品（props.js）のローカル座標：**+Z が正面**（観客席なら客席がコースを向く側）、原点は地面。
  `ctx.place(s, d)` / `placeFacing(track, s, d)` を使うと正面がコースの中心線を向く。

## 3. 各ファイルの責任範囲と公開 API

### 3.1 `js/physics.js`（三次元を知らない純粋な計算）
- `CAR`（36 kW / 60 N·m / 11000 rpm / 減速比 10 / タイヤ 0.53 m / 300 kg …）と `motorAccel(v, throttle)` は**旧版のまま。変えない**。
- `rpmToMs`, `msToRpm`, `TOP_MS`（約 30.5 m/s）, `TOP_KMH`（約 110）, `CAR_HALF`（0.7 m）, `CAR_LEN`, `DEMO_KMH`, `PHYS`（横の動き・コースアウト・壁・自動ブレーキの定数）
- `buildSpeedProfile(track, { latG, caps })` … コーナーの速度上限（横 G の上限から）を後ろからブレーキで間に合うように伸ばした配列
- `class Sim`
  - `setCourse(stage)`（`track, startS, raceLength, laps, cones, vprof` を使う）, `reset()`
  - `update(dt, steer(-1〜1), throttle(0〜1), { topMs, assist(0〜1) })`
  - 状態: `dist`（スタートからの距離）, `s`（get）, `d`, `dDot`, `speed`, `accel`, `latAcc`, `rpm`, `torque`, `coneHits`, `crashes`, `finished`, `offroad`, `onKerb`, `surface`, `braking`, `autoBrake`, `lap`, `laps`, `progress`（get）, `shake`
  - `events`（毎フレーム main が読んで空にする）: `{type:'cone', index, rel}` / `{type:'crash', side}` / `{type:'lap', lap}` / `{type:'finish'}`
  - `autopilot(assist)` … コーンをよけて走るハンドル量（デモ・テスト・A キー）
  - `idealTime(topMs)` … 理論最速（全開＋コーナーの自動ブレーキ、道の中央）。**目標タイム = ceil(理論最速 × 1.2)**
- 横の動きは旧版と同じ一次の式（ハンドル量 → 横の速さ）を m 単位にしたもの。コーナーでは `latG`（既定 2.0 G）を越えないよう自動でブレーキ（ブレーキランプが光る）。
- コーン 1 本 +1 秒（main.js の `CONE_PENALTY`）、コースアウトで減速（砂利は 1.3 倍）、壁に当たると 17 km/h まで減速。

### 3.2 `js/engine/track.js`
- `class PathBuilder({ x, z, heading(度) })` … 中心線をタートル方式で作る
  - `.straight(len, { id })`, `.turn(radius, angle度(+右), { entry, exit })`（入口・出口はクロソイド）, `.curve(len, k0, k1)`, `.mark(name)`
  - `.build({ ds: 1, close: true, solve: ['id1', 'id2'] })` → `{ x[], z[], closed, ds }`。周回コースは `solve` に向きの違う 2 本の直線の id を渡すと、**その長さを自動で決めて継ぎ目をぴったり閉じる**（角度の合計は 360° にしておく）。`p.marks[name]` で名前の位置 s が分かる。
- `pathFromPoints([[x, z], ...], { closed, ds })` … 点列を通るなめらかな線（Catmull-Rom）
- `profile([[s, value], ...], { period })` … 高低差・幅などのなめらかな関数（行き過ぎない 3 次補間）
- `class Track(layout)` … ds ごとのサンプル（`px, py, pz, tx, ty, tz, rx, rz, heading, kappa, kappaS, bank, half`）と問い合わせ
  - `wrap(s)`, `frame(s)` → `{ pos, tan, right, up, bank, kappa, half, s }`, `toWorld(s, d, h)`, `placeMatrix(s, d, h, { yaw, scale, followSlope })`
  - `kappaAt(s)`, `halfWidth(s, side)`, `heightAt(s, d)`, `headingAt(s)`, `barrierD(s, side)`, `edgeAt(s, side)`, `surfaceAt(s, d)`（`'road'|'kerb'|ランオフの種類|ground`）
  - `nearest(x, z, maxR, exclude)` → `{ i, s, d, dist }`（平面の点 → コース上の位置。マス目で速い）
  - `mapPoints(s0, s1, step)` … コースマップ用
  - 近くを通る別の区間・カーブの内側では、壁と草地を自動で縮める（裏返り・はみ出し防止）
- `defaultEdges` … サーキット風の道の脇（カーブの内外に縁石、外に砂利＋タイヤバリア、直線は芝＋ガードレール）
- `buildTrackMeshes(track, style)` → `THREE.Group`（300 m ごとの区画。視錐台カリング）
  - 舗装・白線（`style.markings`）・縁石・ランオフ（砂利・舗装・砂・コンクリート）・草地（外側の端は地形の高さに合わせる）・壁（`armco` / `tires` / `wall` / `fence` / `none`）
  - `style`: `{ road, roadTex, vergeMat, runoffMats, markings, kerbMat, kerbHeight, barriers:false, chunk, heightFn }`
- `groundHeight(track, heightFn, s, d)` … 道の脇の地面の高さ（草地の帯と同じ式。景色を置く高さ）
- `RibbonBuilder` … 帯状のメッシュを行ごとに積む道具

### 3.3 `js/engine/terrain.js`
- `createHeightFn(track, { amp, scale, flat, ramp, seed })` → `(x, z) => 高さ`。道路の近くは道路の高さ、離れると丘。近い 2 区間の高さはなめらかに混ぜる。
- `buildTerrain(track, heightFn, { margin, cell, material })` → 地面のメッシュ（草地の帯の下は少し下げる）

### 3.4 `js/engine/stage.js`
- `buildStage(course, { length, cones, seed })` → ステージ
  `{ course, layout, track, root(Group), terrain, heightFn, startS, raceLength, finishS, laps, cones, vprof, env, grade, center, map:{pts, all, closed}, hooks:{update, setStartLights}, idealTime(topMs), setDensity(k), dispose() }`
- `class StageCache(max)` … 同じコース・同じ設定（id・長さ・コーン）を使い回す
- `courseInfo(course, opts)` … 見た目を作らずに形と速度上限だけ作る（設定画面の理論最速・目標タイムの計算用。速い）

### 3.5 `js/engine/renderer.js`
- `QUALITY`（品質ティア 0〜3: 低・中・高・最高）: `{ name, scale(描画解像度の倍率), shadow(影の解像度, 0=なし), msaa, post, bloom, fxaa, deco(木の量), maxDpr }`
- `class Renderer(canvas)`: `setQuality(tier)`, `quality`, `q`, `resize()`, `setGrade({ exposure, saturation, contrast, tint, lift, vignette, bloom:{strength, radius, threshold} })`,
  `render(scene, camera, { blur, chroma, flash:[r,g,b,a], center:[x,y] })`, `snapshot(scene, camera, w, h)` → canvas, `size`（描画バッファの大きさ）, `onResize`, `r`（WebGLRenderer）
- 描画の順: シーン → HalfFloat の描画先（MSAA）→ UnrealBloom → 仕上げ（放射状ぼかし・色調整・周辺減光・ACES トーンマップ・sRGB・粒子ノイズ）→（中画質は FXAA）→ 画面。低画質はポストなしで直接（three の ACES）。
- 画質「自動」：main.js が 3 秒続けて 45 FPS 未満なら 1 段下げる（30 FPS 未満なら 2 秒）。上げはしない（行ったり来たりを防ぐ）。

### 3.6 `js/engine/world.js`
- `ENV_DEFAULT`（コースの `env` で上書き）: `sunElevation, sunAzimuth, turbidity, rayleigh, mie, mieG, skyIntensity, clouds{cover, sharp, scale, speed, opacity, color, bright}, sunIntensity, sunColor, ambient, envIntensity, groundColor, fogDensity, fogColor, mountains{count, height, dist, color, seed}, shadowSize, night, stars`
- `class World(renderer)`: `scene`, `sun`（DirectionalLight）, `hemi`, `apply(env)`, `updateEnvMap()`（空から PMREM）, `setCenter(x, z, groundY)`, `setShadowQuality(size, extent)`, `update(dt, camera, focus, dir)`（影の範囲を車に追従・テクセル単位で固定）
- 空は Preetham の大気散乱＋fBm の雲＋地平線の霞（霧の色と一致）。霧は `FogExp2`。

### 3.7 `js/engine/car.js`
- `Car.create(url)` → `car.root`（シーンに入れる）, `setPose(pos, quat)`, `update(dt, { speed, steer, braking, latAcc, accel, rough, tsal })`
- `CAR_DIM`（ホイールベース 1.6 m・トレッド 1.22/1.18 m・タイヤ半径 0.265 m…）, `LIVERY`（色）
- car.glb は**パイプフレームだけ**（1 メッシュ・法線なし・mm・+X が前・KHR_materials_pbrSpecularGlossiness）。法線を作り直して白の粉体塗装にし、カウル（フレームの外形を測って合わせる）・タイヤ・ホイール（高速で回転ぼかし）・ブレーキ・ダブルウィッシュボーン・前後ウイング・ディフューザー・モータ・バッテリー箱・ドライバー・ハンドル・レインライト（ブレーキで光る）・TSAL（メインフープ上の高電圧表示灯、点滅）を手続きで作る。
- 描画回数を減らす工夫：動かない部品は材質ごとにまとめ、単色の材質は頂点カラーでさらにまとめる（`_mergeGroup`）。タイヤ・ホイール・ブレーキは InstancedMesh（左右で反転した形を別に持つ。反転した行列だと面が裏返るため）。`wheels[i].steer / spin` は行列を計算するための空の入れ物。
  今の車は描画 約 22 回（影 約 17 回）。部品を足すときもこの仕組みに乗せること。

### 3.8 `js/engine/effects.js`
- `class Effects(scene)`: `setStage(stage)`（コーンを並べる）, `reset()`, `update(dt, { pos, fwd, right, speed, surface, offroad, onKerb, autoBrake, latAcc, wheels:[後輪 2 つのワールド位置] })`,
  `coneHit(index, carVel, right, rel)`, `sparks(pos, dir, n)`, `emit(kind, pos, vel, size, life)`, `setPointScale(h, fov)`, `quality`
- `coneGeometry()` … 三角コーンの形（頂点カラー）
- パーティクルは 1 つの `Points`（霧つきの自前シェーダ）、火花は加算合成の `LineSegments`（ブルームで光る）、タイヤ痕はリングバッファの帯、コーンは `InstancedMesh`（当たると重力と回転で飛ぶ）。

### 3.9 `js/engine/camera.js`
- `class CameraRig`: `camera`, `mode`（`'chase'|'grid'|'tv'|'heli'|'drone'|'orbit'`）, `setMode(mode)`, `setShift(x)`（画面上の車の横位置。0.42 で右下のカメラ映像をよける）, `resize(w, h)`,
  `update(dt, { pos, fwd, up, speed, topSpeed, shake, rough, s }, track)`, `params`（追従カメラの距離・高さ・FOV など）, `drone.s`, `snap`
- スピード感：速いほど FOV が広がる・少し遠く低く・細かい振動。壁・コースアウト・縁石で揺れる。仕上げのシェーダの放射状ぼかしは main.js が速さから決める。

### 3.10 `js/engine/props.js`（景色の部品の共通ライブラリ）
- `MergeBuilder({ cell })` … 動かない物を「材質 × 400 m の区画」ごとに 1 メッシュにまとめる。`add(geometry, material, matrix, { shadow })` → `build(group)`。
  **模様のない単色の MeshStandardMaterial（`MAT.color()` など）は自動で頂点カラー＋共通の材質（粗さ・金属感の段階ごと）にまとめる**ので、色をたくさん使っても描画の呼び出しは増えない。
- `Forest` … 木（`'broadleaf'|'conifer'|'bush'`）を InstancedMesh で置く。`add(kind, x, y, z, scale, yaw, colorJitter)` → `build(group)`（`stage.setDensity` で低画質のとき本数を減らす）
- 部品: `grandstand`, `pitBuilding`, `billboard`, `gantry`（スタートのランプつき。`setLights(n, color)`。ランプは 1 つの InstancedMesh で色を変える）, `lightTower`, `marshalPost`, `distanceBoard`, `chevron`, `tent`, `building`, `ferrisWheel`（`update(dt)`。ゴンドラはインスタンス）, `footBridge`, `spectators`
- 道具: `placeFacing(track, s, d, h)`, `mat4(x, y, z, yaw)`, `tint(geo, hex)`, `vertexColorMat()`, `roadDecal(track, s, len, d0, d1, material)`（路面に貼る）, `checkerMaterial()`, `buildingMaterials()`

### 3.11 `js/engine/textures.js`
- 画像ファイルは使わない（オフライン・ライセンス対策）。CanvasTexture と手続き生成。すべてキャッシュして使い回す。
- `TEX.asphalt/grass/gravel/sand/concrete/kerb/tires/fence/crowd/windows(style)/softDot/smoke/blobShadow`
- `MAT.asphalt/grass/gravel/sand/concrete/kerb/line/lineYellow/armco/steel/darkSteel/tires/fence/white/black/crowd/blobShadow/color(hex, {rough, metal, emissive})/glow(hex, intensity)`
- `textTexture({ w, h, bg, bg2, border, lines:[{text, size, color, y, x, weight}], draw })` … 看板・標識の文字
- `tileNoise`, `normalFromHeight`, `mulberry32`, `addMacroVariation(material)`（ワールド座標の大きなむらで繰り返し模様を消す）

### 3.12 `js/courses/*.js`（コース定義）と `js/courses/common.js`
各コースは次の形のオブジェクトを `export default` する（`circuit.js` が参照実装）。

```js
export default {
  id: 'circuit',                 // localStorage のキーにも使う。変えない
  name: 'サーキット', nameEn: 'TAKUDEN CIRCUIT', desc: '説明（\n で改行）',
  accent: '#e53935',             // カード・HUD の差し色
  difficulty: 2,                 // ★の数（1〜3）
  latG: 2.0,                     // コーナーで自動で減速する横 G（大きいほど速く曲がる）
  thumb: { s, d, h, look },      // （任意）コース選択のカードの画像を撮る視点（スタートからの距離など）
  env: { ...ENV_DEFAULT の上書き }, grade: { ...Renderer.setGrade },
  build(opts) { return layout },         // three.js を使わないデータ（理論最速の計算でも呼ばれる）
  decorate(ctx) { return { setStartLights(n, color), update(dt, info) } },   // 景色（three.js）
};
```

`build(opts)`（`opts = { length: 'short'|'normal'|'long', cones: bool, seed }`）が返す `layout`:
| 項目 | 内容 |
|---|---|
| `path` | `PathBuilder.build()` か `pathFromPoints()` の戻り値 |
| `width` | 舗装の全幅 [m]（数値か `(s) => 数値`） |
| `elevation`, `bank` | `(s) => 高さ [m]`, `(s) => バンク角 [rad]`（`profile()` が便利） |
| `edges(s, side, {kappa, half, track})` | `{ kerb, runoff, runoffW, barrier, barrierD, verge }`（省略で `defaultEdges`） |
| `ground` | 舗装の外の地面の種類（`surfaceAt` が返す。既定 `'grass'`） |
| `startS`, `raceLength`, `laps` | スタート時の車の中心の位置・走る距離・周回数（周回コースは `laps × 1周 + 3`） |
| `cones` | `[{ s, d, r, kind: 'obstacle'|'boundary' }]`（`opts.cones` が false なら障害物は置かない） |
| `caps` | `[[s0, s1, km/h], ...]`（区間の速度上限。料金所・交差点など） |
| `latG` | コースの `latG` を上書き |
| `terrain` | `createHeightFn` / `buildTerrain` のオプション（`false` で地形なし）。`material` で地面の材質 |
| `trackStyle` | `buildTrackMeshes` の `style`（白線・草地の材質など） |
| `env`, `grade` | 長さなどで変えたいときの上書き |
| そのほか | `marks`, `sLine` など、decorate で使う値を自由に入れてよい |

**`build()` は three.js も DOM も使わない**（Node でも動く。設定画面の理論最速の計算にも使う）。材質は名前（`MAT` の名前の文字列: `'concrete'`, `'asphalt'` など）で `terrain.material`, `trackStyle.road / vergeMat / kerbMat / runoffMats` に書くと、stage.js が本物の材質にする。
片道コースで `raceLength` が中心線より長いと、stage.js が警告を出して縮める（ゴールの先に 200 m 以上の余り（止まるまでの道）を作っておくこと）。

`decorate(ctx)` の `ctx`:
`THREE, track, layout, opts, group（景色を入れる Group）, mb（MergeBuilder）, forest（Forest）, props, MAT, TEX, textTexture, heightFn, rnd（シード付き乱数）, deco,
startS, raceLength, finishS, laps, addUpdate(fn(dt, info)), groundAt(s, d), place(s, d, { back, yaw, h, scale })`
- `mb` と `forest` に足した物は decorate の後に stage.js がまとめて作る。光る物・動く物（ランプ・観覧車）は `group` に直接入れ、`addUpdate` で動かす。
- 戻り値の `setStartLights(n, color)` はスタートランプの点灯数（0〜5）。HUD のランプと連動する。

`common.js`（全コースの共通の道具。**引数を足すだけにして、今の呼び方を壊さない**）:
`LENGTH_FACTOR`, `coneZones(track, zones, rnd, { laneK, slalomK })`, `boundaryCones(track, s0, s1, { every, inset })`, `startArea(ctx, sLine, { label, gate, grid, finishHere })`, `finishArea(ctx, sLine, { label, gate })`, `forRange(track, s0, s1, step, fn)`

`index.js`: `COURSES`（コース選択の順）, `COURSE_IDS`, `getCourse(id)`。コースを足すときはここに 1 行足す。

### 3.13 `js/ui/*`（画面の部品）と `index.html`・`css/style.css`
- `course-select.js` … `CourseSelect(root, courses, { onConfirm, onCancel, onHighlight, onMove })`: `open(id, info)`, `close()`, `update(dt, wheel)`, `key(e)`, `highlight(i)`, `move(dir)`, `confirm()`, `setThumb(id, canvas)`, `CONFIRM_S`
- `hud.js` … `Hud`: `show(mode)`（`body[data-hud]` を `idle|select|race` に）, `update(st)`, `wheel(w)`
- `minimap.js` … `MiniMap(canvas)`: `setStage(stage)`, `draw(f, visible)`
- index.html は骨組みだけ（中身の動きは main.js）。旧版の要素 id は残している（`tTime, tGoal, prog, speed, rpm, rpmBar, camLabel, big, small, lights, holdBar, card, gear, fsHint, status, settings …`）。
  旧版で HUD とチェックボックスが同じ id（`cones`）だったバグを直し、HUD 側を `hudCones` にした。
- 表示は `body[data-hud]` で切り替える（待機・選択中はレースの HUD を隠す）。

### 3.14 `js/main.js` と `js/app/*`
- `main.js` … 状態遷移、入力（ハンドル・キー・自動運転）、物理 → 3D（車の位置と向き）、描画、HUD、設定画面、ランキング、景品機の命令、自動の画質、`window.__dbg`
- `app/storage.js` … `loadSettings(courseIds, top)`, `loadStats()`, `saveAll(settings, stats)`, `rankKey(courseId, length)`。値は 1 項目ずつ確かめる（壊れた値・型違いは既定値）。localStorage が使えなくても落ちない。
- `app/serial.js` … `PrizeSerial`: `request()`, `autoConnect()`, `send(cmd)`（`PRIZE` / `EV:START` / `EV:LOSE` / `PING`。`BTN` を受けるとスタート）
- `app/pose.js` … `PoseInput`: `startCamera()`, `loadModel()`（GPU → だめなら CPU）, `update(now)`, `wheel`（`../../wheel.js` の `readWheel` の結果）, `draw()`（右下のカメラ画面）
- `app/audio.js` … `Audio`: `beep()`, `fanfare()`, `driveSound()`（`../../sound.js` の `DriveSound`。入力は旧版と同じ: rpm・トルク・最大トルク・車速 m/s・最高速・路面 `'road'|'gravel'|'grass'`・縁石）

## 4. 保存（localStorage）
| キー | 内容 |
|---|---|
| `air-handle-settings` | 旧版の項目（`course`=長さ, `maxKmh`, `target`, `limit`, `sens`, `assist`, `cones`, `sound`, `mirror`, `stock`, `camId`）に、`courseId`, `courseSelect`, `targets{コースid: 秒}`, `quality`（`'auto'|0〜3`）を足した。`target` は今のコースの目標（旧版互換） |
| `air-handle-stats` | `plays`, `finishes`, `prizes`, `ranking`（旧版の 1 本のランキング。読むだけで残す）, `rankings{'コースid:長さ': [{id, time, cones}]}` |

## 5. 検証用フック `window.__dbg`
`sim`（= `race`）, `settings`, `stats`, `state`, `raceTime`, `course`, `stage`, `quality`（get/set）, `setQuality(t)`, `setAuto(bool)`, `openSelect()`, `selectCourse(id)`, `startRace(id)`, `skipLights()`, `toIdle()`,
`idealTime(id)`, `target(id)`, `select`, `renderer`, `world`, `rig`, `car`, `fx`, `fps`, `info()`（描画の呼び出し数・三角形数など）, `speedup(n)`（テスト用：1 フレームで物理を n 回進める）, `holdResult`（テスト用：true で結果画面のまま止める）

ソフトウェア描画（SwiftShader）のテストでは 1 フレーム数秒かかるので、`setQuality` で画質を固定し、`speedup(12)` で物理を速める。
レースのタイムは物理を進めた時間の合計（`raceClock`）なので、速めても正しいタイムになる。

## 6. 性能の目安（文化祭のノート PC：i5 / Iris Xe、1920×1080、60 FPS 目標・最低 30 FPS）
- 「高」画質で **描画の呼び出し 300 回以下・三角形 80 万以下**を目安にする（`__dbg.info()` で確認。影の分も含む）。
  今（基盤の時点）は、サーキットのスタート付近で 1 フレーム約 190 回（本体 約 110・影 約 55・ポストエフェクト 14）・三角形 約 56 万。
  ソフトウェア描画（SwiftShader）では 1 フレーム 1〜5 秒かかるので FPS は参考にならない。描画回数と三角形数で見積もる。
- 動かない物は必ず `mb`（MergeBuilder）に入れる。同じ物をたくさん置くなら InstancedMesh（`Forest` のまね）。材質はキャッシュして使い回す（`MAT.color()` は同じ色なら同じ材質）。
- テクスチャは手続き生成で 512 px 程度まで。文字の看板は `textTexture`（同じ内容はキャッシュ）。
- 1 コースを作る時間は 1.5 秒以内（起動時に 4 コース作ってサムネイルを撮る）。
- 光は太陽 1 つだけ（影は車のまわり 110 m）。街灯などは発光する材質＋ブルームで表現し、PointLight は使わない。

## 7. 並列で作り込むときの担当と約束
| 担当 | 触ってよいファイル |
|---|---|
| サーキット | `js/courses/circuit.js` |
| 高速道路 | `js/courses/highway.js` |
| 街中 | `js/courses/city.js` |
| 学生フォーミュラ大会 | `js/courses/fsae.js` |
| 車 | `js/engine/car.js` |
| 描画・空・カメラ | `js/engine/renderer.js`, `js/engine/world.js`, `js/engine/camera.js` |
| 路面・地形 | `js/engine/track.js`, `js/engine/terrain.js` |
| 演出 | `js/engine/effects.js` |
| 部品・材質 | `js/engine/props.js`, `js/engine/textures.js` |
| 画面（UI） | `index.html`, `css/style.css`, `js/ui/*.js` |
| 進行・入力 | `js/main.js`, `js/app/*.js`, `js/physics.js` |

- 公開 API（この文書の 3 章）は**引数を足す・関数を足す**のはよいが、名前や意味を変えない。変えたい場合は呼び出し側の担当と相談し、この文書を直す。
- コース担当は自分のコースファイルの中で、そのコースだけの部品（関数・材質・テクスチャ）を作ってよい。共通にしたい部品は props.js 担当に頼む（同じファイルを同時に直すと衝突するため）。
- `common.js` と `courses/index.js` は全員が使う。変えるときは追加だけにする。
- `wheel.js`, `sound.js`, `lib/`, `models/`, `esp32/` は原則そのまま（`sound.js` の入力の形は変えない）。
- 物理の数値（`CAR`, `motorAccel`）は変えない。コースの難しさは道幅・カーブ・`latG`・`caps`・コーンで調整する。
- コード内のコメントと画面の文言は日本語（今の書き方に合わせる）。外部 URL・CDN・Web フォントは使わない。
- 検証: `cd air-handle-drive && python3 -m http.server <PORT>` → Playwright（`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --use-fake-ui-for-media-stream --use-fake-device-for-media-stream`）。
  コンソールエラー・pageerror 0、全コースで コース選択 → ランプ → 走行 → ゴール → ランキング を確認し、スクリーンショットを見て判断する。

## 8. 旧版（疑似3D）からの変更点
- 道幅・距離・速度はすべて実寸（m）。車幅 1.4 m（`CAR_HALF` 0.7 m）は旧版と同じ。
- **コーナーの手前で自動ブレーキ**（横 G の上限 `latG` を越えないように減速。ブレーキランプが光る）。理論最速もこれを含めて計算するので、目標タイム（＋20%）の考え方は同じ。
- 横の動きは旧版と同じ「ハンドル量 → 横の速さ」の一次の式（`PHYS.steerRate` 0.25、遠心力 `PHYS.drift`、アシストも同じ式）。ハンドルを切った分だけ車の向きも変わって見える。
- レースのタイムは「物理を進めた時間の合計」（60 FPS なら実時間と同じ。遅い PC でも車の動きとタイムがずれない）。中止（手を離して 8 秒）は実時間。
- コーンの「3 車線のうち 2 車線をふさぐ」列は、前の列のとなりか同じ車線を空ける（2 車線いっぺんの移動は物理的に間に合わないため）。自動運転は全コースでコーン 0 本・理論最速どおり。
- 旧版で HUD とチェックボックスが同じ id `cones` だったため、コーンの ON/OFF が効いていなかった（常に ON）。HUD 側を `hudCones` にして直した。
- 待機中はレースの HUD を隠し、タイトルとそのコースのランキングを出す。デモはゴールするたびに次のコースへ。カメラは追従・中継・ヘリを切り替える。

## 9. 既知の課題（次の担当へ）
- 高速道路・街中・学生フォーミュラは**仮実装**（中心線・道幅・最低限の景観）。料金所・防音壁・標識（高速）、交差点・信号・歩道の柵・街灯の光だまり・遠景のビル群（街中）、広い舗装のパッド・テント村・旗・計時の門・スタジアム（学生フォーミュラ）などを作り込む。
- 学生フォーミュラは中心線が 866 m しかなく、「ながい」が「ふつう」とほぼ同じ（stage.js が 806 m に縮める）。長い版のコースか 2 周を作る。舗装が地平線まで続いて見えるので、パッドの外を芝にする。
- 街中は夕方の暗さが残る。窓の模様が大きい（`building()` の UV）。ビルの裏の何もない平地が見える。
- 地形の外周（四角）と、林の四角い範囲がドローンの高い視点から見える。
- 雲は空のシェーダの fBm だけ。もっと立体的にしてもよい（world.js）。
- 車はフレーム以外が手続きの形なので、カウルの形・ノーズ・サイドポンツーン・フロントウイングはまだ簡単。
- 画質「自動」は下げるだけで上げない。
- 実機（Iris Xe）での FPS は未確認。SwiftShader の描画回数・三角形数からの見積もりのみ。
- README.md は旧版（game.js）のまま。最後にまとめて直す。
