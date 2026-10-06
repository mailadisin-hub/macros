// Drives the real index.html + app.js in jsdom: every view, sheet and flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost:8765/', pretendToBeVisual: true });
const w = dom.window;

// ---- globals the app expects ----
const g = globalThis;
for (const k of ['document', 'history', 'localStorage', 'HTMLElement', 'Image', 'Blob', 'location']) {
  Object.defineProperty(g, k, { value: w[k], configurable: true, writable: true });
}
g.window = w;
w.scrollTo = () => {};
let confirmAnswer = true;
w.confirm = g.confirm = () => confirmAnswer;
const vibes = [];
Object.defineProperty(g, 'navigator', { configurable: true, value: { onLine: true, vibrate: x => vibes.push(x), storage: { persist: async () => true, persisted: async () => true } } });
g.URL.createObjectURL = () => 'blob:x';
g.URL.revokeObjectURL = () => {};
g.createImageBitmap = async () => ({ width: 4000, height: 3000 });
w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
w.HTMLCanvasElement.prototype.toDataURL = function () { return `data:image/jpeg;base64,W${this.width}H${this.height}`; };

// ---- fetch router ----
let routes = [];
const calls = [];
g.fetch = async (url, opts = {}) => {
  calls.push({ url, opts });
  for (const [match, handler] of routes) {
    if (url.includes(match)) {
      const r = await handler(url, opts);
      const [status, body] = Array.isArray(r) ? r : [200, r];
      return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
    }
  }
  throw new TypeError('unrouted fetch ' + url);
};
const aiReply = obj => ({ choices: [{ message: { content: '```json\n' + JSON.stringify(obj) + '\n```' } }] });

await import('../app.js');
const { store, state } = w.__app;

// ---- helpers ----
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function click(sel) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  assert.ok(el, `missing element ${sel}`);
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(5);
}
async function type(sel, val, ev = 'input') {
  const el = $(sel);
  assert.ok(el, `missing input ${sel}`);
  el.value = val;
  el.dispatchEvent(new w.Event(ev, { bubbles: true }));
  await tick(1);
}
async function submit(sel) {
  $(sel).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(5);
}
const sheetOpen = () => $('#sheet').classList.contains('open');
const sheetText = () => $('#sheet-body').textContent.replace(/\s+/g, ' ');
const mainText = () => $('#main').textContent.replace(/\s+/g, ' ');
async function closeSheet() { await click('#scrim'); await tick(20); }
const today = () => w.__app.state.date;
function reset() {
  store.entries.length = 0; store.favs.length = 0;
  for (const k of Object.keys(store.foods)) delete store.foods[k];
  store.ai.key = '';
  routes = []; calls.length = 0;
}
async function pickFile() {
  const inp = $('#photo-input');
  Object.defineProperty(inp, 'files', { configurable: true, value: [{ name: 'p.jpg', type: 'image/jpeg' }] });
  inp.dispatchEvent(new w.Event('change'));
  await tick(20);
}

// =====================================================================

test('boots into Today with empty meals and nav', async () => {
  assert.match(mainText(), /Today/);
  assert.equal($$('.meal').length, 4);
  assert.match(mainText(), /2,500s*kcal left/);
  assert.ok($('[data-day="1"]').disabled, 'cannot go into the future');
});

test('day navigation back, forward, and jump to today', async () => {
  await click('[data-day="-1"]');
  assert.match(mainText(), /Yesterday/);
  await click('[data-day="-1"]');
  assert.doesNotMatch(mainText(), /Yesterday|Today/);
  await click('#day-label');
  assert.match(mainText(), /Today/);
});

test('quick add: computes kcal from macros, adds, undo, edit, delete', async () => {
  reset();
  await click('[data-add="lunch"]');
  assert.ok(sheetOpen());
  assert.match(sheetText(), /Add food/);
  await click('#t-quick');
  assert.match(sheetText(), /Quick add/);
  await submit('#qf');
  assert.match(sheetText(), /Enter calories or at least one macro/, 'validates empty');
  await type('#q-p', '30'); await type('#q-c', '10'); await type('#q-f', '5,5');
  await submit('#qf');
  await tick(20);
  assert.ok(!sheetOpen());
  assert.equal(store.entries.length, 1);
  const e = store.entries[0];
  assert.equal(e.kcal, Math.round(30 * 4 + 10 * 4 + 5.5 * 9));
  assert.equal(e.meal, 'lunch');
  assert.match(mainText(), /Quick add/);
  // undo via toast
  await click('#toast button');
  assert.equal(store.entries.length, 0);
  // add again then edit
  await click('[data-add="dinner"]'); await click('#t-quick');
  await type('#q-name', 'Takeaway'); await type('#q-kcal', '800');
  await submit('#qf'); await tick(20);
  await click('[data-entry]');
  assert.match(sheetText(), /Edit entry/);
  assert.equal($('#q-kcal').value, '800');
  await type('#q-kcal', '850');
  await submit('#qf'); await tick(20);
  assert.equal(store.entries[0].kcal, 850);
  await click('[data-entry]');
  await click('#del'); await tick(20);
  assert.equal(store.entries.length, 0);
  await click('#toast button');
  assert.equal(store.entries.length, 1, 'undo delete restores');
});

test('ring and bars reflect totals and go red when over', async () => {
  reset();
  store.targets.kcal = 2000;
  w.__app.render();
  await click('[data-add="snacks"]'); await click('#t-quick');
  await type('#q-kcal', '2300'); await type('#q-p', '150');
  await submit('#qf'); await tick(20);
  assert.match(mainText(), /300s*kcal over/);
  assert.ok($('.ring circle:nth-child(2)').getAttribute('stroke').includes('bad'));
  store.targets.kcal = 2500;
});

test('barcode: manual entry, live-style found product, portion, chips, add', async () => {
  reset();
  routes.push(['/api/v2/product/5000159461122', () => ({
    status: 1, product: { code: '5000159461122', product_name: 'Snickers', brands: 'Mars', serving_quantity: 50,
      nutriments: { 'energy-kcal_100g': 481, proteins_100g: 8.6, carbohydrates_100g: 60.5, fat_100g: 22.5 } },
  })]);
  await click('#fab');
  await click('#t-scan');
  await tick(10);
  assert.match(sheetText(), /cannot scan barcodes|type the number/, 'no BarcodeDetector in jsdom -> manual fallback');
  await type('#code', '123'); await submit('#code-form');
  assert.match(sheetText(), /8 to 14 digits/);
  await type('#code', '5000159461122'); await submit('#code-form');
  await tick(20);
  assert.match(sheetText(), /Snickers/);
  assert.equal($('#grams').value, '50', 'defaults to serving size');
  assert.match($('#preview').textContent, /241/); // 481 * .5 = 240.5 -> 241
  await click('[data-g="100"]');
  assert.match($('#preview').textContent, /481/);
  await type('#grams', '75');
  assert.match($('#preview').textContent, /361/);
  await click('[data-meal="breakfast"]');
  assert.match($('#save').textContent, /Breakfast/);
  await click('#fav');
  await click('#save'); await tick(20);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].grams, 75);
  assert.equal(store.entries[0].meal, 'breakfast');
  assert.equal(store.favs.length, 1);
  // second scan of same code: no network
  calls.length = 0;
  await click('#fab'); await click('#t-scan'); await tick(10);
  await type('#code', '5000159461122'); await submit('#code-form');
  assert.equal(calls.length, 0, 'cached locally');
  assert.match(sheetText(), /Snickers/);
  await closeSheet();
});

test('barcode not found -> type label values -> saved with barcode -> logs', async () => {
  reset();
  routes.push(['/api/v2/product/', () => ({ status: 0 })]);
  await click('#fab'); await click('#t-scan'); await tick(10);
  await type('#code', '5012345000001'); await submit('#code-form'); await tick(20);
  assert.match(sheetText(), /Not found/);
  await click('#nf-manual');
  assert.match(sheetText(), /New food/);
  assert.match(sheetText(), /5012345000001/);
  await type('#c-name', 'Mystery bar');
  await type('#c-kcal', '2000');
  await submit('#cf');
  assert.match(sheetText(), /Over 950 kcal/, 'catches per-pack mistakes');
  await type('#c-kcal', '400'); await type('#c-p', '20');
  await type('#c-serv', '40');
  await submit('#cf');
  assert.match(sheetText(), /Mystery bar/);
  assert.equal($('#grams').value, '40');
  await click('#save'); await tick(20);
  assert.equal(store.entries[0].kcal, 160);
  const f = Object.values(store.foods)[0];
  assert.equal(f.barcode, '5012345000001');
});

test('barcode lookup network error -> retry offered', async () => {
  reset();
  routes.push(['/api/v2/product/', () => [503, {}]]);
  await click('#fab'); await click('#t-scan'); await tick(10);
  await type('#code', '5000000000001'); await submit('#code-form'); await tick(20);
  assert.match(sheetText(), /Lookup failed/);
  assert.match(sheetText(), /busy \(503\)/);
  assert.ok($('#nf-retry'));
  await closeSheet();
});

test('search: local first, OFF results, OFF down shows warning not crash', async () => {
  reset();
  routes.push(['search.openfoodfacts.org', () => ({ hits: [
    { code: '111', product_name: 'Greek Yogurt', brands: ['Fage'], nutriments: { 'energy-kcal_100g': 97, proteins_100g: 9 } },
    { code: '222', product_name: 'No data yog', nutriments: {} },
  ] })]);
  store.foods.x = { id: 'x', name: 'Greek yogurt homemade', per100: { kcal: 60, p: 10, c: 4, f: 0 }, source: 'manual' };
  await click('#fab');
  await type('#q', 'greek'); await submit('#search-form'); await tick(20);
  assert.match(sheetText(), /Saved/);
  assert.match(sheetText(), /Greek yogurt homemade/);
  assert.match(sheetText(), /Fage/);
  assert.doesNotMatch(sheetText(), /No data yog/, 'drops products without nutrition');
  await click('[data-off="0"]');
  assert.match(sheetText(), /Greek Yogurt/);
  assert.equal($('#grams').value, '100');
  await click('#save'); await tick(20);
  assert.equal(store.entries[0].kcal, 97);
  // both search servers down
  routes = [['openfoodfacts.org', () => [503, {}]]];
  await click('#fab');
  await type('#q', 'greek'); await submit('#search-form'); await tick(20);
  assert.match(sheetText(), /search is down/);
  assert.match(sheetText(), /Greek yogurt homemade/, 'local results still shown');
  await closeSheet();
});

test('recent and favourites appear in add sheet and log with last grams', async () => {
  reset();
  store.foods.o = { id: 'o', name: 'Oats', per100: { kcal: 379, p: 13, c: 60, f: 7 }, servingG: 40, source: 'manual' };
  store.entries.push({ id: 'e1', date: today(), meal: 'breakfast', foodId: 'o', name: 'Oats', grams: 65, kcal: 246, p: 8.5, c: 39, f: 4.6, ts: 1 });
  store.favs.push('o');
  w.__app.render();
  await click('#fab');
  assert.match(sheetText(), /Favourites/);
  assert.match(sheetText(), /Recent/);
  await click('#recent-list [data-food]');
  assert.equal($('#grams').value, '65', 'recent remembers grams');
  await closeSheet();
  await click('#fab');
  await click('#fav-list [data-food]');
  assert.equal($('#grams').value, '40', 'favourite uses serving');
  await closeSheet();
});

test('edit a logged food entry: change grams, edit food values, delete', async () => {
  reset();
  store.foods.o = { id: 'o', name: 'Oats', per100: { kcal: 379, p: 13, c: 60, f: 7 }, servingG: 40, source: 'manual' };
  store.entries.push({ id: 'e1', date: today(), meal: 'breakfast', foodId: 'o', name: 'Oats', grams: 40, kcal: 152, p: 5.2, c: 24, f: 2.8, ts: 1 });
  w.__app.render();
  await click('[data-entry="e1"]');
  assert.match($('#save').textContent, /Save changes/);
  await type('#grams', '80');
  await click('#save'); await tick(20);
  assert.equal(store.entries[0].kcal, 303);
  await click('[data-entry="e1"]');
  await click('#edit-food');
  assert.match(sheetText(), /Edit food/);
  await type('#c-kcal', '400');
  await submit('#cf');
  assert.match(sheetText(), /Save changes/, 'back to the entry');
  assert.equal($('#grams').value, '80');
  await click('#save'); await tick(20);
  assert.equal(store.entries[0].kcal, 320);
  await click('[data-entry="e1"]'); await click('#del'); await tick(20);
  assert.equal(store.entries.length, 0);
});

test('AI photo with no key -> setup prompt -> settings', async () => {
  reset();
  await click('#fab');
  await click('#t-meal');
  assert.match(sheetText(), /AI not set up yet/);
  await click('#go-settings'); await tick(30);
  assert.equal(state.view, 'settings');
  assert.match(mainText(), /AI photo scanning/);
});

test('AI meal photo: shrinks image, review, edit grams, untick, add, undo', async () => {
  reset();
  store.ai.key = 'test-key';
  state.view = 'today'; w.__app.render();
  let sent;
  routes.push(['/chat/completions', (url, opts) => {
    sent = JSON.parse(opts.body);
    return aiReply({ items: [
      { name: 'Chicken breast', grams: 150, kcal: 248, protein: 46.5, carbs: 0, fat: 5.4 },
      { name: 'White rice', grams: 200, kcal: 260, protein: 5.4, carbs: 57, fat: 0.6 },
      { name: 'Broccoli', grams: 80, kcal: 27, protein: 2.2, carbs: 2.2, fat: 0.3 },
    ], note: 'Rice may be under the chicken' });
  }]);
  await click('#fab'); await click('#t-meal'); await pickFile(); await tick(30);
  assert.equal(sent.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,W1280H960', 'downscaled to 1280 long edge');
  assert.match(sheetText(), /Check the estimate/);
  assert.match(sheetText(), /Rice may be under/);
  assert.match($('#ai-total').textContent, /535/);
  await type('[data-grams="1"]', '100');           // halve the rice
  assert.match($('#ai-total').textContent, /405/);
  const cb = $('[data-on="2"]'); cb.checked = false; cb.dispatchEvent(new w.Event('change'));
  await tick(2);
  assert.match($('#ai-add').textContent, /Add 2 items/);
  await type('[data-name="0"]', 'Grilled chicken');
  await click('[data-meal="dinner"]');
  await click('#ai-add'); await tick(20);
  assert.equal(store.entries.length, 2);
  assert.deepEqual(store.entries.map(e => e.name), ['Grilled chicken', 'White rice']);
  assert.equal(store.entries[1].grams, 100);
  assert.equal(store.entries[1].kcal, 130);
  assert.ok(store.entries.every(e => e.meal === 'dinner'));
  assert.equal(Object.values(store.foods).find(f => f.name === 'White rice').per100.kcal, 130);
  await click('#toast button');
  assert.equal(store.entries.length, 0, 'undo removes all items');
});

test('AI errors: bad key, then retry succeeds; empty photo', async () => {
  reset();
  store.ai.key = 'bad';
  let n = 0;
  routes.push(['/chat/completions', () => (n++ === 0
    ? [400, [{ error: { code: 400, message: 'Please pass a valid API key' } }]]
    : aiReply({ items: [{ name: 'Apple', grams: 180, kcal: 94, protein: 0.5, carbs: 25, fat: 0.3 }], note: '' }))]);
  await click('#fab'); await click('#t-meal'); await pickFile(); await tick(30);
  assert.match(sheetText(), /AI key rejected/);
  await click('#retry'); await tick(30);
  assert.equal($('[data-name="0"]').value, 'Apple');
  routes = [['/chat/completions', () => aiReply({ items: [], note: 'No food found' })]];
  await click('#fab'); await click('#t-meal'); await pickFile(); await tick(30);
  assert.match(sheetText(), /No food found/);
  await click('#quick');
  assert.match(sheetText(), /Quick add/);
  await closeSheet();
});

test('closing the sheet mid-AI-call does not pop it back open', async () => {
  reset();
  store.ai.key = 'k';
  let release;
  routes.push(['/chat/completions', () => new Promise(r => { release = () => r(aiReply({ items: [{ name: 'X', grams: 1, kcal: 1 }] })); })]);
  await click('#fab'); await click('#t-meal'); await pickFile(); await tick(10);
  assert.match(sheetText(), /Looking at your meal/);
  await closeSheet();
  release(); await tick(30);
  assert.ok(!sheetOpen(), 'stays closed');
});

test('label photo after failed barcode: prefilled, verified, saved with barcode', async () => {
  reset();
  store.ai.key = 'k';
  routes.push(['/api/v2/product/', () => ({ status: 1, product: { product_name: 'Protein bar', brands: 'Grenade', nutriments: {} } })]);
  routes.push(['/chat/completions', () => aiReply({ name: '', brand: '', kcal: 360, protein: 33, carbs: 30, fat: 12, servingG: 60 })]);
  await click('#fab'); await click('#t-scan'); await tick(10);
  await type('#code', '5060221205000'); await submit('#code-form'); await tick(20);
  assert.match(sheetText(), /No nutrition info/);
  await click('#nf-label'); await pickFile(); await tick(30);
  assert.match(sheetText(), /check the numbers/);
  assert.equal($('#c-name').value, 'Protein bar');
  assert.equal($('#c-brand').value, 'Grenade');
  assert.equal($('#c-kcal').value, '360');
  assert.equal($('#c-serv').value, '60');
  await submit('#cf');
  assert.equal($('#grams').value, '60');
  await click('#save'); await tick(20);
  assert.equal(store.entries[0].kcal, 216);
  const f = Object.values(store.foods)[0];
  assert.equal(f.barcode, '5060221205000');
  assert.equal(f.source, 'label');
});

test('History: stats, streak, ranges, tap day goes to Today', async () => {
  reset();
  store.targets.p = 150;
  const d = n => w.__app.state.date && (() => { const x = new Date(); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
  for (const [n, kcal, p] of [[1, 2400, 160], [2, 2600, 155], [3, 2200, 100], [10, 2000, 170]]) {
    store.entries.push({ id: 'h' + n, date: d(n), meal: 'lunch', name: 'x', grams: null, kcal, p, c: 0, f: 0, ts: n });
  }
  await click('[data-view="history"]');
  assert.match(mainText(), /History/);
  assert.match(mainText(), /2,400s*avg kcal/);
  assert.match(mainText(), /2s*protein streak/);
  assert.match(mainText(), /3\/7 days logged/);
  assert.equal($$('.chart rect').length, 7);
  await click('[data-range="30"]');
  assert.equal($$('.chart rect').length, 30);
  assert.match(mainText(), /4\/30 days logged/);
  await click('[data-goto]');
  assert.equal(state.view, 'today');
  assert.match(mainText(), /Yesterday/);
  await click('#day-label');
});

test('Foods tab: list, filter, favourite, log, edit, delete keeps history', async () => {
  reset();
  store.foods.a = { id: 'a', name: 'Apple', per100: { kcal: 52, p: 0.3, c: 14, f: 0.2 }, source: 'manual' };
  store.foods.b = { id: 'b', name: 'Banana', per100: { kcal: 89, p: 1.1, c: 23, f: 0.3 }, source: 'manual' };
  store.entries.push({ id: 'e', date: today(), meal: 'snacks', foodId: 'b', name: 'Banana', grams: 120, kcal: 107, p: 1.3, c: 27.6, f: 0.4, ts: 1 });
  await click('[data-view="foods"]');
  assert.equal($$('[data-food]').length, 2);
  await type('#food-filter', 'ban');
  assert.equal($$('[data-food]').length, 1);
  await click('[data-food="b"]');
  assert.match(sheetText(), /logged 1×/);
  await click('#fe-fav'); await tick(20);
  assert.ok(store.favs.includes('b'));
  await click('[data-food="b"]'); await click('#fe-log');
  assert.match(sheetText(), /Banana/);
  await closeSheet();
  await click('[data-food="b"]'); await click('#fe-edit');
  await type('#c-name', 'Banana (large)'); await submit('#cf'); await tick(20);
  assert.equal(store.foods.b.name, 'Banana (large)');
  await click('[data-food="b"]'); await click('#fe-del'); await tick(20);
  assert.ok(!store.foods.b);
  assert.ok(!store.favs.includes('b'));
  assert.equal(store.entries.length, 1, 'entry kept');
  await click('#new-food');
  await type('#c-name', 'Skyr'); await type('#c-kcal', '63');
  await submit('#cf'); await tick(20);
  assert.match(mainText(), /Skyr/);
  // tapping an entry whose food was deleted still opens (as quick edit)
  await click('[data-view="today"]');
  await click('[data-entry="e"]');
  assert.match(sheetText(), /Edit entry/);
  await closeSheet();
});

test('Settings: targets save, provider switch, AI test, export strips key', async () => {
  reset();
  await click('[data-view="settings"]');
  const kc = $('[data-t="kcal"]'); kc.value = '2200'; kc.dispatchEvent(new w.Event('change'));
  assert.equal(store.targets.kcal, 2200);
  assert.match(mainText(), /add up to/);
  assert.ok($('#ai-url-row').hidden, 'gemini hides base URL');
  const sel = $('#ai-prov'); sel.value = 'custom'; sel.dispatchEvent(new w.Event('change'));
  assert.ok(!$('#ai-url-row').hidden);
  await type('#ai-url', 'https://token-plan.example/v1', 'change');
  await type('#ai-key', 'abc', 'change');
  routes.push(['token-plan.example/v1/chat/completions', () => aiReply({ ok: true })]);
  await click('#ai-test'); await tick(20);
  assert.match(mainText(), /Working/);
  assert.equal(store.ai.provider, 'custom');
  sel.value = 'gemini'; sel.dispatchEvent(new w.Event('change'));
  routes = [['/chat/completions', () => [404, { error: { message: 'model gemini-x not found' } }]]];
  await click('#ai-test'); await tick(20);
  assert.match(mainText(), /model/i);
  let blobText;
  const RealBlob = g.Blob;
  g.Blob = class { constructor(parts) { blobText = parts.join(''); } };
  await click('#export');
  g.Blob = RealBlob;
  assert.ok(blobText.includes('"entries"'));
  assert.ok(!blobText.includes('"abc"'), 'key not exported');
  store.targets.kcal = 2500;
});

test('Android back button closes the sheet', async () => {
  await click('[data-view="today"]');
  await click('#fab');
  assert.ok(sheetOpen());
  w.history.back();
  await tick(50);
  assert.ok(!sheetOpen());
});

test('XSS: product names from the internet are escaped', async () => {
  reset();
  store.entries.push({ id: 'x', date: today(), meal: 'lunch', name: '<img src=x onerror=alert(1)>', grams: null, kcal: 1, p: 0, c: 0, f: 0, ts: 1 });
  w.__app.render();
  assert.equal($$('#main img').length, 0);
  assert.match(mainText(), /<img src=x/);
});

test('everything persisted to localStorage', async () => {
  await click('[data-add="lunch"]'); await click('#t-quick'); await type('#q-kcal', '100'); await submit('#qf'); await tick(20);
  const saved = JSON.parse(w.localStorage.getItem('macros.v1'));
  assert.ok(saved.entries.length >= 1);
  assert.ok(saved.targets.kcal);
});
