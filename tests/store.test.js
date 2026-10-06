import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
};

const S = await import('../store.js');

test('dates', () => {
  assert.equal(S.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(S.addDays('2024-12-31', 1), '2025-01-01');
  assert.equal(S.dayKey(new Date(2026, 9, 6)), '2026-10-06');
});

test('num parsing', () => {
  assert.equal(S.num('12,5'), 12.5);
  assert.equal(S.num('abc'), 0);
  assert.equal(S.num(-3), 0);
  assert.equal(S.num(undefined), 0);
});

test('food, macros, entries, totals', () => {
  const f = S.saveFood({ name: 'Oats', per100: { kcal: 379, p: 13.2, c: 60, f: 7 }, servingG: 40, barcode: '123' });
  assert.ok(f.id);
  assert.deepEqual(S.macrosFor(f, 40), { kcal: 152, p: 5.3, c: 24, f: 2.8 });
  assert.equal(S.foodByBarcode('123').id, f.id);
  const m = S.macrosFor(f, 40);
  S.addEntry({ date: '2026-10-06', meal: 'breakfast', foodId: f.id, name: f.name, grams: 40, ...m });
  S.addEntry({ date: '2026-10-06', meal: 'snacks', name: 'Quick', grams: null, kcal: 200, p: 20, c: 10, f: 5 });
  S.addEntry({ date: '2026-10-05', meal: 'lunch', name: 'Other day', kcal: 999 });
  const day = S.entriesFor('2026-10-06');
  assert.equal(day.length, 2);
  assert.deepEqual(S.totals(day), { kcal: 352, p: 25.3, c: 34, f: 7.8 });
  assert.equal(S.recentFoods()[0].food.id, f.id);
  assert.equal(S.searchLocal('oat').length, 1);
  assert.equal(S.toggleFav(f.id), true);
  assert.equal(S.isFav(f.id), true);
  assert.equal(S.toggleFav(f.id), false);
  S.updateEntry(day[1].id, { kcal: '250' });
  assert.equal(S.entriesFor('2026-10-06')[1].kcal, 250);
  S.deleteEntry(day[1].id);
  assert.equal(S.entriesFor('2026-10-06').length, 1);
  assert.ok(JSON.parse(mem['macros.v1']).entries.length === 2, 'persisted');
});

test('export strips key, import validates and keeps key', () => {
  S.store.ai.key = 'SECRET';
  const out = S.exportData();
  assert.equal(out.ai.key, '');
  assert.throws(() => S.replaceAll({ nope: 1 }));
  S.replaceAll(out);
  assert.equal(S.store.ai.key, 'SECRET');
  assert.equal(S.store.entries.length, 2);
});
