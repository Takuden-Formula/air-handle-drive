// レース中の表示（タイム・目標・進み具合・速度・回転数・コーン・周回・コース名・カメラ画面の文字）
// 値が変わったときだけ DOM を書き換える（毎フレーム書くと重い）
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      root: document.body, time: $('tTime'), goal: $('tGoal'), prog: $('prog'), cones: $('hudCones'), speed: $('speed'), rpm: $('rpm'),
      rpmBar: $('rpmBar'), camLabel: $('camLabel'), lap: $('hudLap'), course: $('hudCourse'), warn: $('hudWarn'),
    };
    this.cache = {};
  }
  set(key, el, prop, v) { if (this.cache[key] !== v) { this.cache[key] = v; if (prop === 'text') el.textContent = v; else if (prop === 'width') el.style.width = v; else if (prop === 'color') el.style.color = v; else if (prop === 'display') el.style.display = v; } }
  // racing: レース中か（表示を出すか）
  show(mode) { if (this.mode !== mode) { this.mode = mode; document.body.dataset.hud = mode; } }

  // st: { time, target, over, progress, kmh, rpm, maxRpm, cones, offroad, lap, laps, course }
  update(st) {
    const e = this.el;
    this.set('time', e.time, 'text', st.time.toFixed(2));
    this.set('timeC', e.time, 'color', st.over ? 'var(--ng)' : '');
    this.set('goal', e.goal, 'text', st.target ? `目標 ${st.target} 秒` : '');
    this.set('prog', e.prog, 'width', (st.progress * 100).toFixed(1) + '%');
    this.set('speed', e.speed, 'text', String(Math.round(st.kmh)));
    this.set('rpm', e.rpm, 'text', String(Math.round(st.rpm / 10) * 10));
    this.set('rpmBar', e.rpmBar, 'width', Math.min(100, st.rpm / st.maxRpm * 100).toFixed(1) + '%');
    this.set('cones', e.cones, 'text', st.showCones ? `コーン ${st.cones} 本` : '');
    this.set('warn', e.warn, 'text', st.offroad ? '⚠ コースアウト' : '');
    this.set('lap', e.lap, 'text', st.laps > 1 ? `LAP ${Math.min(st.lap + 1, st.laps)}/${st.laps}` : '');
    this.set('course', e.course, 'text', st.course || '');
  }
  wheel(w) {
    const e = this.el;
    this.set('cam', e.camLabel, 'text', w.held ? `ハンドル ${Math.round(w.angle)}°` : '両手を見せてね');
    this.set('camC', e.camLabel, 'color', w.held ? 'var(--ok)' : 'var(--ng)');
  }
}
