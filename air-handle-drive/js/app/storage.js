// 設定と集計（ブラウザの localStorage に保存）。
// キーは旧版と同じ 'air-handle-settings' / 'air-handle-stats'。旧版の値もそのまま読める（足りない項目は既定値）。
// 壊れた値・ありえない値を読んでも落ちないよう、読み込み時に 1 項目ずつ確かめる。
export const SKEY = 'air-handle-settings', STATKEY = 'air-handle-stats';

const store = {
  get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

const num = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : def);
const int = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi ? v : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const str = (v, list, def) => (typeof v === 'string' && (!list || list.includes(v)) ? v : def);

// 設定の既定値。course は「コースの長さ」（旧版の名前のまま）、courseId は「どのコースか」
export function defaultSettings(top) {
  return {
    course: 'normal', courseId: 'circuit', courseSelect: true,
    maxKmh: top, target: 0, targets: {}, limit: 90, sens: 45, assist: 30,
    cones: true, sound: true, mirror: true, stock: -1, camId: '', quality: 'auto',
  };
}

// courseIds: 有効なコースの id 一覧、top: 設定できる最高時速
export function loadSettings(courseIds, top) {
  const d = defaultSettings(top), raw = store.get(SKEY);
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = { ...d };
  s.course = str(r.course, ['short', 'normal', 'long'], d.course);
  s.courseId = str(r.courseId, courseIds, d.courseId);
  s.courseSelect = bool(r.courseSelect, d.courseSelect);
  // 旧版は最高 300 km/h まで設定できたので、モータの最高速に合わせる
  s.maxKmh = typeof r.maxKmh === 'number' && isFinite(r.maxKmh) ? Math.max(40, Math.min(top, Math.round(r.maxKmh / 10) * 10)) : d.maxKmh;
  s.target = num(r.target, 0, 600, 0);
  s.targets = {};
  if (r.targets && typeof r.targets === 'object') for (const id of courseIds) { const v = r.targets[id]; if (typeof v === 'number' && isFinite(v) && v >= 5 && v <= 600) s.targets[id] = Math.round(v); }
  s.limit = num(r.limit, 20, 900, d.limit);
  s.sens = int(r.sens, 20, 70, d.sens);
  s.assist = int(r.assist, 0, 100, d.assist);
  s.cones = bool(r.cones, d.cones);
  s.sound = bool(r.sound, d.sound);
  s.mirror = bool(r.mirror, d.mirror);
  s.stock = int(r.stock, -1, 100000, d.stock);
  s.camId = typeof r.camId === 'string' ? r.camId : '';
  s.quality = r.quality === 'auto' || [0, 1, 2, 3].includes(r.quality) ? r.quality : d.quality;
  return s;
}

// ランキング 1 件の形を確かめる
const okEntry = (e) => e && typeof e === 'object' && typeof e.time === 'number' && isFinite(e.time) && e.time > 0 && e.time < 3600;
const cleanList = (l) => (Array.isArray(l) ? l.filter(okEntry).map((e) => ({ id: Number.isFinite(e.id) ? e.id : 0, time: e.time, cones: int(e.cones, 0, 9999, 0) })).sort((a, b) => a.time - b.time).slice(0, 50) : []);

// 集計。ranking（旧版の 1 本のランキング）はそのまま残し、新しいコース別のランキングは rankings[`${courseId}:${length}`]
export function loadStats() {
  const raw = store.get(STATKEY), r = raw && typeof raw === 'object' ? raw : {};
  const st = {
    plays: int(r.plays, 0, 1e9, 0), finishes: int(r.finishes, 0, 1e9, 0), prizes: int(r.prizes, 0, 1e9, 0),
    ranking: cleanList(r.ranking), rankings: {},
  };
  if (r.rankings && typeof r.rankings === 'object') for (const k of Object.keys(r.rankings)) if (/^[a-z0-9_-]+:(short|normal|long)$/.test(k)) st.rankings[k] = cleanList(r.rankings[k]);
  return st;
}

export function saveAll(settings, stats) {
  const a = store.set(SKEY, settings), b = store.set(STATKEY, stats);
  return a && b;
}

export const rankKey = (courseId, length) => `${courseId}:${length}`;
