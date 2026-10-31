// 記録（タイム）を PC のフォルダに保存・読み込みする（Chrome / Edge の File System Access API）
// 選んだフォルダに records.csv を作り、1回走るごとに1行足す。Excel でそのまま開ける（UTF-8 BOM 付き）。
// フォルダの場所はブラウザ（IndexedDB）に覚えておき、次に起動したときも同じフォルダを使う。
// ブラウザを開き直すと書き込みの許可が「確認待ち」に戻るので、最初のクリックかキー操作のときに許可を取り直す。
// フォルダを選べないブラウザ（Mac の Safari・Firefox）では、記録をブラウザの中（localStorage）に残し、「フォルダを選ぶ」の代わりに records.csv をダウンロードする。

const FILE = 'records.csv';
const LKEY = 'ahd.records';
export const COLS = ['日時', '受付番号', '回目', '結果', 'タイム秒', 'コーン', 'この回の景品数', '判定', '渡した景品数', 'コース', '最高時速'];

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('air-handle-drive', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kv(key, value) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', value === undefined ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
    const r = value === undefined ? st.get(key) : st.put(value, key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export class Records {
  constructor() { this.dir = null; this.state = 'none'; this.rows = []; this.local = !('showDirectoryPicker' in window); }   // state: none（未設定）/ prompt（許可待ち）/ ok / error
  get supported() { return !this.local; }
  get name() { return this.local ? 'ブラウザ内' : this.dir ? this.dir.name : ''; }
  get csv() { return '﻿' + [COLS.join(','), ...this.rows.map((r) => COLS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n'; }
  // フォルダを選べないブラウザ用：records.csv をダウンロードする
  download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.csv], { type: 'text/csv' })); a.download = FILE;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // 起動時：前に選んだフォルダを思い出す（許可が残っていれば読み込みまでする）
  async restore() {
    if (this.local) return this.load();
    try { this.dir = (await kv('dir')) || null; } catch { this.dir = null; }
    if (!this.dir) return;
    this.state = (await this.dir.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'prompt';
    if (this.state === 'ok') await this.load();
  }
  // クリックやキー操作の中で呼ぶ（ブラウザの決まりで、許可の確認は操作の中でしか出せない）
  async grant() {
    if (this.local) return true;
    if (!this.dir || this.state === 'ok') return this.state === 'ok';
    try { this.state = (await this.dir.requestPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'prompt'; } catch { this.state = 'prompt'; }
    if (this.state === 'ok') await this.load();
    return this.state === 'ok';
  }
  // 設定の「フォルダを選ぶ」
  async pick() {
    this.dir = await window.showDirectoryPicker({ id: 'air-handle-records', mode: 'readwrite' });
    await kv('dir', this.dir);
    this.state = 'ok';
    await this.load();
  }

  async load() {
    if (this.local) {
      try { this.rows = JSON.parse(localStorage.getItem(LKEY)) || []; } catch { this.rows = []; }
      this.state = 'ok'; return this.rows;
    }
    try {
      const fh = await this.dir.getFileHandle(FILE, { create: true });
      const text = await (await fh.getFile()).text();
      const rows = parseCsv(text).filter((r) => r.length > 1);
      const head = rows[0] && rows[0][0] === COLS[0] ? rows.shift() : COLS;
      this.rows = rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
      this.state = 'ok';
    } catch (e) { this.state = 'error'; this.error = e.message; throw e; }
    return this.rows;
  }

  // 1行足す（ファイルの最後に書き足す）。続けて呼ばれても1行ずつ順に書く（同時に書くと後の行が前の行を上書きするため）
  append(rec) {
    this.queue = (this.queue || Promise.resolve()).catch(() => {}).then(() => this.appendNow(rec));
    return this.queue;
  }
  async appendNow(rec) {
    if (this.state !== 'ok') return false;
    if (this.local) {
      this.rows.push(Object.fromEntries(COLS.map((c) => [c, String(rec[c] ?? '')])));
      try { localStorage.setItem(LKEY, JSON.stringify(this.rows)); } catch {}
      return true;
    }
    const fh = await this.dir.getFileHandle(FILE, { create: true });
    const file = await fh.getFile();
    const w = await fh.createWritable({ keepExistingData: true });
    await w.seek(file.size);
    await w.write((file.size ? '' : '﻿' + COLS.join(',') + '\r\n') + COLS.map((c) => csvCell(rec[c])).join(',') + '\r\n');
    await w.close();
    this.rows.push(Object.fromEntries(COLS.map((c) => [c, String(rec[c] ?? '')])));
    return true;
  }
}
