/* =========================================================================
   UI — Today, History, Foods, Settings, plus one bottom sheet that every
   add/edit flow renders into.
   ========================================================================= */

import {
  store, save, uid, r1, num, dayKey, parseKey, addDays,
  saveFood, foodByBarcode, macrosFor, toggleFav, isFav, favFoods, recentFoods, searchLocal,
  addEntry, updateEntry, deleteEntry, entriesFor, totals, exportData, replaceAll,
} from './store.js';
import { PROVIDERS, lookupBarcode, searchOFF, shrinkImage, analyseMeal, analyseLabel, testAI } from './food.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = '') => `<svg class="ico ${cls}"><use href="#i-${id}"/></svg>`;
const fmt = n => (Math.round(num(n) * 10) / 10).toLocaleString('en-GB');

const MEALS = [
  { id: 'breakfast', name: 'Breakfast' },
  { id: 'lunch', name: 'Lunch' },
  { id: 'dinner', name: 'Dinner' },
  { id: 'snacks', name: 'Snacks' },
];
const mealName = id => MEALS.find(m => m.id === id)?.name || 'Snacks';

function defaultMeal() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snacks';
}

const state = { view: 'today', date: dayKey(), range: 7 };
const ctx = { meal: defaultMeal() }; // meal chosen in the current add flow

const main = $('#main');

/* =========================================================================
   Toast
   ========================================================================= */

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? `<button>${esc(action.label)}</button>` : '');
  t.classList.toggle('action', !!action);
  if (action) $('button', t).onclick = () => { t.classList.remove('show'); action.run(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2400);
}

/* =========================================================================
   Sheet — one at a time. Android back closes it.
   ========================================================================= */

const sheet = $('#sheet'), scrim = $('#scrim'), sheetBody = $('#sheet-body');
let sheetOpen = false, sheetCleanup = null, sheetGen = 0;

function runCleanup() {
  const f = sheetCleanup;
  sheetCleanup = null;
  if (f) try { f(); } catch (e) { console.warn(e); }
}

/** Render html into the sheet. Returns a generation number — compare with live(gen) after any await. */
function openSheet(html, { onClose } = {}) {
  runCleanup();
  sheetGen++;
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = 0;
  sheetCleanup = onClose || null;
  if (!sheetOpen) {
    sheetOpen = true;
    sheet.classList.add('open');
    scrim.classList.add('open');
    history.pushState({ sheet: true }, '');
  }
  return sheetGen;
}
const live = gen => sheetOpen && gen === sheetGen;

function hideSheet() {
  sheetOpen = false;
  sheetGen++;
  runCleanup();
  sheet.classList.remove('open');
  scrim.classList.remove('open');
  document.activeElement?.blur?.();
}
function closeSheet() {
  if (!sheetOpen) return;
  if (history.state?.sheet) history.back(); // popstate does the hiding
  else hideSheet();
}
window.addEventListener('popstate', () => { if (sheetOpen) hideSheet(); });
scrim.addEventListener('click', closeSheet);

function loadingSheet(text, img) {
  return openSheet(`${img ? `<img class="thumb" src="${img}" alt="">` : ''}
    <div class="loading"><div class="spinner"></div><p>${esc(text)}</p></div>
    <button class="btn ghost" data-close>Cancel</button>`);
}
sheetBody.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });

/* =========================================================================
   Views
   ========================================================================= */

function render() {
  $$('#nav .tab').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  ({ today: renderToday, history: renderHistory, foods: renderFoods, settings: renderSettings })[state.view]();
}

function setView(v) {
  state.view = v;
  if (v === 'today') state.date = state.date || dayKey();
  render();
  window.scrollTo(0, 0);
}

$('#nav').addEventListener('click', e => {
  const t = e.target.closest('[data-view]');
  if (t) setView(t.dataset.view);
});
$('#fab').addEventListener('click', () => {
  if (state.view !== 'today') { state.view = 'today'; render(); }
  openAdd(state.date === dayKey() ? defaultMeal() : 'snacks');
});

/* ---------- Today ---------- */

function dayLabel(key) {
  const today = dayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  return parseKey(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function ring(eaten, target) {
  const R = 56, C = 2 * Math.PI * R;
  const frac = target > 0 ? Math.min(1, eaten / target) : 0;
  const over = target > 0 && eaten > target;
  const left = Math.round(target - eaten);
  return `<div class="ring">
    <svg width="132" height="132" viewBox="0 0 132 132">
      <circle cx="66" cy="66" r="${R}" stroke="var(--surface-3)" stroke-width="11" fill="none"/>
      <circle cx="66" cy="66" r="${R}" stroke="${over ? 'var(--bad)' : 'var(--kcal)'}" stroke-width="11" fill="none"
        stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" style="transition:stroke-dashoffset .4s"/>
    </svg>
    <div class="mid"><div class="big tnum">${Math.abs(left).toLocaleString('en-GB')}</div><div class="lbl">${over ? 'kcal over' : 'kcal left'}</div></div>
  </div>`;
}

function bar(label, key, val, target) {
  const pct = target > 0 ? Math.min(100, (val / target) * 100) : 0;
  return `<div><div class="bar-top"><b>${label}</b><span class="tnum muted">${fmt(val)} / ${fmt(target)} g</span></div>
    <div class="track"><div class="fill" style="width:${pct}%;background:var(--${key})"></div></div></div>`;
}

function entrySub(e) {
  const parts = [];
  if (e.grams != null) parts.push(`${fmt(e.grams)} g`);
  parts.push(`P ${fmt(e.p)}`, `C ${fmt(e.c)}`, `F ${fmt(e.f)}`);
  return parts.join(' · ');
}

function renderToday() {
  const list = entriesFor(state.date);
  const t = totals(list);
  const T = store.targets;
  const isToday = state.date >= dayKey();
  main.innerHTML = `
    <header class="day-nav">
      <button class="icon-btn" data-day="-1" aria-label="Previous day">${icon('chev-l')}</button>
      <button class="day-label" id="day-label">${esc(dayLabel(state.date))}</button>
      <button class="icon-btn" data-day="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>${icon('chev-r')}</button>
    </header>
    <section class="card">
      <div class="summary">${ring(t.kcal, T.kcal)}
        <div class="bars">${bar('Protein', 'p', t.p, T.p)}${bar('Carbs', 'c', t.c, T.c)}${bar('Fat', 'f', t.f, T.f)}</div>
      </div>
      <div class="eaten-line tnum">${t.kcal.toLocaleString('en-GB')} eaten · target ${num(T.kcal).toLocaleString('en-GB')} kcal</div>
    </section>
    ${MEALS.map(m => {
      const es = list.filter(e => e.meal === m.id);
      const kc = totals(es).kcal;
      return `<section class="card meal" style="padding:6px 0">
        <div class="meal-head"><h2>${m.name}</h2>${es.length ? `<span class="meal-kcal tnum">${kc} kcal</span>` : ''}
          <button class="meal-add" data-add="${m.id}" aria-label="Add to ${m.name}">${icon('plus', 'ico-sm')}</button></div>
        ${es.length ? es.map(e => `<button class="entry" data-entry="${e.id}">
            <div><div class="nm">${esc(e.name)}</div><div class="sub tnum">${entrySub(e)}</div></div>
            <span class="kc tnum">${e.kcal}</span></button>`).join('')
          : `<div class="empty">Nothing yet</div>`}
      </section>`;
    }).join('')}`;

  $$('[data-day]', main).forEach(b => b.onclick = () => {
    state.date = addDays(state.date, +b.dataset.day);
    if (state.date > dayKey()) state.date = dayKey();
    render();
  });
  $('#day-label', main).onclick = () => { state.date = dayKey(); render(); };
  $$('[data-add]', main).forEach(b => b.onclick = () => openAdd(b.dataset.add));
  $$('[data-entry]', main).forEach(b => b.onclick = () => openEntry(b.dataset.entry));
}

/* ---------- History ---------- */

function proteinStreak() {
  const T = store.targets.p;
  if (!(T > 0)) return 0;
  let d = dayKey(), n = 0;
  if (totals(entriesFor(d)).p < T) d = addDays(d, -1); // today still in progress
  while (totals(entriesFor(d)).p >= T) { n++; d = addDays(d, -1); }
  return n;
}

function renderHistory() {
  const n = state.range;
  const today = dayKey();
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  const data = days.map(d => ({ d, ...totals(entriesFor(d)), count: entriesFor(d).length }));
  const logged = data.filter(x => x.count);
  const avg = k => logged.length ? Math.round(logged.reduce((s, x) => s + x[k], 0) / logged.length) : 0;
  const T = store.targets;

  // chart
  const W = 340, H = 150, pad = 18;
  const max = Math.max(T.kcal * 1.25, ...data.map(x => x.kcal), 1);
  const bw = (W - 8) / n;
  const y = v => H - pad - (v / max) * (H - pad - 6);
  const bars = data.map((x, i) => {
    const h = H - pad - y(x.kcal);
    const col = x.kcal > T.kcal ? 'var(--bad)' : 'var(--kcal)';
    const label = n <= 7 ? parseKey(x.d).toLocaleDateString('en-GB', { weekday: 'narrow' })
      : (i % 5 === 4 || i === n - 1 ? parseKey(x.d).getDate() : '');
    return `<rect x="${4 + i * bw + bw * 0.18}" y="${y(x.kcal)}" width="${bw * 0.64}" height="${Math.max(0, h)}" rx="${Math.min(4, bw * 0.2)}" fill="${col}" opacity="${x.d === today ? 1 : .8}"/>
      <text x="${4 + i * bw + bw / 2}" y="${H - 3}" text-anchor="middle" font-size="10" fill="var(--text-3)">${label}</text>`;
  }).join('');
  const ty = y(T.kcal);

  main.innerHTML = `
    <header class="day-nav"><h1>History</h1>
      <div class="seg" style="width:150px">${[7, 30].map(r => `<button data-range="${r}" class="${n === r ? 'on' : ''}">${r} days</button>`).join('')}</div>
    </header>
    <div class="stack">
      <div class="stats">
        <div><b class="tnum">${avg('kcal').toLocaleString('en-GB')}</b><small>avg kcal</small></div>
        <div><b class="tnum">${avg('p')}<span style="font-size:14px">g</span></b><small>avg protein</small></div>
        <div><b class="tnum">${proteinStreak()}</b><small>protein streak</small></div>
      </div>
      <section class="card chart">
        <h3 style="margin-bottom:10px">Calories</h3>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day">
          ${bars}
          <line x1="0" x2="${W}" y1="${ty}" y2="${ty}" stroke="var(--text-3)" stroke-dasharray="4 4"/>
        </svg>
        <div class="faint" style="font-size:12px;margin-top:6px">Dashed line = ${num(T.kcal).toLocaleString('en-GB')} kcal target · ${logged.length}/${n} days logged</div>
      </section>
      ${logged.length ? `<div class="list">${[...logged].reverse().map(x => `
        <button class="item" data-goto="${x.d}"><div><div class="nm">${esc(dayLabel(x.d))}</div>
          <div class="sub tnum">P ${fmt(x.p)} · C ${fmt(x.c)} · F ${fmt(x.f)}</div></div>
          <span class="tnum" style="font-weight:600;color:${x.p >= T.p ? 'var(--good)' : 'inherit'}">${x.kcal.toLocaleString('en-GB')} kcal</span></button>`).join('')}</div>`
        : `<p class="faint" style="text-align:center;padding:20px">Nothing logged in this range yet.</p>`}
    </div>`;

  $$('[data-range]', main).forEach(b => b.onclick = () => { state.range = +b.dataset.range; render(); });
  $$('[data-goto]', main).forEach(b => b.onclick = () => { state.date = b.dataset.goto; setView('today'); });
}

/* ---------- Foods ---------- */

function foodSub(f) {
  const p = f.per100 || {};
  return `${f.brand ? esc(f.brand) + ' · ' : ''}${fmt(p.kcal)} kcal · P ${fmt(p.p)} /100g`;
}

function foodItems(foods, gramsOf) {
  return foods.map((f, i) => `<button class="item" data-food="${esc(f.id)}" data-i="${i}">
    <div><div class="nm">${isFav(f.id) ? '★ ' : ''}${esc(f.name)}</div><div class="sub tnum">${foodSub(f)}</div></div>
    ${gramsOf ? `<span class="faint tnum" style="font-size:13px">${fmt(gramsOf(f, i))} g</span>` : ''}</button>`).join('');
}

function renderFoods() {
  const all = Object.values(store.foods).sort((a, b) => (isFav(b.id) - isFav(a.id)) || a.name.localeCompare(b.name));
  main.innerHTML = `
    <header class="day-nav"><h1>My foods</h1>
      <button class="btn sm ghost" id="new-food">${icon('plus', 'ico-sm')} New</button></header>
    <div class="stack">
      <input class="input" id="food-filter" type="search" placeholder="Filter ${all.length} saved foods" autocomplete="off">
      <div id="food-list">${all.length ? `<div class="list">${foodItems(all)}</div>`
        : `<p class="faint" style="text-align:center;padding:20px">Foods you scan, search or create are saved here.</p>`}</div>
    </div>`;
  $('#new-food', main).onclick = () => openCustomFood(null, { then: 'foods' });
  const bind = () => $$('[data-food]', main).forEach(b => b.onclick = () => openFoodEditor(store.foods[b.dataset.food]));
  bind();
  $('#food-filter', main).oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    const list = all.filter(f => `${f.name} ${f.brand || ''}`.toLowerCase().includes(q));
    $('#food-list', main).innerHTML = list.length ? `<div class="list">${foodItems(list)}</div>` : `<p class="faint" style="padding:12px">No match.</p>`;
    bind();
  };
}

function openFoodEditor(food) {
  if (!food) return;
  const used = store.entries.filter(e => e.foodId === food.id).length;
  openSheet(`
    <div class="sheet-head"><div><h2>${esc(food.name)}</h2><p class="faint">${foodSub(food)} · logged ${used}×</p></div></div>
    <div class="stack">
      <button class="btn" id="fe-log">${icon('plus', 'ico-sm')} Log this food</button>
      <button class="btn ghost" id="fe-edit">${icon('pen', 'ico-sm')} Edit values</button>
      <button class="btn ghost" id="fe-fav">${icon('star', 'ico-sm')} ${isFav(food.id) ? 'Remove from favourites' : 'Add to favourites'}</button>
      <button class="btn danger" id="fe-del">Delete food</button>
      <p class="faint" style="font-size:12.5px;text-align:center">Deleting a food keeps past log entries.</p>
    </div>`);
  $('#fe-log').onclick = () => { ctx.meal = state.date === dayKey() ? defaultMeal() : 'snacks'; openPortion(food); };
  $('#fe-edit').onclick = () => openCustomFood(food, { then: 'foods' });
  $('#fe-fav').onclick = () => { toggleFav(food.id); closeSheet(); render(); };
  $('#fe-del').onclick = () => {
    if (!confirm(`Delete "${food.name}"?`)) return;
    delete store.foods[food.id];
    const i = store.favs.indexOf(food.id);
    if (i >= 0) store.favs.splice(i, 1);
    save();
    closeSheet();
    render();
  };
}

/* ---------- Settings ---------- */

function renderSettings() {
  const T = store.targets, ai = store.ai;
  const prov = PROVIDERS[ai.provider] ? ai.provider : 'gemini';
  main.innerHTML = `
    <header class="day-nav"><h1>Settings</h1></header>
    <div class="stack">
      ${isInstalled() ? '' : `<section class="card stack">
        <h3>Install</h3>
        ${installPrompt ? `<button class="btn" id="install">Install app</button>`
          : `<p class="muted" style="font-size:13.5px">Chrome menu ⋮ → <b>Add to home screen</b> → <b>Install</b>. If it isn't offered yet, tap around the app for 30 seconds and this turns into an Install button.</p>`}
      </section>`}
      <section class="card stack">
        <h3>Daily targets</h3>
        <div class="grid2">
          <label class="field"><span>Calories (kcal)</span><input class="input tnum" inputmode="numeric" data-t="kcal" value="${T.kcal}"></label>
          <label class="field"><span>Protein (g)</span><input class="input tnum" inputmode="numeric" data-t="p" value="${T.p}"></label>
          <label class="field"><span>Carbs (g)</span><input class="input tnum" inputmode="numeric" data-t="c" value="${T.c}"></label>
          <label class="field"><span>Fat (g)</span><input class="input tnum" inputmode="numeric" data-t="f" value="${T.f}"></label>
        </div>
        <p class="faint" style="font-size:12.5px" id="macro-check"></p>
      </section>

      <section class="card stack">
        <h3>AI photo scanning</h3>
        <label class="field"><span>Provider</span>
          <select class="input" id="ai-prov">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === prov ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label class="field"><span>API key</span>
          <input class="input" id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your key" value="${esc(ai.key)}"></label>
        <p class="faint" style="font-size:12.5px;margin-top:-4px" id="key-hint"></p>
        <label class="field" id="ai-url-row" ${prov !== 'custom' ? 'hidden' : ''}><span>Base URL (ends before /chat/completions)</span>
          <input class="input" id="ai-url" autocomplete="off" spellcheck="false" placeholder="https://…/v1" value="${esc(ai.baseUrl)}"></label>
        <label class="field"><span>Model</span>
          <input class="input" id="ai-model" autocomplete="off" spellcheck="false" placeholder="${esc(PROVIDERS[prov].model)}" value="${esc(ai.model === 'gemini-flash-latest' ? '' : ai.model)}"></label>
        <button class="btn ghost" id="ai-test">Test connection</button>
        <div id="ai-result"></div>
        <p class="faint" style="font-size:12.5px">The key stays on this phone only. It is never included in backups. OpenRouter keys: openrouter.ai → Keys. Each photo costs well under 1p.</p>
      </section>

      <section class="card stack">
        <h3>Your data</h3>
        <p class="faint" style="font-size:13px" id="data-stats"></p>
        <div class="grid2">
          <button class="btn ghost" id="export">Export backup</button>
          <button class="btn ghost" id="import">Import backup</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <p class="faint" style="font-size:12.5px" id="persist-note"></p>
      </section>
    </div>`;

  $('#install')?.addEventListener('click', async () => {
    const p = installPrompt;
    if (!p) return;
    installPrompt = null;
    p.prompt();
    try { await p.userChoice; } catch { /* dismissed */ }
    render();
  });

  const check = () => {
    const kc = num(T.p) * 4 + num(T.c) * 4 + num(T.f) * 9;
    $('#macro-check').textContent = `Your macros add up to ${Math.round(kc).toLocaleString('en-GB')} kcal (protein 4, carbs 4, fat 9 per gram).`;
  };
  check();
  $$('[data-t]', main).forEach(inp => inp.onchange = () => {
    store.targets[inp.dataset.t] = Math.round(num(inp.value));
    inp.value = store.targets[inp.dataset.t];
    save(); check(); toast('Targets saved');
  });

  const saveAI = () => {
    store.ai.provider = $('#ai-prov').value;
    store.ai.key = $('#ai-key').value.trim();
    store.ai.baseUrl = $('#ai-url').value.trim();
    store.ai.model = $('#ai-model').value.trim();
    save();
  };
  $('#ai-prov').onchange = () => {
    saveAI();
    $('#ai-url-row').hidden = store.ai.provider !== 'custom';
    $('#ai-model').placeholder = PROVIDERS[store.ai.provider].model;
  };
  ['#ai-key', '#ai-url', '#ai-model'].forEach(s => $(s).onchange = () => { saveAI(); toast('Saved'); });
  const keyHint = () => {
    const raw = $('#ai-key').value, k = raw.trim(), el = $('#key-hint');
    if (!k) { el.textContent = ''; return; }
    const warn = [];
    if (/\s/.test(k)) warn.push('it has a space or line break inside — re-copy it');
    if ($('#ai-prov').value === 'openrouter' && !k.startsWith('sk-or-')) warn.push('OpenRouter keys start with sk-or-');
    if ($('#ai-prov').value === 'openrouter' && k.length < 60) warn.push('looks too short — OpenRouter keys are about 73 characters');
    el.innerHTML = `Key: <b>${esc(k.slice(0, 9))}…${esc(k.slice(-4))}</b> · ${k.length} characters`
      + (warn.length ? `<br><span style="color:var(--kcal)">${esc(warn.join('; '))}</span>` : '');
  };
  keyHint();
  $('#ai-key').addEventListener('input', keyHint);
  $('#ai-prov').addEventListener('change', keyHint);
  $('#ai-test').onclick = async () => {
    saveAI();
    const out = $('#ai-result');
    out.innerHTML = `<div class="note">Testing…</div>`;
    try {
      await testAI(store.ai);
      out.innerHTML = `<div class="note" style="color:var(--good)">Working. Photo scanning is ready.</div>`;
    } catch (e) {
      out.innerHTML = `<div class="note err">${esc(e.message)}</div>`;
    }
  };

  const foodsN = Object.keys(store.foods).length;
  const daysN = new Set(store.entries.map(e => e.date)).size;
  $('#data-stats').textContent = `${store.entries.length} entries across ${daysN} days · ${foodsN} saved foods. Stored on this phone only.`;
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `macros-backup-${dayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm(`Replace everything on this phone with this backup (${data.entries?.length ?? 0} entries)?`)) return;
      replaceAll(data);
      toast('Backup restored');
      render();
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  };
  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then(p => {
      const el = $('#persist-note');
      if (el) el.textContent = p ? 'Storage is protected from automatic clean-up.'
        : 'Tip: install the app to your home screen so the browser keeps your data. Export a backup now and then.';
    }).catch(() => {});
  }
}

/* =========================================================================
   Add flow
   ========================================================================= */

function mealSeg(selected) {
  return `<div class="seg" id="meal-seg">${MEALS.map(m => `<button type="button" data-meal="${m.id}" class="${m.id === selected ? 'on' : ''}">${m.name}</button>`).join('')}</div>`;
}
function bindMealSeg(onPick) {
  $$('#meal-seg [data-meal]', sheetBody).forEach(b => b.onclick = () => {
    $$('#meal-seg [data-meal]', sheetBody).forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.meal);
  });
}

function openAdd(meal) {
  ctx.meal = meal || ctx.meal;
  const favs = favFoods();
  const recent = recentFoods(12);
  const gen = openSheet(`
    <div class="sheet-head"><div><h2>Add food</h2><p class="faint">${esc(dayLabel(state.date))}</p></div></div>
    <div class="stack">
      ${mealSeg(ctx.meal)}
      <div class="tiles">
        <button class="tile" id="t-scan">${icon('barcode')}<b>Scan barcode</b><small>Packaged food</small></button>
        <button class="tile" id="t-meal">${icon('camera')}<b>Photo of meal</b><small>AI estimate</small></button>
        <button class="tile" id="t-label">${icon('label')}<b>Photo of label</b><small>AI reads it exactly</small></button>
        <button class="tile" id="t-quick">${icon('bolt')}<b>Quick add</b><small>Type the numbers</small></button>
      </div>
      <form class="search" id="search-form">
        <input class="input" type="search" id="q" placeholder="Search foods" enterkeyhint="search" autocomplete="off">
        <button class="btn sm" aria-label="Search">${icon('search', 'ico-sm')}</button>
      </form>
      <div id="results"></div>
      ${favs.length ? `<h3>Favourites</h3><div class="list" id="fav-list">${foodItems(favs, f => f.servingG || 100)}</div>` : ''}
      ${recent.length ? `<h3>Recent</h3><div class="list" id="recent-list">${foodItems(recent.map(r => r.food), (f, i) => recent[i].grams ?? f.servingG ?? 100)}</div>` : ''}
      <button class="btn ghost" id="t-custom">${icon('pen', 'ico-sm')} Create a food</button>
    </div>`);

  bindMealSeg(m => { ctx.meal = m; });
  $('#t-scan').onclick = openScanner;
  $('#t-meal').onclick = () => pickPhoto(file => runMealPhoto(file));
  $('#t-label').onclick = () => pickPhoto(file => runLabelPhoto(file, {}));
  $('#t-quick').onclick = () => openQuick();
  $('#t-custom').onclick = () => openCustomFood(null, {});
  $$('#fav-list [data-food]').forEach(b => b.onclick = () => openPortion(store.foods[b.dataset.food]));
  $$('#recent-list [data-food]').forEach(b => b.onclick = () => {
    const r = recent[+b.dataset.i];
    openPortion(r.food, { grams: r.grams });
  });

  let searchSeq = 0;
  $('#search-form').onsubmit = async e => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    $('#q').blur();
    const seq = ++searchSeq;
    const out = $('#results');
    const local = searchLocal(q);
    const localHtml = local.length ? `<h3 style="margin-bottom:8px">Saved</h3><div class="list" id="local-res">${foodItems(local)}</div>` : '';
    out.innerHTML = `${localHtml}<div class="loading" style="padding:14px 0"><div class="spinner"></div><p>Searching Open Food Facts…</p></div>`;
    const bindLocal = () => $$('#local-res [data-food]').forEach(b => b.onclick = () => openPortion(store.foods[b.dataset.food]));
    bindLocal();
    try {
      const found = await searchOFF(q);
      if (!live(gen) || seq !== searchSeq) return;
      out.innerHTML = localHtml + (found.length
        ? `<h3 style="margin:${local.length ? 14 : 0}px 0 8px">Open Food Facts</h3><div class="list" id="off-res">${found.map((f, i) => `
          <button class="item" data-off="${i}"><div><div class="nm">${esc(f.name)}</div><div class="sub tnum">${foodSub(f)}</div></div></button>`).join('')}</div>`
        : `<p class="faint" style="padding:8px 2px">No online results for “${esc(q)}”.</p>`);
      bindLocal();
      $$('#off-res [data-off]').forEach(b => b.onclick = () => {
        const f = found[+b.dataset.off];
        const existing = f.barcode && foodByBarcode(f.barcode);
        openPortion(existing || saveFood(f));
      });
    } catch (err) {
      if (!live(gen) || seq !== searchSeq) return;
      out.innerHTML = localHtml + `<div class="note warn" style="margin-top:${local.length ? 12 : 0}px">${esc(err.message)}</div>`;
      bindLocal();
    }
  };
}

/* ---------- Portion (log a food) ---------- */

function openPortion(food, { grams, entry } = {}) {
  if (!food) { toast('That food no longer exists'); return; }
  let g = num(entry?.grams ?? grams ?? food.servingG ?? 100) || 100;
  let meal = entry?.meal ?? ctx.meal;
  const chips = [...new Set([food.servingG, 50, 100, 150, 200].filter(x => x > 0).map(x => r1(x)))];

  openSheet(`
    <div class="sheet-head">
      <div><h2>${esc(food.name)}</h2><p class="faint">${food.brand ? esc(food.brand) + ' · ' : ''}<span class="badge">${
        { off: 'Open Food Facts', ai: 'AI', manual: 'Custom', label: 'From label' }[food.source] || 'Custom'}</span></p></div>
      <button class="star ${isFav(food.id) ? 'on' : ''}" id="fav" aria-label="Favourite">${icon('star')}</button>
    </div>
    <div class="stack">
      <div class="big-grams"><input class="input tnum" id="grams" inputmode="decimal" value="${g}" aria-label="Grams"><span class="muted">grams</span></div>
      <div class="chips">${chips.map(c => `<button class="chip ${c === g ? 'on' : ''}" data-g="${c}">${c === food.servingG ? `1 serving (${c} g)` : `${c} g`}</button>`).join('')}</div>
      <div class="macros4 tnum" id="preview"></div>
      ${mealSeg(meal)}
      <button class="btn" id="save">${entry ? 'Save changes' : `Add to ${mealName(meal)}`}</button>
      ${entry ? `<button class="btn danger" id="del">Delete entry</button>` : ''}
      <button class="btn ghost" id="edit-food" style="height:42px;font-size:14px">${icon('pen', 'ico-sm')} Edit food values</button>
    </div>`);

  const inp = $('#grams');
  const update = () => {
    const m = macrosFor(food, g);
    $('#preview').innerHTML = `
      <div><b style="color:var(--kcal)">${m.kcal}</b><small>kcal</small></div>
      <div><b style="color:var(--p)">${fmt(m.p)}</b><small>protein</small></div>
      <div><b style="color:var(--c)">${fmt(m.c)}</b><small>carbs</small></div>
      <div><b style="color:var(--f)">${fmt(m.f)}</b><small>fat</small></div>`;
    $$('[data-g]').forEach(c => c.classList.toggle('on', +c.dataset.g === g));
    $('#save').disabled = !(g > 0);
  };
  update();
  inp.oninput = () => { g = num(inp.value); update(); };
  inp.onfocus = () => inp.select();
  $$('[data-g]').forEach(c => c.onclick = () => { g = +c.dataset.g; inp.value = g; update(); });
  bindMealSeg(m => { meal = m; if (!entry) $('#save').textContent = `Add to ${mealName(m)}`; });
  $('#fav').onclick = e => { const on = toggleFav(food.id); e.currentTarget.classList.toggle('on', on); };
  $('#edit-food').onclick = () => openCustomFood(food, { thenPortion: { grams: g, entry } });
  $('#save').onclick = () => {
    if (!(g > 0)) return;
    const m = macrosFor(food, g);
    if (entry) {
      updateEntry(entry.id, { grams: g, meal, name: food.name, ...m });
      toast('Saved');
    } else {
      const created = addEntry({ date: state.date, meal, foodId: food.id, name: food.name, grams: g, ...m });
      ctx.meal = meal;
      toast(`Added ${m.kcal} kcal`, { label: 'Undo', run: () => { deleteEntry(created.id); render(); } });
    }
    closeSheet();
    render();
  };
  if (entry) $('#del').onclick = () => removeEntry(entry);
}

function removeEntry(entry) {
  deleteEntry(entry.id);
  closeSheet();
  render();
  toast('Entry deleted', { label: 'Undo', run: () => { store.entries.push(entry); save(); render(); } });
}

function openEntry(id) {
  const e = store.entries.find(x => x.id === id);
  if (!e) return;
  const food = e.foodId && store.foods[e.foodId];
  if (food && e.grams != null) openPortion(food, { entry: e });
  else openQuick(e);
}

/* ---------- Quick add ---------- */

function openQuick(entry) {
  let meal = entry?.meal ?? ctx.meal;
  openSheet(`
    <div class="sheet-head"><div><h2>${entry ? 'Edit entry' : 'Quick add'}</h2><p class="faint">Type the totals for what you ate</p></div></div>
    <form class="stack" id="qf">
      <label class="field"><span>Name (optional)</span><input class="input" id="q-name" value="${esc(entry?.name ?? '')}" placeholder="e.g. Canteen lunch" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Calories (kcal)</span><input class="input tnum" id="q-kcal" inputmode="decimal" value="${entry ? entry.kcal : ''}"></label>
        <label class="field"><span>Protein (g)</span><input class="input tnum" id="q-p" inputmode="decimal" value="${entry ? entry.p : ''}"></label>
        <label class="field"><span>Carbs (g)</span><input class="input tnum" id="q-c" inputmode="decimal" value="${entry ? entry.c : ''}"></label>
        <label class="field"><span>Fat (g)</span><input class="input tnum" id="q-f" inputmode="decimal" value="${entry ? entry.f : ''}"></label>
      </div>
      <p class="faint" style="font-size:12.5px" id="q-hint">Leave calories empty to work them out from the macros.</p>
      ${mealSeg(meal)}
      <button class="btn" type="submit">${entry ? 'Save changes' : 'Add'}</button>
      ${entry ? `<button class="btn danger" type="button" id="del">Delete entry</button>` : ''}
    </form>`);
  bindMealSeg(m => { meal = m; });
  if (!entry) setTimeout(() => $('#q-kcal')?.focus(), 300);
  $('#qf').onsubmit = ev => {
    ev.preventDefault();
    const p = num($('#q-p').value), c = num($('#q-c').value), f = num($('#q-f').value);
    let kcal = num($('#q-kcal').value);
    if (!kcal) kcal = Math.round(p * 4 + c * 4 + f * 9);
    if (!kcal) { $('#q-hint').innerHTML = '<span style="color:var(--bad)">Enter calories or at least one macro.</span>'; return; }
    const name = $('#q-name').value.trim() || 'Quick add';
    if (entry) {
      updateEntry(entry.id, { name, kcal, p, c, f, meal });
      toast('Saved');
    } else {
      const created = addEntry({ date: state.date, meal, name, grams: null, kcal, p, c, f });
      ctx.meal = meal;
      toast(`Added ${Math.round(kcal)} kcal`, { label: 'Undo', run: () => { deleteEntry(created.id); render(); } });
    }
    closeSheet();
    render();
  };
  if (entry) $('#del').onclick = () => removeEntry(entry);
}

/* ---------- Create / edit a food ---------- */

function openCustomFood(food, { barcode, prefill, note, then, thenPortion } = {}) {
  const src = food || prefill || {};
  const p = src.per100 || {};
  const v = x => (x == null || x === '' ? '' : x);
  openSheet(`
    <div class="sheet-head"><div><h2>${food ? 'Edit food' : 'New food'}</h2><p class="faint">Values per 100 g (or 100 ml)</p></div></div>
    <form class="stack" id="cf">
      ${note ? `<div class="note ${note.kind || ''}">${esc(note.text)}</div>` : ''}
      <label class="field"><span>Name</span><input class="input" id="c-name" required value="${esc(src.name || '')}" autocomplete="off"></label>
      <label class="field"><span>Brand (optional)</span><input class="input" id="c-brand" value="${esc(src.brand || '')}" autocomplete="off"></label>
      <div class="grid2">
        <label class="field"><span>Calories (kcal)</span><input class="input tnum" id="c-kcal" inputmode="decimal" required value="${v(p.kcal)}"></label>
        <label class="field"><span>Protein (g)</span><input class="input tnum" id="c-p" inputmode="decimal" value="${v(p.p)}"></label>
        <label class="field"><span>Carbs (g)</span><input class="input tnum" id="c-c" inputmode="decimal" value="${v(p.c)}"></label>
        <label class="field"><span>Fat (g)</span><input class="input tnum" id="c-f" inputmode="decimal" value="${v(p.f)}"></label>
      </div>
      <label class="field"><span>Serving size in grams (optional)</span><input class="input tnum" id="c-serv" inputmode="decimal" value="${v(src.servingG)}"></label>
      ${(barcode || src.barcode) ? `<p class="faint" style="font-size:12.5px">Barcode ${esc(barcode || src.barcode)} — next scan finds this instantly.</p>` : ''}
      <p id="c-err" style="color:var(--bad);font-size:13px" hidden></p>
      <button class="btn" type="submit">${food ? 'Save' : 'Save and log'}</button>
    </form>`);
  if (!src.name) setTimeout(() => $('#c-name')?.focus(), 300);

  $('#cf').onsubmit = ev => {
    ev.preventDefault();
    const name = $('#c-name').value.trim();
    const kcal = num($('#c-kcal').value);
    const per100 = { kcal, p: num($('#c-p').value), c: num($('#c-c').value), f: num($('#c-f').value) };
    const err = $('#c-err');
    if (!name) { err.textContent = 'Give it a name.'; err.hidden = false; return; }
    if (!kcal && !(per100.p || per100.c || per100.f)) { err.textContent = 'Enter at least the calories.'; err.hidden = false; return; }
    if (!kcal) per100.kcal = r1(per100.p * 4 + per100.c * 4 + per100.f * 9);
    if (per100.kcal > 950) { err.textContent = 'Over 950 kcal per 100 g is not possible — check the number (per 100 g, not per pack).'; err.hidden = false; return; }
    const serv = num($('#c-serv').value);
    const saved = saveFood({
      ...(food || {}),
      ...(prefill?.source ? { source: prefill.source } : {}),
      name, brand: $('#c-brand').value.trim(), per100,
      servingG: serv > 0 ? r1(serv) : null,
      barcode: barcode || src.barcode || null,
      source: food?.source || prefill?.source || 'manual',
    });
    if (then === 'foods') { closeSheet(); render(); toast('Food saved'); return; }
    if (thenPortion) { openPortion(saved, thenPortion); return; }
    openPortion(saved);
  };
}

/* =========================================================================
   Barcode scanner
   ========================================================================= */

async function openScanner() {
  let stream = null, timer = null, stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
  };
  const gen = openSheet(`
    <div class="sheet-head"><div><h2>Scan barcode</h2><p class="faint" id="scan-msg">Starting camera…</p></div></div>
    <div class="stack">
      <div class="scan-box"><video id="scan-video" playsinline muted autoplay></video><div class="frame"></div><div class="laser"></div></div>
      <form class="search" id="code-form">
        <input class="input tnum" id="code" inputmode="numeric" placeholder="Or type the barcode number" autocomplete="off">
        <button class="btn sm">Look up</button>
      </form>
    </div>`, { onClose: stop });

  const msg = t => { const el = $('#scan-msg'); if (el && live(gen)) el.textContent = t; };
  $('#code-form').onsubmit = e => {
    e.preventDefault();
    const code = $('#code').value.replace(/\D/g, '');
    if (code.length < 6) { msg('Barcode numbers are 8 to 14 digits.'); return; }
    stop();
    handleBarcode(code);
  };

  if (!('BarcodeDetector' in window)) {
    msg('This browser cannot scan barcodes — type the number below (Chrome on Android can scan).');
    $('.scan-box').hidden = true;
    return;
  }
  let detector;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supported.includes(f));
    detector = new BarcodeDetector(want.length ? { formats: want } : undefined);
  } catch {
    msg('Barcode scanning is not available — type the number below.');
    $('.scan-box').hidden = true;
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
  } catch (e) {
    if (!live(gen)) return;
    msg(e.name === 'NotAllowedError' ? 'Camera permission denied — allow it in site settings, or type the number.' : 'Could not start the camera — type the number below.');
    $('.scan-box').hidden = true;
    return;
  }
  if (stopped || !live(gen)) { stream.getTracks().forEach(t => t.stop()); return; }
  const video = $('#scan-video');
  video.srcObject = stream;
  try { await video.play(); } catch { /* autoplay attr covers it */ }
  msg('Hold the barcode inside the box');

  const seen = {};
  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        for (const c of codes) {
          const v = (c.rawValue || '').replace(/\D/g, '');
          if (v.length < 8) continue;
          seen[v] = (seen[v] || 0) + 1;
          if (seen[v] >= 2) { // two matching reads = no misreads
            navigator.vibrate?.(40);
            stop();
            handleBarcode(v);
            return;
          }
        }
      }
    } catch { /* frame not ready */ }
    timer = setTimeout(tick, 150);
  };
  tick();
}

async function handleBarcode(code) {
  const local = foodByBarcode(code);
  if (local) { openPortion(local); return; }
  const gen = loadingSheet(`Looking up ${code}…`);
  let food = null, error = null;
  try {
    food = await lookupBarcode(code);
  } catch (e) {
    error = e.message;
  }
  if (!live(gen)) return;
  if (food?.per100) { openPortion(saveFood(food)); return; }

  const title = error ? 'Lookup failed' : food ? 'No nutrition info' : 'Not found';
  const why = error ? error
    : food ? `“${food.name}” is in Open Food Facts but has no nutrition values.`
      : `Barcode ${code} is not in Open Food Facts yet.`;
  openSheet(`
    <div class="sheet-head"><div><h2>${esc(title)}</h2><p class="faint">${esc(why)}</p></div></div>
    <div class="stack">
      <button class="btn" id="nf-label">${icon('label', 'ico-sm')} Photo the nutrition label</button>
      <button class="btn ghost" id="nf-manual">${icon('pen', 'ico-sm')} Type the label values</button>
      ${error ? `<button class="btn ghost" id="nf-retry">Try again</button>` : ''}
      <p class="faint" style="font-size:12.5px;text-align:center">Either way it is saved, so the next scan of this barcode is instant.</p>
    </div>`);
  $('#nf-label').onclick = () => pickPhoto(file => runLabelPhoto(file, { barcode: code, name: food?.name, brand: food?.brand, servingG: food?.servingG }));
  $('#nf-manual').onclick = () => openCustomFood(null, { barcode: code, prefill: { name: food?.name, brand: food?.brand, servingG: food?.servingG } });
  if (error) $('#nf-retry').onclick = () => handleBarcode(code);
}

/* =========================================================================
   Photos + AI
   ========================================================================= */

const photoInput = $('#photo-input');
let photoCb = null;
function pickPhoto(cb) {
  if (!store.ai.key) { aiMissing(); return; }
  photoCb = cb;
  photoInput.value = '';
  photoInput.click();
}
photoInput.addEventListener('change', () => {
  const f = photoInput.files[0];
  const cb = photoCb;
  photoCb = null;
  if (f && cb) cb(f);
});

function aiMissing() {
  openSheet(`
    <div class="sheet-head"><div><h2>AI not set up yet</h2><p class="faint">Photo scanning needs an AI key. Barcodes, search and quick add work without one.</p></div></div>
    <div class="stack">
      <button class="btn" id="go-settings">Open Settings</button>
      <button class="btn ghost" data-close>Not now</button>
    </div>`);
  $('#go-settings').onclick = () => { closeSheet(); setView('settings'); setTimeout(() => $('#ai-key')?.focus(), 350); };
}

async function prepImage(file) {
  try {
    return await shrinkImage(file);
  } catch (e) {
    toast(e.message || 'Could not read that photo');
    return null;
  }
}

function aiErrorSheet(message, retry) {
  openSheet(`
    <div class="sheet-head"><div><h2>Couldn't analyse that</h2></div></div>
    <div class="stack">
      <div class="note err">${esc(message)}</div>
      <button class="btn" id="retry">Try again</button>
      <button class="btn ghost" id="quick">Quick add instead</button>
    </div>`);
  $('#retry').onclick = retry;
  $('#quick').onclick = () => openQuick();
}

async function runMealPhoto(file, img) {
  img = img || await prepImage(file);
  if (!img) return;
  const gen = loadingSheet('Looking at your meal…', img);
  let res;
  try {
    res = await analyseMeal(store.ai, img);
  } catch (e) {
    if (live(gen)) aiErrorSheet(e.message, () => runMealPhoto(file, img));
    return;
  }
  if (!live(gen)) return;
  if (!res.items.length) {
    aiErrorSheet(res.note || 'No food found in that photo.', () => runMealPhoto(file, img));
    return;
  }
  reviewMeal(res, img);
}

function reviewMeal(res, img) {
  let meal = ctx.meal;
  // keep each item's per-gram ratios so editing grams rescales its macros
  const items = res.items.map(it => {
    const g = it.grams > 0 ? it.grams : 100;
    return { ...it, on: true, g, per: { kcal: it.kcal / g, p: it.p / g, c: it.c / g, f: it.f / g } };
  });
  const calc = it => ({ kcal: Math.round(it.per.kcal * it.g), p: r1(it.per.p * it.g), c: r1(it.per.c * it.g), f: r1(it.per.f * it.g) });

  openSheet(`
    <img class="thumb" src="${img}" alt="" style="max-height:150px">
    <div class="sheet-head" style="margin-top:12px"><div><h2>Check the estimate</h2><p class="faint">Fix the grams — portion size is where AI goes wrong most.</p></div></div>
    <div class="stack">
      <div class="list"><div class="ai-item faint" style="padding:8px 12px;font-size:12px"><span></span><span>Food</span><span style="text-align:right">grams</span></div>${items.map((it, i) => `
        <div class="ai-item">
          <input type="checkbox" data-on="${i}" checked aria-label="Include">
          <input class="input" data-name="${i}" value="${esc(it.name)}" aria-label="Name">
          <input class="input tnum" data-grams="${i}" inputmode="decimal" value="${it.g}" aria-label="Grams" style="text-align:right">
          <div class="sub tnum" id="ai-sub-${i}"></div>
        </div>`).join('')}</div>
      ${res.note ? `<div class="note">${esc(res.note)}</div>` : ''}
      <div class="macros4 tnum" id="ai-total"></div>
      ${mealSeg(meal)}
      <button class="btn" id="ai-add"></button>
    </div>`);

  const update = () => {
    const sel = items.filter(it => it.on);
    items.forEach((it, i) => {
      const m = calc(it);
      $(`#ai-sub-${i}`).textContent = `${m.kcal} kcal · P ${fmt(m.p)} · C ${fmt(m.c)} · F ${fmt(m.f)}`;
    });
    const t = totals(sel.map(calc));
    $('#ai-total').innerHTML = `
      <div><b style="color:var(--kcal)">${t.kcal}</b><small>kcal</small></div>
      <div><b style="color:var(--p)">${fmt(t.p)}</b><small>protein</small></div>
      <div><b style="color:var(--c)">${fmt(t.c)}</b><small>carbs</small></div>
      <div><b style="color:var(--f)">${fmt(t.f)}</b><small>fat</small></div>`;
    const btn = $('#ai-add');
    btn.disabled = !sel.length;
    btn.textContent = sel.length ? `Add ${sel.length} item${sel.length > 1 ? 's' : ''} to ${mealName(meal)}` : 'Nothing selected';
  };
  update();
  $$('[data-on]').forEach(cb => cb.onchange = () => { items[+cb.dataset.on].on = cb.checked; update(); });
  $$('[data-grams]').forEach(inp => inp.oninput = () => { items[+inp.dataset.grams].g = num(inp.value); update(); });
  $$('[data-name]').forEach(inp => inp.oninput = () => { items[+inp.dataset.name].name = inp.value; });
  bindMealSeg(m => { meal = m; update(); });

  $('#ai-add').onclick = () => {
    const sel = items.filter(it => it.on && it.g > 0);
    if (!sel.length) return;
    const ids = [];
    for (const it of sel) {
      const food = saveFood({
        name: it.name.trim() || 'Food', brand: '', source: 'ai', servingG: r1(it.g),
        per100: { kcal: it.per.kcal * 100, p: it.per.p * 100, c: it.per.c * 100, f: it.per.f * 100 },
      });
      ids.push(addEntry({ date: state.date, meal, foodId: food.id, name: food.name, grams: it.g, ...calc(it) }).id);
    }
    ctx.meal = meal;
    const kc = totals(sel.map(calc)).kcal;
    closeSheet();
    render();
    toast(`Added ${kc} kcal`, { label: 'Undo', run: () => { ids.forEach(deleteEntry); render(); } });
  };
}

async function runLabelPhoto(file, hint, img) {
  img = img || await prepImage(file);
  if (!img) return;
  const gen = loadingSheet('Reading the label…', img);
  let res;
  try {
    res = await analyseLabel(store.ai, img);
  } catch (e) {
    if (live(gen)) aiErrorSheet(e.message, () => runLabelPhoto(file, hint, img));
    return;
  }
  if (!live(gen)) return;
  openCustomFood(null, {
    barcode: hint.barcode,
    prefill: {
      name: hint.name || res.name, brand: hint.brand || res.brand,
      servingG: res.servingG || hint.servingG, per100: res.per100, source: 'label',
    },
    note: { text: 'Read from your photo — check the numbers against the label, then save.' },
  });
}

/* =========================================================================
   Boot
   ========================================================================= */

// Day rolls over while the app sits open in the background
let lastDay = dayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = dayKey();
  if (now !== lastDay) {
    if (state.date === lastDay) state.date = now;
    lastDay = now;
    if (!sheetOpen) render();
  }
});

// Chrome's install prompt: keep it so Settings can offer an Install button
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  if (state.view === 'settings' && !sheetOpen) render();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Installed — open it from your home screen');
  if (state.view === 'settings') render();
});
const isInstalled = () => !!window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;

navigator.storage?.persist?.().catch(() => {});
render();

// handy for debugging from the console
window.__app = { store, state, render, uid };
