/* =========================================================================
   Store — everything lives in localStorage on this phone.
   Entries snapshot their own macros, so editing a food later never
   rewrites history.
   ========================================================================= */

const KEY = 'macros.v1';

const DEFAULTS = {
  targets: { kcal: 2500, p: 150, c: 280, f: 80 },
  ai: { provider: 'gemini', key: '', model: 'gemini-flash-latest', baseUrl: '' },
  foods: {},    // id -> { id, name, brand, per100:{kcal,p,c,f}, servingG, barcode, source }
  entries: [],  // { id, date, meal, foodId, name, grams, kcal, p, c, f, ts }
  favs: [],     // food ids
};

const clone = o => JSON.parse(JSON.stringify(o));

function merge(d) {
  const base = clone(DEFAULTS);
  if (!d || typeof d !== 'object') return base;
  return {
    targets: { ...base.targets, ...(d.targets || {}) },
    ai: { ...base.ai, ...(d.ai || {}) },
    foods: d.foods && typeof d.foods === 'object' ? d.foods : {},
    entries: Array.isArray(d.entries) ? d.entries : [],
    favs: Array.isArray(d.favs) ? d.favs : [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch (e) {
    console.warn('Load failed', e);
  }
  return merge(null);
}

export const store = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    console.error('Save failed', e);
    return false;
  }
}

/** Replace all data (import). Keeps the current AI settings unless the file has a key. */
export function replaceAll(data) {
  if (!data || !Array.isArray(data.entries) || typeof data.foods !== 'object') {
    throw new Error('Not a valid backup file');
  }
  const ai = store.ai;
  const next = merge(data);
  if (!next.ai.key) next.ai = ai;
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, next);
  save();
}

export function exportData() {
  const out = clone(store);
  out.ai = { ...out.ai, key: '' }; // never put the key in a file that might get shared
  out.exportedAt = new Date().toISOString();
  return out;
}

/* ---------- helpers ---------- */

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const r1 = x => Math.round((Number(x) || 0) * 10) / 10;
export const num = x => {
  const n = parseFloat(String(x ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/* ---------- foods ---------- */

export function saveFood(food) {
  if (!food.id) food.id = uid();
  food.per100 = {
    kcal: r1(food.per100?.kcal), p: r1(food.per100?.p),
    c: r1(food.per100?.c), f: r1(food.per100?.f),
  };
  store.foods[food.id] = food;
  save();
  return food;
}

export function foodByBarcode(code) {
  return Object.values(store.foods).find(f => f.barcode === code) || null;
}

export function macrosFor(food, grams) {
  const k = num(grams) / 100;
  const p = food.per100 || {};
  return { kcal: Math.round(num(p.kcal) * k), p: r1(num(p.p) * k), c: r1(num(p.c) * k), f: r1(num(p.f) * k) };
}

export function toggleFav(id) {
  const i = store.favs.indexOf(id);
  if (i >= 0) store.favs.splice(i, 1); else store.favs.unshift(id);
  save();
  return i < 0;
}
export const isFav = id => store.favs.includes(id);

export function favFoods() {
  return store.favs.map(id => store.foods[id]).filter(Boolean);
}

export function recentFoods(n = 12) {
  const seen = new Set();
  const out = [];
  const sorted = [...store.entries].sort((a, b) => b.ts - a.ts);
  for (const e of sorted) {
    if (!e.foodId || seen.has(e.foodId)) continue;
    const f = store.foods[e.foodId];
    if (!f) continue;
    seen.add(e.foodId);
    out.push({ food: f, grams: e.grams });
    if (out.length >= n) break;
  }
  return out;
}

export function searchLocal(q) {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return Object.values(store.foods)
    .filter(f => `${f.name} ${f.brand || ''}`.toLowerCase().includes(t))
    .slice(0, 10);
}

/* ---------- entries ---------- */

export function addEntry(e) {
  const entry = {
    id: uid(), ts: Date.now(),
    date: e.date, meal: e.meal, foodId: e.foodId || null,
    name: e.name || 'Food', grams: e.grams == null ? null : r1(e.grams),
    kcal: Math.round(num(e.kcal)), p: r1(e.p), c: r1(e.c), f: r1(e.f),
  };
  store.entries.push(entry);
  save();
  return entry;
}

export function updateEntry(id, patch) {
  const e = store.entries.find(x => x.id === id);
  if (!e) return null;
  Object.assign(e, patch);
  e.kcal = Math.round(num(e.kcal)); e.p = r1(e.p); e.c = r1(e.c); e.f = r1(e.f);
  save();
  return e;
}

export function deleteEntry(id) {
  const i = store.entries.findIndex(x => x.id === id);
  if (i >= 0) { store.entries.splice(i, 1); save(); }
}

export function entriesFor(date) {
  return store.entries.filter(e => e.date === date).sort((a, b) => a.ts - b.ts);
}

export function totals(list) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const e of list) { t.kcal += num(e.kcal); t.p += num(e.p); t.c += num(e.c); t.f += num(e.f); }
  return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) };
}
