// コース選択画面。ハンドル（左右に傾ける）で選び、まっすぐ握ったまま待つと決定。
// キーボード: ← → で選ぶ / 1〜4 で直接 / Enter・Space で決定 / Q で戻る。マウス: カードをクリックで決定。
export const CONFIRM_S = 2.4;     // まっすぐ握ったままこの秒数で決定
const TILT_ON = 18, TILT_OFF = 9, STRAIGHT = 11;   // [度]
const IDLE_BACK_S = 25;            // だれも握っていないとき、この秒数で待機画面に戻る

export class CourseSelect {
  // root: 画面の要素（#select）, courses: コース定義の配列
  constructor(root, courses, { onConfirm, onCancel, onHighlight, onMove } = {}) {
    this.root = root; this.courses = courses;
    this.onConfirm = onConfirm; this.onCancel = onCancel; this.onHighlight = onHighlight; this.onMove = onMove;
    this.index = 0; this.isOpen = false; this.hold = 0; this.latch = 0; this.repeat = 0; this.idle = 0; this.opened = 0;
    root.innerHTML = `
      <div class="sel-title"><span class="sel-step">STEP 1</span>コースをえらんでね</div>
      <div class="sel-cards"></div>
      <div class="sel-help">
        <div class="sel-hint"><span class="arr">◀</span>
          <svg class="sel-wheel" viewBox="-50 -50 100 100"><circle r="40" fill="none" stroke="currentColor" stroke-width="9"/><path d="M-40 0 H40 M0 0 V40" stroke="currentColor" stroke-width="8" fill="none"/><circle r="9" fill="currentColor"/></svg>
          <span class="arr">▶</span></div>
        <div class="sel-msg"><b>ハンドルをかたむけて えらぶ</b><br>まっすぐ にぎったまま で けってい</div>
        <svg class="sel-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="bg"/><circle cx="50" cy="50" r="42" class="fg"/><text x="50" y="58" text-anchor="middle">OK</text></svg>
      </div>
      <div class="sel-keys">キーボード：← → / 1〜4 で選ぶ ・ Enter で決定 ・ Q で戻る</div>`;
    this.cardsEl = root.querySelector('.sel-cards');
    this.wheelEl = root.querySelector('.sel-wheel');
    this.ringEl = root.querySelector('.sel-ring .fg');
    this.cards = courses.map((c, i) => {
      const el = document.createElement('div');
      el.className = 'card'; el.style.setProperty('--accent', c.accent || '#4fc3f7');
      el.innerHTML = `
        <div class="thumb"><span class="num">${i + 1}</span><div class="ph"></div></div>
        <div class="body">
          <div class="name${c.name.length > 7 ? ' long' : ''}">${c.name}</div><div class="en">${c.nameEn || ''}</div>
          <div class="desc">${(c.desc || '').replace(/\n/g, '<br>')}</div>
          <div class="meta"><span class="stars">${'★'.repeat(c.difficulty || 1)}${'☆'.repeat(3 - (c.difficulty || 1))}</span><span class="info"></span></div>
        </div>`;
      el.addEventListener('click', () => { if (!this.isOpen) return; this.highlight(i); this.confirm(); });
      el.addEventListener('pointerenter', () => { if (this.isOpen && this._mouse) this.highlight(i); });
      this.cardsEl.appendChild(el);
      return el;
    });
    root.addEventListener('pointermove', () => { this._mouse = true; });
  }

  setThumb(id, canvas) {
    const i = this.courses.findIndex((c) => c.id === id); if (i < 0) return;
    const ph = this.cards[i].querySelector('.thumb .ph');
    const img = new Image(); img.src = canvas.toDataURL('image/jpeg', 0.85); img.alt = '';
    ph.replaceWith(img); img.className = 'ph';
  }

  // info: { [id]: { target, best } }
  open(id, info = {}) {
    this.isOpen = true; this.root.classList.add('show');
    this.hold = 0; this.latch = 0; this.repeat = 0; this.idle = 0; this.opened = performance.now(); this._mouse = false;
    this.courses.forEach((c, i) => {
      const x = info[c.id] || {};
      this.cards[i].querySelector('.info').textContent = `目標 ${x.target ?? '-'} 秒` + (x.best ? ` ・ 本日ベスト ${x.best.toFixed(2)} 秒` : '');
    });
    const i = Math.max(0, this.courses.findIndex((c) => c.id === id));
    this.index = -1; this.highlight(i);
  }
  close() { this.isOpen = false; this.root.classList.remove('show'); }
  get current() { return this.courses[this.index]; }

  highlight(i) {
    i = (i + this.courses.length) % this.courses.length;
    if (i === this.index) return;
    this.index = i; this.hold = 0;
    this.cards.forEach((el, k) => el.classList.toggle('on', k === i));
    this.root.style.setProperty('--accent', this.courses[i].accent || '#4fc3f7');
    if (this.onHighlight) this.onHighlight(this.courses[i].id);
  }
  move(dir) { this.highlight(this.index + dir); if (this.onMove) this.onMove(dir); }
  confirm() { if (!this.isOpen) return; const c = this.current; this.close(); if (this.onConfirm) this.onConfirm(c.id); }
  cancel() { if (!this.isOpen) return; this.close(); if (this.onCancel) this.onCancel(); }

  // 毎フレーム。wheel: { held, angle }
  update(dt, wheel) {
    if (!this.isOpen) return;
    const held = wheel && wheel.held;
    const a = held ? wheel.angle : 0;
    if (held) {
      this.idle = 0;
      if (Math.abs(a) > TILT_ON) {
        if (this.latch !== Math.sign(a)) { this.latch = Math.sign(a); this.repeat = 0; this.move(this.latch); }
        else if ((this.repeat += dt) > 1.1) { this.repeat = 0.5; this.move(this.latch); }
        this.hold = 0;
      } else if (Math.abs(a) < TILT_OFF) this.latch = 0;
      if (Math.abs(a) < STRAIGHT && !this.latch) this.hold += dt; else this.hold = Math.max(0, this.hold - dt * 2);
      if (this.hold >= CONFIRM_S) { this.hold = 0; this.confirm(); return; }
    } else {
      this.hold = Math.max(0, this.hold - dt * 2); this.latch = 0;
      if ((this.idle += dt) > IDLE_BACK_S) { this.cancel(); return; }
    }
    // 表示
    this.wheelEl.style.transform = `rotate(${Math.max(-60, Math.min(60, a))}deg)`;
    this.wheelEl.classList.toggle('held', !!held);
    const f = Math.min(1, this.hold / CONFIRM_S);
    this.ringEl.style.strokeDashoffset = String(264 * (1 - f));
    this.root.classList.toggle('holding', f > 0.02);
  }

  // キー操作。処理したら true
  key(e) {
    if (!this.isOpen) return false;
    if (e.key === 'ArrowLeft') { this.move(-1); return true; }
    if (e.key === 'ArrowRight') { this.move(1); return true; }
    if (/^[1-9]$/.test(e.key) && +e.key <= this.courses.length) { this.highlight(+e.key - 1); return true; }
    if (e.key === 'Enter' || e.code === 'Space') { if (performance.now() - this.opened > 250) this.confirm(); return true; }
    if (e.key === 'q' || e.key === 'Q' || e.key === 'Backspace') { this.cancel(); return true; }
    return false;
  }
}
