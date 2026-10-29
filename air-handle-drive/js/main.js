// ゲームの進行（待機デモ → コース選択 → スタートランプ → レース → 結果）と、入力・設定・集計・景品機・描画のまとめ役。
// 3D の中身は engine/、コースは courses/、画面の部品は ui/、カメラ・景品機・音・保存は app/ にある。
import * as THREE from 'three';
import { Renderer, QUALITY } from './engine/renderer.js';
import { World } from './engine/world.js';
import { CameraRig } from './engine/camera.js';
import { Car } from './engine/car.js';
import { Effects } from './engine/effects.js';
import { StageCache, courseInfo } from './engine/stage.js';
import { Sim, CAR, TOP_KMH, TOP_MS, DEMO_KMH, rpmToMs } from './physics.js';
import { COURSES, COURSE_IDS, getCourse } from './courses/index.js';
import { angleToSteer } from '../wheel.js';
import { loadSettings, loadStats, saveAll, rankKey } from './app/storage.js';
import { PrizeSerial } from './app/serial.js';
import { PoseInput } from './app/pose.js';
import { Audio } from './app/audio.js';
import { CourseSelect } from './ui/course-select.js';
import { MiniMap } from './ui/minimap.js';
import { Hud } from './ui/hud.js';

const START_HOLD_MS = 1500;   // ハンドルを握ってこの時間キープでコース選択へ
const RESULT_MS = 7000;       // 結果表示の時間
const AWAY_MS = 8000;         // レース中に人がいなくなったら中止するまでの時間
const CONE_PENALTY = 1.0;     // コーン1本あたりのペナルティ[秒]
const CAR_SHIFT_X = 0.42;     // 画面上の車の横位置（右下のカメラ映像と重ならないよう少し左）

const $ = (id) => document.getElementById(id);

// ---------- エラー・ログ ----------
function showError(msg) { const e = $('error'); e.textContent = '⚠ ' + msg; e.style.display = 'block'; log('ERROR ' + msg); }
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason && e.reason.message || e.reason)));
function log(msg) { const el = $('log'); if (el) { el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`; el.scrollTop = el.scrollHeight; } console.log(msg); }

// ---------- 設定・集計 ----------
const TOP = Math.round(TOP_KMH / 10) * 10;   // 設定できる最高時速（モータの最高回転数で決まる。110 km/h）
const settings = loadSettings(COURSE_IDS, TOP);
const stats = loadStats();
const save = () => saveAll(settings, stats);
const topMs = () => Math.min(settings.maxKmh / 3.6, TOP_MS);
const courseOpts = () => ({ length: settings.course, cones: settings.cones });
const idealOf = (id) => courseInfo(getCourse(id), courseOpts()).idealTime(topMs());
const targetOf = (id) => settings.targets[id] || Math.ceil(idealOf(id) * 1.2);
const rankingOf = (id) => stats.rankings[rankKey(id, settings.course)] || [];

// ---------- 3D ----------
let renderer, world, rig, car = null, fx, sim;
const stages = new StageCache(4);
let stage = null;             // 今シーンに出ているステージ
let courseId = settings.courseId;

function stageFor(id) { return stages.get(getCourse(id), courseOpts()); }
function showStage(st) {
  if (stage === st) return;
  if (stage) world.scene.remove(stage.root);
  stage = st;
  world.scene.add(st.root);
  world.apply(st.env); renderer.setGrade(st.grade);
  world.setCenter(st.center.x, st.center.z, st.center.y);
  st.setDensity(QUALITY[renderer.quality].deco);
  fx.setStage(st); sim.setCourse(st); minimap.setStage(st);
  rig.snap = true;
}

// ---------- 音・景品機・カメラ ----------
const audio = new Audio(settings, log);
const beep = (...a) => audio.beep(...a);
const serial = new PrizeSerial({
  log, onError: showError,
  onLine: (line) => { if (line === 'BTN') onStartButton('button'); },
  onStatus: (ok) => { $('stSerial').textContent = ok ? '景品機: 接続中' : '景品機: 未接続'; $('stSerial').className = ok ? 'ok' : 'ng'; },
});
const pose = new PoseInput({ video: $('video'), canvas: $('cam'), select: $('camSel'), settings, log, save });
pose.onError = showError;

// ---------- 画面の部品 ----------
const hud = new Hud();
const minimap = new MiniMap($('map'));
const select = new CourseSelect($('select'), COURSES, {
  onHighlight: (id) => { if (renderer) { showStage(stageFor(id)); rig.setMode('drone'); rig.drone.s = stage.startS + 30; rig.snap = true; } },
  onMove: () => beep(660, 60, 'triangle', 0.08),
  onConfirm: (id) => { beep(990, 160, 'triangle', 0.12); startGame('select', id); },
  onCancel: () => { toIdle(); },
});

// ---------- 設定画面 ----------
function bindSettings() {
  $('maxKmh').max = TOP;
  // コースの選択肢と目標タイムの表
  $('courseId').innerHTML = COURSES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  $('targets').innerHTML = COURSES.map((c) => `<tr><td>${c.name}</td><td class="ideal" id="ideal-${c.id}"></td><td><input type="number" min="5" max="600" step="1" id="target-${c.id}" data-course="${c.id}"></td></tr>`).join('');
  const ids = ['course', 'courseId', 'maxKmh', 'limit', 'sens', 'assist', 'stock'];
  ids.forEach((id) => { $(id).value = settings[id]; });
  ['cones', 'sound', 'mirror', 'courseSelect'].forEach((id) => { $(id).checked = settings[id]; });
  $('quality').value = String(settings.quality);
  const upd = (ev) => {
    const src = ev && ev.target && ev.target.id;
    settings.course = $('course').value;
    settings.courseId = $('courseId').value;
    settings.maxKmh = Math.max(40, Math.min(TOP, parseInt($('maxKmh').value) || TOP));
    $('maxKmhVal').textContent = `${settings.maxKmh} km/h`;
    settings.limit = Math.max(20, parseInt($('limit').value) || 90);
    settings.sens = parseInt($('sens').value); settings.assist = parseInt($('assist').value);
    settings.stock = parseInt($('stock').value); if (isNaN(settings.stock)) settings.stock = -1;
    ['cones', 'sound', 'mirror', 'courseSelect'].forEach((id) => { settings[id] = $(id).checked; });
    const q = $('quality').value; settings.quality = q === 'auto' ? 'auto' : parseInt(q);
    if (renderer && ev && src === 'quality') { if (settings.quality !== 'auto') setQuality(settings.quality); autoQ.slow = 0; }
    // コース・速度・コーンを変えたとき、または未設定なら、目標タイムを自動で「理論最速 ＋20%」にする
    const auto = !ev || ['course', 'maxKmh', 'cones'].includes(src);
    for (const c of COURSES) {
      const ideal = idealOf(c.id), el = $('target-' + c.id);
      $('ideal-' + c.id).textContent = `理論最速 ${ideal.toFixed(1)} 秒`;
      if (src === 'target-' + c.id) settings.targets[c.id] = Math.max(5, parseInt(el.value) || Math.ceil(ideal * 1.2));
      else if (auto && (ev || !settings.targets[c.id])) settings.targets[c.id] = Math.ceil(ideal * 1.2);
      el.value = settings.targets[c.id];
    }
    settings.target = settings.targets[settings.courseId];   // 旧版の項目（今のコースの目標）
    const worst = Math.max(...COURSES.map((c) => idealOf(c.id)));
    $('limitNote').textContent = settings.limit < worst * 1.5 ? `⚠ 制限時間が短すぎます（いちばん長いコースの理論最速 ${worst.toFixed(0)} 秒）` : '';
    $('sensVal').textContent = `${settings.sens}°`;
    $('assistVal').textContent = settings.assist === 0 ? 'なし' : `${settings.assist}%`;
    save(); drawStats();
  };
  [...ids, 'cones', 'sound', 'mirror', 'courseSelect', 'quality'].forEach((id) => $(id).addEventListener('input', upd));
  $('targets').addEventListener('input', upd);
  upd();
}
function drawStats() {
  $('stStats').textContent = `挑戦 ${stats.plays} 人 / 景品 ${stats.prizes} 個` + (settings.stock >= 0 ? ` / 残り ${settings.stock}` : '');
  $('statsDetail').textContent = `挑戦 ${stats.plays} 人、完走 ${stats.finishes} 人、景品 ${stats.prizes} 個`;
}
$('btnSerial').onclick = () => serial.request();
$('btnTest').onclick = () => serial.send('PRIZE');
$('btnPing').onclick = () => serial.send('PING');
$('btnReset').onclick = () => { if (confirm('集計とランキングをリセットしますか？')) { Object.assign(stats, { plays: 0, finishes: 0, prizes: 0, ranking: [], rankings: {} }); save(); drawStats(); } };
$('gear').onclick = () => $('settings').classList.toggle('show');

// ---------- 画質（品質ティア） ----------
const autoQ = { slow: 0, fast: 0 };
function setQuality(t) {
  renderer.setQuality(t);
  const q = QUALITY[renderer.quality];
  world.setShadowQuality(q.shadow, q.shadow >= 4096 ? 130 : 110);
  fx.quality = renderer.quality;
  if (stage) stage.setDensity(q.deco);
  log(`画質: ${q.name}`);
}

// ---------- 入力（ハンドル・キーボード・自動運転） ----------
let steerSmooth = 0, lastHeldAt = 0;
const keys = { left: false, right: false }; let lastKeyAt = -1e9, autopilot = false;
function readInput(now, dt) {
  let steer = 0, active = false;
  const w = pose.wheel;
  if (autopilot) { steer = sim.autopilot(settings.assist / 100); active = true; }
  else if (keys.left || keys.right || now - lastKeyAt < 1500) { steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); active = true; }
  else if (w.held) { steer = angleToSteer(w.angle, settings.sens); active = true; }
  steerSmooth += (steer - steerSmooth) * (1 - Math.exp(-dt * 25));   // 手ぶれを抑える
  return { steer: steerSmooth, throttle: active ? 1 : 0, active };
}

// ---------- ゲーム進行 ----------
let state = 'loading', t0 = 0, holdStart = 0, raceTime = 0, raceClock = 0, lightsOutAt = 0, t0hit = -1e9, lastLights = -1;
let simSteps = 1;   // テスト用：1 フレームで物理を何回進めるか（__dbg.speedup）
let holdResult = false;   // テスト用：結果画面のまま止める（__dbg.holdResult）
let demoIndex = Math.max(0, COURSE_IDS.indexOf(courseId)), demoDoneAt = 0, directorT = 0, directorI = 0, flash = 0;

function setBig(big, small = '', color = '') {
  const b = $('big');
  if (b.textContent !== big) { b.textContent = big; b.classList.remove('pop'); void b.offsetWidth; if (big) b.classList.add('pop'); }
  b.style.color = color; $('small').textContent = small;
}
function showCard(html) { const c = $('card'); if (c._html !== html) { c._html = html; c.innerHTML = html || ''; } c.style.display = html ? 'block' : 'none'; }
function rankingHtml(id, highlight) {
  const rows = rankingOf(id).slice(0, 5).map((r, i) =>
    `<tr class="${r.id === highlight ? 'me' : ''}"><td>${i + 1}位</td><td>${r.time.toFixed(2)} 秒</td><td>${r.cones ? 'コーン' + r.cones : ''}</td></tr>`).join('');
  return rows ? `<div class="rk-title">🏆 本日のランキング<span>${getCourse(id).name}</span></div><table>${rows}</table>` : '';
}
function setLights(n) { [...document.querySelectorAll('#lights .l')].forEach((l, i) => l.classList.toggle('on', i < n)); if (stage) stage.hooks.setStartLights(n); }

function toIdle() {
  state = 'idle'; holdStart = 0; autopilot = false; select.close();
  $('lights').style.display = 'none'; setLights(0);
  showStage(stageFor(COURSE_IDS[demoIndex % COURSE_IDS.length]));
  sim.reset(); fx.reset(); demoDoneAt = 0; directorT = 0; directorI = 0;
  rig.setMode('chase');
  hud.show('idle');
}
function openSelect() {
  if (state !== 'idle') return;
  if (settings.stock === 0) { setBig('景品切れ', 'スタッフを呼んでね'); return; }
  state = 'select'; holdStart = 0;
  showCard(''); setBig('', ''); $('holdBar').style.display = 'none';
  const info = {};
  for (const c of COURSES) { const r = rankingOf(c.id); info[c.id] = { target: targetOf(c.id), best: r[0] && r[0].time }; }
  hud.show('select');
  select.open(settings.courseId, info);
}
// ESP32 のボタン・Space：待機中はコース選択へ（コース選択を使わない設定ならすぐスタート）、選択中は決定
function onStartButton(by) {
  if (state === 'idle') { if (settings.courseSelect) openSelect(); else startGame(by, settings.courseId); }
  else if (state === 'select') select.confirm();
}
function startGame(by, id = settings.courseId) {
  if (state !== 'idle' && state !== 'select') return;
  if (settings.stock === 0) { setBig('景品切れ', 'スタッフを呼んでね'); state = 'idle'; return; }
  select.close();
  courseId = id; settings.courseId = id; settings.target = targetOf(id); $('courseId').value = id;
  demoIndex = COURSE_IDS.indexOf(id);
  stats.plays++; save(); drawStats(); log(`スタート (${by}) ${getCourse(id).name}`);
  showStage(stageFor(id));
  sim.reset(); fx.reset(); steerSmooth = 0; autopilot = false;
  state = 'lights'; t0 = performance.now(); lastLights = -1;
  lightsOutAt = 5 * 600 + 400 + Math.random() * 800;    // F1 と同じく、消えるタイミングは毎回少しちがう
  $('lights').style.display = 'flex'; setLights(0); showCard(''); $('holdBar').style.display = 'none';
  rig.setMode('grid'); rig.snap = true;
  hud.show('race');
  serial.send('EV:START');
}
function finishRace(ok, reason) {
  t0 = performance.now(); state = 'result';
  const target = targetOf(courseId);
  if (ok) {
    stats.finishes++;
    const id = Date.now(), key = rankKey(courseId, settings.course);
    const list = stats.rankings[key] || (stats.rankings[key] = []);
    list.push({ id, time: raceTime, cones: sim.coneHits });
    list.sort((a, b) => a.time - b.time); stats.rankings[key] = list.slice(0, 50);
    const rank = stats.rankings[key].findIndex((r) => r.id === id) + 1;
    const prize = raceTime <= target && settings.stock !== 0;
    if (prize) {
      stats.prizes++; if (settings.stock > 0) { settings.stock--; $('stock').value = settings.stock; }
      setBig('🎉 景品ゲット！', `タイム ${raceTime.toFixed(2)} 秒\n（目標 ${target} 秒）`, 'var(--win)');
      audio.fanfare(); serial.send('PRIZE');
    } else {
      setBig('ゴール！', `タイム ${raceTime.toFixed(2)} 秒\n目標まで あと ${(raceTime - target).toFixed(2)} 秒！`, '#fff');
      beep(660, 300, 'triangle'); serial.send('EV:LOSE');
    }
    showCard(`<div class="rk-me">${getCourse(courseId).name} 本日 ${rank} 位 ・ コーン ${sim.coneHits} 本</div>` + rankingHtml(courseId, id));
  } else {
    setBig(reason === 'away' ? '中止' : '時間切れ', reason === 'away' ? 'ハンドルから手がはなれました' : 'また挑戦してね！', 'var(--ng)');
    beep(330, 500, 'triangle'); serial.send('EV:LOSE'); showCard('');
  }
  rig.setMode('chase');
  log(`結果: ${ok ? raceTime.toFixed(2) + '秒' : reason} コーン${sim.coneHits} 壁${sim.crashes} (${getCourse(courseId).name})`);
  save(); drawStats();
}

function update(now, dt) {
  const el = now - t0;
  const input = readInput(now, dt);
  const opts = { topMs: topMs(), assist: settings.assist / 100 };
  if (input.active) lastHeldAt = now;
  if (state !== 'idle') $('holdBar').style.display = 'none';
  switch (state) {
    case 'idle': {
      // 待機中は自動運転のデモ走行。ゴールしたら次のコースへ
      sim.update(dt, sim.autopilot(0.5), 1, { topMs: DEMO_KMH / 3.6, assist: 0.5 });
      handleEvents(now, false);
      if (sim.finished) {
        if (!demoDoneAt) demoDoneAt = now;
        else if (now - demoDoneAt > 2500) { demoIndex = (demoIndex + 1) % COURSE_IDS.length; toIdle(); }
      }
      // 中継カメラ風に視点を切り替える
      directorT += dt;
      const shots = ['chase', 'tv', 'chase', 'heli'], dur = [8, 6, 7, 5];
      if (directorT > dur[directorI % 4]) { directorT = 0; directorI++; rig.setMode(shots[directorI % 4]); }
      if (pose.wheel.ready || keys.left || keys.right) {
        if (!holdStart) holdStart = now;
        const p = Math.min(1, (now - holdStart) / START_HOLD_MS);
        $('holdBar').style.display = 'block'; $('holdBar').firstElementChild.style.width = (p * 100) + '%';
        setBig('エアハンドル\nドライブ', 'そのまま にぎっていてね…');
        if (p >= 1) { holdStart = 0; if (settings.courseSelect) openSelect(); else startGame('wheel', settings.courseId); }
      } else {
        holdStart = 0; $('holdBar').style.display = 'none';
        setBig('エアハンドル\nドライブ', settings.stock === 0 ? '景品切れ（スタッフを呼んでね）'
          : `🙌 ハンドルをにぎってスタート！\nコースをえらんで 目標タイム以内にゴールで景品 🎁`);
      }
      if (state === 'idle') showCard(rankingHtml(stage.course.id));
      break;
    }
    case 'select': {
      select.update(dt, pose.wheel);
      break;
    }
    case 'lights': {
      const n = Math.min(5, Math.floor(el / 600));
      if (el < lightsOutAt) {
        if (n !== lastLights) { setLights(n); lastLights = n; if (n > 0) beep(440, 150); }
        setBig('', n < 5 ? 'ハンドルをにぎって準備…' : 'ライトが消えたらスタート！');
      } else {
        setLights(0); lastLights = -1; $('lights').style.display = 'none';
        setBig('GO!', '', 'var(--ok)'); beep(880, 400);
        state = 'race'; t0 = now; raceTime = 0; raceClock = 0; lastHeldAt = now;
        rig.setMode('chase');
      }
      break;
    }
    case 'race': {
      if (el > 900 && now - t0hit > 900) setBig('', input.active ? '' : '✋ ハンドルをにぎって！');
      sim.update(dt, input.steer, input.throttle, opts);
      // タイムは物理を進めた時間の合計（画面が遅い PC でも車の動きとタイムがずれない）
      raceClock += dt;
      raceTime = raceClock + sim.coneHits * CONE_PENALTY;
      handleEvents(now, true);
      if (sim.finished) finishRace(true);
      else if (raceTime > settings.limit) finishRace(false, 'limit');
      else if (now - lastHeldAt > AWAY_MS) finishRace(false, 'away');
      break;
    }
    case 'result': {
      sim.update(dt, 0, 0, opts); handleEvents(now, false);
      if (el > RESULT_MS && !holdResult) { showCard(''); toIdle(); }
      break;
    }
  }
  const racing = state === 'race' || state === 'result';
  const ds = racing && settings.sound ? audio.driveSound() : audio.driveSound(false);
  if (ds) ds.update({ on: settings.sound && racing, rpm: sim.rpm, torque: sim.torque, maxTorque: CAR.torque,
    speed: sim.speed, topSpeed: rpmToMs(CAR.maxRpm), surface: soundSurface(sim.surface), onKerb: sim.onKerb });
}
// 路面の種類 → 走行音の路面（'road' | 'gravel' | 'grass'）
function soundSurface(s) { return s === 'road' || s === 'kerb' || s === 'asphalt' || s === 'concrete' ? 'road' : s === 'gravel' || s === 'sand' || s === 'dirt' ? 'gravel' : 'grass'; }

// 物理のできごと（コーン・壁・周回）
const _vel = new THREE.Vector3(), _pt = new THREE.Vector3();
function handleEvents(now, racing) {
  for (const ev of sim.events) {
    if (ev.type === 'cone') {
      _vel.copy(carPose.fwd).multiplyScalar(sim.speed * 2);   // 当たる前の速さ（当たると半分になる）
      fx.coneHit(ev.index, _vel, carPose.right, ev.rel);
      if (racing) { if (settings.sound) audio.driveSound()?.cone(); setBig('+1秒', 'コーンにぶつかった！', 'var(--ng)'); t0hit = now; }
    } else if (ev.type === 'crash') {
      _pt.copy(carPose.pos).addScaledVector(carPose.right, ev.side * 0.7); _pt.y += 0.35;
      fx.sparks(_pt, _vel.copy(carPose.fwd).multiplyScalar(0.6).addScaledVector(carPose.right, -ev.side * 0.4), 50);
      flash = 0.35;
      if (racing) { if (settings.sound) audio.driveSound()?.crash(); setBig('ガシャン！', 'ガードレールにぶつかった', 'var(--ng)'); t0hit = now; }
    } else if (ev.type === 'lap' && racing) {
      setBig(`LAP ${ev.lap}`, 'ファイナルラップ！', 'var(--win)'); t0hit = now; beep(1046, 200, 'triangle', 0.12);
    }
  }
  sim.events.length = 0;
}

// ---------- 車の位置と向き（物理の s, d → 3D） ----------
const carPose = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), quat: new THREE.Quaternion() };
const _f = {}, _m4 = new THREE.Matrix4(), _back = new THREE.Vector3(), _w = new THREE.Vector3();
let yawRel = 0;
function updateCarPose(dt) {
  const t = stage.track, s = sim.s;
  t.frame(s, _f);
  t.toWorld(s, sim.d, 0, carPose.pos);
  // 横に動いている分だけ車の向きを道からずらす（ハンドルを切った向き）
  const yr = sim.speed > 0.5 ? Math.atan2(sim.dDot, sim.speed) : 0;
  yawRel += (yr - yawRel) * (1 - Math.exp(-dt * 10));
  carPose.fwd.copy(_f.tan).addScaledVector(_f.right, Math.tan(yawRel)).normalize();
  carPose.up.copy(_f.up);
  carPose.right.crossVectors(carPose.fwd, carPose.up).normalize();
  carPose.up.crossVectors(carPose.right, carPose.fwd).normalize();
  _m4.makeBasis(carPose.right, carPose.up, _back.copy(carPose.fwd).negate());
  carPose.quat.setFromRotationMatrix(_m4);
  car.setPose(carPose.pos, carPose.quat);
  car.update(dt, { speed: sim.speed, steer: sim.steer, braking: sim.braking && sim.speed > 0.5, latAcc: sim.latAcc, accel: sim.accel,
    rough: sim.offroad ? 1 : sim.onKerb ? 0.5 : 0, tsal: state === 'race' || state === 'lights' || state === 'result' || state === 'idle' });
}
const wheelsWorld = [new THREE.Vector3(), new THREE.Vector3()];

// ---------- 描画 ----------
function render(dt) {
  if (!stage || !car) return;
  updateCarPose(dt);
  const v01 = sim.speed / TOP_MS;
  car.root.updateMatrixWorld();
  wheelsWorld[0].set(-0.59, 0.02, 0.8).applyMatrix4(car.root.matrixWorld);
  wheelsWorld[1].set(0.59, 0.02, 0.8).applyMatrix4(car.root.matrixWorld);
  fx.update(dt, { pos: carPose.pos, fwd: carPose.fwd, right: carPose.right, speed: sim.speed, surface: sim.surface, offroad: sim.offroad,
    onKerb: sim.onKerb, autoBrake: sim.autoBrake, latAcc: sim.latAcc, wheels: wheelsWorld });
  rig.update(dt, { pos: carPose.pos, fwd: carPose.fwd, up: carPose.up, speed: sim.speed, topSpeed: TOP_MS, shake: sim.shake * 2,
    rough: sim.offroad ? 1 : sim.onKerb ? 0.4 : 0, s: sim.s }, stage.track);
  world.update(dt, rig.camera, carPose.pos, carPose.fwd);
  stage.hooks.update(dt, { state, sim });
  flash = Math.max(0, flash - dt * 1.6);
  const racing = state === 'race' || state === 'result';
  const blur = rig.mode === 'chase' || rig.mode === 'grid' ? Math.max(0, v01 - 0.35) * 0.7 : 0;
  renderer.render(world.scene, rig.camera, {
    blur: racing || state === 'idle' ? blur : 0, chroma: blur * 0.2,
    flash: flash > 0 ? [1, 0.95, 0.85, flash * 0.5] : null, center: [CAR_SHIFT_X, 0.55],
  });
}

function drawHud() {
  const racing = state === 'race' || state === 'result';
  const tgt = targetOf(courseId);
  const lapLen = sim.raceLength / (sim.laps || 1);
  hud.update({
    time: racing ? raceTime : 0, target: tgt, over: racing && raceTime > tgt, progress: sim.progress,
    kmh: sim.speed * 3.6, rpm: sim.rpm, maxRpm: CAR.maxRpm, cones: sim.coneHits, showCones: racing, offroad: racing && sim.offroad,
    lap: sim.lap, laps: sim.laps, course: stage ? stage.course.name : '',
  });
  hud.wheel(pose.wheel);
  minimap.draw(sim.laps > 1 ? (sim.dist % lapLen) / lapLen : sim.progress, state === 'race' || state === 'lights');
}

// ---------- メインループ ----------
let fpsN = 0, fpsT = 0, lastFrame = performance.now(), drawN = 0, lastFps = 60;
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  if (pose.update(now)) fpsN++;
  drawN++;
  if (now - fpsT > 1000) {
    lastFps = drawN;
    $('stFps').textContent = `認識 ${fpsN} / 画面 ${drawN} FPS ・ 画質 ${QUALITY[renderer.quality].name}` + (settings.quality === 'auto' ? '（自動）' : '');
    // 自動の画質：3 秒続けて 45 FPS を下回ったら 1 段下げる（30 FPS 未満なら 2 秒で）
    if (settings.quality === 'auto' && state !== 'loading') {
      autoQ.slow = drawN < 45 ? autoQ.slow + (drawN < 30 ? 1.5 : 1) : 0;
      if (autoQ.slow >= 3 && renderer.quality > 0) { setQuality(renderer.quality - 1); log('描画が重いので画質を下げました'); autoQ.slow = 0; }
    }
    fpsN = 0; drawN = 0; fpsT = now;
  }
  try {
    for (let i = 0; i < simSteps; i++) update(now, i ? 0.05 : dt);
    render(dt + (simSteps - 1) * 0.05);   // 物理を速めたとき（テスト）もカメラが車に追いつくように
    drawHud();
  } catch (e) { showError(e.message); console.error(e); }
  requestAnimationFrame(loop);
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  rig.resize(w, h); rig.setShift(CAR_SHIFT_X);
  fx.setPointScale(renderer.size.y, rig.camera.fov);
}

// ---------- キー操作 ----------
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (state === 'select' && select.key(e)) { e.preventDefault(); return; }
  if (e.code === 'Space') { e.preventDefault(); onStartButton('key'); }
  else if (e.key === 's' || e.key === 'S') $('settings').classList.toggle('show');
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : enterFullscreen(); }
  else if (e.key === 'a' || e.key === 'A') { autopilot = !autopilot; log('自動運転 ' + (autopilot ? 'ON' : 'OFF')); }
  else if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); }   // Esc = 全画面解除
  else if ((e.key === 'q' || e.key === 'Q') && (state === 'race' || state === 'lights')) { $('lights').style.display = 'none'; setLights(0); finishRace(false, 'away'); }
  else if (e.key === 'ArrowLeft') { keys.left = true; lastKeyAt = performance.now(); }
  else if (e.key === 'ArrowRight') { keys.right = true; lastKeyAt = performance.now(); }
  else if (state === 'idle' && /^[1-9]$/.test(e.key) && +e.key <= COURSES.length) { settings.courseId = COURSE_IDS[+e.key - 1]; openSelect(); }
  else if (state === 'idle' && e.key === 'Enter') onStartButton('key');
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') { keys.left = false; lastKeyAt = performance.now(); }
  if (e.key === 'ArrowRight') { keys.right = false; lastKeyAt = performance.now(); }
});

// ---------- 全画面 ----------
// 起動_全画面.bat で開いたとき（?fs=1）は、最初のクリック/キーで全画面にする（ブラウザの決まりで操作が必要）。
// 解除は Esc（ブラウザ標準）。もう一度全画面にするときは F キー。
const wantFs = new URLSearchParams(location.search).has('fs');
let fsDone = false;
function enterFullscreen() { document.documentElement.requestFullscreen().catch((e) => log('全画面にできません: ' + e.message)); }
function updateFsHint() { $('fsHint').style.display = wantFs && !fsDone && !document.fullscreenElement ? 'block' : 'none'; }
const autoFs = (e) => {
  if (!wantFs || fsDone || document.fullscreenElement) return;
  if (e.type === 'keydown' && ['Escape', 'f', 'F'].includes(e.key)) return;
  fsDone = true; enterFullscreen();
};
document.addEventListener('pointerdown', autoFs); document.addEventListener('keydown', autoFs);
document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) fsDone = true; updateFsHint(); });
updateFsHint();

// ---------- 起動 ----------
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function boot() {
  if (location.protocol === 'file:') { showError('index.html を直接開いても動きません。フォルダ内の「起動.bat」をダブルクリックしてください。'); return; }
  bindSettings(); drawStats();
  setBig('準備中…', 'カメラとAIを起動しています');
  try {
    renderer = new Renderer($('game'));
  } catch (e) { showError('3D 表示（WebGL）を使えません: ' + e.message + '\nChrome の設定で「ハードウェア アクセラレーション」を ON にしてください。'); setBig('起動できません', '3D 表示を使えません'); return; }
  world = new World(renderer); rig = new CameraRig(); fx = new Effects(world.scene); sim = new Sim();
  renderer.onResize = onResize; onResize();
  setQuality(settings.quality === 'auto' ? 2 : settings.quality);
  // カメラと骨格認識は並行して読み込む（失敗してもキーボードと自動運転で動くようにする）
  const camReady = Promise.all([pose.startCamera(), pose.loadModel()])
    .then(() => { $('stModel').textContent = `モデル: OK (${pose.delegate})`; })
    .catch((e) => { showError(e.message); $('stModel').textContent = 'モデル: なし（キーボードで操作）'; });
  car = await Car.create('./models/car.glb');
  world.scene.add(car.root);
  // コースを順に作ってサムネイルを撮る（作った物はキャッシュに残る）
  for (let i = 0; i < COURSES.length; i++) {
    const c = COURSES[i];
    setBig('準備中…', `コースを作っています（${i + 1}/${COURSES.length}）${c.name}`);
    await nextFrame();
    const st = stageFor(c.id);
    showStage(st);
    try { select.setThumb(c.id, thumbnail(st)); } catch (e) { log('サムネイルを作れません: ' + e.message); }
  }
  await camReady;
  serial.autoConnect().catch((e) => log('自動接続失敗: ' + e.message));
  toIdle(); log('準備完了');
  requestAnimationFrame(loop);
}
// コース選択のカード用の画像（スタート地点の少し先を上から）
// コースの定義に thumb: { s（スタートからの距離）, d（横）, h（高さ）, look（見る先の距離） } があればその視点
function thumbnail(st) {
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 7000);
  const t = st.track, th = { s: -15, d: 22, h: 22, look: 60, ...(st.course.thumb || {}) };
  const p = t.toWorld(st.startS + th.s, th.d, th.h), look = t.toWorld(st.startS + th.look, 0, 0);
  cam.position.copy(p); cam.lookAt(look); cam.updateMatrixWorld();
  sim.reset(); updateCarPose(0.016); car.root.updateMatrixWorld();
  world.update(0.016, cam, look, carPose.fwd);
  st.hooks.setStartLights(0);
  return renderer.snapshot(world.scene, cam, 512, 288);
}

// ---------- テスト用（window.__dbg） ----------
window.__dbg = {
  get sim() { return sim; }, get race() { return sim; }, settings, stats,
  get state() { return state; }, get raceTime() { return raceTime; },
  get course() { return courseId; }, get stage() { return stage; },
  get quality() { return renderer.quality; }, set quality(t) { settings.quality = t; setQuality(t); },
  setQuality(t) { settings.quality = t; $('quality').value = String(t); setQuality(t); },
  setAuto: (v) => { autopilot = v; },
  openSelect: () => openSelect(),
  selectCourse: (id) => { if (state === 'select') { select.highlight(COURSE_IDS.indexOf(id)); select.confirm(); } else if (state === 'idle') startGame('dbg', id); },
  startRace: (id = settings.courseId) => { if (state === 'select') select.close(); if (state === 'select' || state === 'idle') { state = 'idle'; startGame('dbg', id); } },
  skipLights: () => { if (state === 'lights') lightsOutAt = 0; },
  toIdle: () => toIdle(),
  idealTime: (id = courseId) => idealOf(id), target: (id = courseId) => targetOf(id),
  get select() { return select; }, get renderer() { return renderer; }, get world() { return world; }, get rig() { return rig; }, get car() { return car; }, get fx() { return fx; },
  get fps() { return lastFps; },
  // テスト用：1 フレームで物理を n 回（各 0.05 秒）進める。ソフトウェア描画の遅い環境で一連の流れを確かめるとき
  speedup: (n = 1) => { simSteps = Math.max(1, Math.min(60, n | 0)); },
  set holdResult(v) { holdResult = !!v; }, get holdResult() { return holdResult; },
  info: () => ({ calls: renderer.r.info.render.calls, triangles: renderer.r.info.render.triangles, geometries: renderer.r.info.memory.geometries, textures: renderer.r.info.memory.textures, quality: renderer.quality }),
};

boot();
