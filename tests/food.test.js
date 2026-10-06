import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const realFetch = globalThis.fetch;
const F = await import('../food.js');

const ai = { provider: 'gemini', key: 'k', model: '', baseUrl: '' };
function mockFetch(status, body, check) {
  globalThis.fetch = async (url, opts) => {
    check?.(url, opts);
    return { ok: status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) };
  };
}
const reply = text => ({ choices: [{ message: { content: text } }] });

test('fromOFF: kcal, kJ fallback, missing nutrition, brands array', () => {
  const a = F.fromOFF({ code: '1', product_name: 'Snickers', brands: 'Mars, Snickers', serving_quantity: 50,
    nutriments: { 'energy-kcal_100g': 481, proteins_100g: 8.6, carbohydrates_100g: 60.5, fat_100g: 22.5 } });
  assert.deepEqual(a.per100, { kcal: 481, p: 8.6, c: 60.5, f: 22.5 });
  assert.equal(a.brand, 'Mars'); assert.equal(a.servingG, 50);
  const b = F.fromOFF({ product_name: 'X', nutriments: { energy_100g: 418.4 } }, '9');
  assert.equal(b.per100.kcal, 100); assert.equal(b.barcode, '9');
  assert.equal(F.fromOFF({ product_name: '', nutriments: {} }).per100, null);
  assert.equal(F.fromOFF({ brands: ['Chobani'], nutriments: {} }).brand, 'Chobani');
  assert.equal(F.fromOFF({ nutriments: {} }).name, 'Unnamed product');
});

test('parseJSON tolerates fences and chatter', () => {
  assert.deepEqual(F.parseJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(F.parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(F.parseJSON('Sure! Here: {"a":{"b":2}} hope that helps'), { a: { b: 2 } });
  assert.throws(() => F.parseJSON('nope'));
  assert.throws(() => F.parseJSON(undefined));
});

test('analyseMeal sends image to Gemini compat endpoint and normalises', async () => {
  mockFetch(200, reply('```json\n{"items":[{"name":"Chicken breast","grams":"150","kcal":248,"protein":46.5,"carbs":0,"fat":5.4},{"name":"ghost","grams":0,"kcal":0}],"note":"rice hidden"}\n```'),
    (url, opts) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      assert.equal(opts.headers.Authorization, 'Bearer k');
      const b = JSON.parse(opts.body);
      assert.equal(b.model, 'gemini-3.8-flash');
      assert.equal(b.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAA');
    });
  const r = await F.analyseMeal(ai, 'data:image/jpeg;base64,AAA');
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], { name: 'Chicken breast', grams: 150, kcal: 248, p: 46.5, c: 0, f: 5.4 });
  assert.equal(r.note, 'rice hidden');
});

test('analyseLabel + label error', async () => {
  mockFetch(200, reply('{"name":"Oats","brand":"Tesco","kcal":379,"protein":13,"carbs":60,"fat":7,"servingG":40}'));
  const r = await F.analyseLabel(ai, 'data:x');
  assert.deepEqual(r.per100, { kcal: 379, p: 13, c: 60, f: 7 });
  assert.equal(r.servingG, 40);
  mockFetch(200, reply('{"error":"blurry"}'));
  await assert.rejects(F.analyseLabel(ai, 'data:x'), /blurry/);
});

test('custom provider uses its base URL; errors are human', async () => {
  mockFetch(200, reply('{"ok":true}'), url => assert.equal(url, 'https://x.example/v1/chat/completions'));
  assert.equal(await F.testAI({ provider: 'custom', key: 'k', model: 'mimo-v2.6-flash', baseUrl: 'https://x.example/v1/' }), true);
  mockFetch(400, [{ error: { code: 400, message: 'Please pass a valid API key' } }]);
  await assert.rejects(F.testAI(ai), /key rejected/);
  mockFetch(429, { error: { message: 'quota' } });
  await assert.rejects(F.testAI(ai), /rate limit/);
  await assert.rejects(F.testAI({ ...ai, key: '' }), /No AI key/);
  await assert.rejects(F.testAI({ provider: 'custom', key: 'k', baseUrl: '' }), /base URL/);
});

test('lookupBarcode against live Open Food Facts', async () => {
  globalThis.fetch = realFetch;
  const f = await F.lookupBarcode('5000159461122');
  assert.equal(f.name, 'Snickers');
  assert.equal(f.per100.kcal, 481);
  assert.equal(await F.lookupBarcode('0000000000017'), null);
});
