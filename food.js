/* =========================================================================
   Food data — Open Food Facts (barcodes, search) and the AI vision calls.
   AI uses the OpenAI-compatible chat endpoint, which both Gemini and
   MiMo expose, so one code path serves either provider.
   ========================================================================= */

import { num, r1 } from './store.js';

const OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_quantity,serving_size';

export const PROVIDERS = {
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-3.8-flash' },
  custom: { label: 'Other (OpenAI-compatible, e.g. MiMo)', baseUrl: '', model: 'mimo-v2.6-flash' },
};

/* ---------- fetch with timeout ---------- */

async function fetchT(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out — check your connection');
    if (!navigator.onLine) throw new Error('You are offline');
    throw new Error('Network error — ' + e.message);
  } finally {
    clearTimeout(t);
  }
}

/* ---------- Open Food Facts ---------- */

const pick = (...xs) => xs.find(x => typeof x === 'string' && x.trim())?.trim() || '';
const brandStr = b => (Array.isArray(b) ? b[0] : String(b || '').split(',')[0]).trim();

/** Turn an OFF product (v2 or search-a-licious hit) into our food shape. per100 is null if nutrition is missing. */
export function fromOFF(p, code) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy-kj_100g'] != null) kcal = n['energy-kj_100g'] / 4.184;
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184; // energy_100g is kJ
  const has = kcal != null && Number.isFinite(Number(kcal));
  const serving = num(p.serving_quantity);
  return {
    name: pick(p.product_name_en, p.product_name) || 'Unnamed product',
    brand: brandStr(p.brands),
    barcode: String(p.code || code || ''),
    servingG: serving > 0 && serving < 2000 ? r1(serving) : null,
    source: 'off',
    per100: has ? {
      kcal: r1(kcal), p: r1(num(n.proteins_100g)),
      c: r1(num(n.carbohydrates_100g)), f: r1(num(n.fat_100g)),
    } : null,
  };
}

/** Returns a food, or null if the code is not in the database. per100 may be null (found, but no nutrition). */
export async function lookupBarcode(code) {
  const res = await fetchT(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts is busy (${res.status}) — try again in a minute`);
  const j = await res.json();
  if (j.status !== 1 || !j.product) return null;
  return fromOFF(j.product, code);
}

/** Text search. Tries the new search service, then the legacy one. Throws if both are down. */
export async function searchOFF(q) {
  const urls = [
    [`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=20&langs=en&fields=${OFF_FIELDS}`, j => j.hits],
    [`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=20&fields=${OFF_FIELDS}`, j => j.products],
  ];
  let lastErr;
  for (const [url, get] of urls) {
    try {
      const res = await fetchT(url, {}, 10000);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const list = get(await res.json()) || [];
      return list.map(p => fromOFF(p)).filter(f => f.per100);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('Online search is down right now (' + (lastErr?.message || 'unknown') + '). Scan the barcode or snap the label instead.');
}

/* ---------- images ---------- */

/** Downscale a photo to a JPEG data URL so uploads are small and fast. */
export async function shrinkImage(file, max = 1280) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch {
    src = await new Promise((ok, bad) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => bad(new Error('Could not read that image'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

/* ---------- AI ---------- */

const MEAL_PROMPT = `You are a careful nutrition estimator. Look at this photo of food.
List every distinct food or drink you can see. For each one, estimate the portion weight in grams and the nutrition for THAT portion.
Use plates, cutlery, hands and packaging for scale. Assume typical UK recipes and products. Do not invent items you cannot see.
Reply with JSON only, no other text, in exactly this shape:
{"items":[{"name":"string","grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number}],"note":"one short sentence on anything uncertain"}
If there is no food in the photo, reply {"items":[],"note":"No food found"}.`;

const LABEL_PROMPT = `This is a photo of a food nutrition label (and maybe the packaging).
Read the values PER 100 g (or per 100 ml). If the label only gives per-serving values, convert them to per 100 g using the stated serving size.
Energy must be in kcal (convert from kJ by dividing by 4.184 if only kJ is shown).
Reply with JSON only, no other text, in exactly this shape:
{"name":"product name if visible, else empty string","brand":"brand if visible, else empty string","kcal":number,"protein":number,"carbs":number,"fat":number,"servingG":number or null}
If you cannot read a nutrition label, reply {"error":"short reason"}.`;

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function parseJSON(text) {
  if (typeof text !== 'string') throw new Error('Empty reply from AI');
  const t = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw new Error('AI reply was not readable — try again');
}

function aiConfig(ai) {
  const prov = PROVIDERS[ai.provider] || PROVIDERS.gemini;
  const baseUrl = (prov.baseUrl || ai.baseUrl || '').replace(/\/+$/, '');
  const model = (ai.model || prov.model).trim();
  if (!ai.key) throw new Error('No AI key yet — add it in Settings');
  if (!baseUrl) throw new Error('No base URL set — add it in Settings');
  return { baseUrl, model, key: ai.key.trim() };
}

function errorText(j, status) {
  const e = Array.isArray(j) ? j[0]?.error : j?.error;
  const msg = ((typeof e === 'string' ? e : e?.message) || '').slice(0, 200);
  const said = msg ? ` (server said: “${msg}”)` : '';
  if (status === 402) return `No credit left on the AI account — add credit, then try again${said}`;
  if (status === 401 || /api key/i.test(msg)) return `AI key rejected — check it was copied in full${said}`;
  if (status === 403) return `AI request refused${said}`;
  if (status === 429) return `AI rate limit hit — wait a minute and try again${said}`;
  if (status === 404 || /model/i.test(msg)) return `AI model problem — check the model name in Settings${said}`;
  return `AI error ${status}${said}`;
}

/** One chat call. content is a string or an OpenAI content array. Returns the reply text. */
export async function chat(ai, content, ms = 60000) {
  const cfg = aiConfig(ai);
  const res = await fetchT(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content }], temperature: 0.2 }),
  }, ms);
  let j = null;
  try { j = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(errorText(j, res.status));
  const text = j?.choices?.[0]?.message?.content;
  if (Array.isArray(text)) return text.map(p => p.text || '').join('');
  return text;
}

const imagePart = dataUrl => ({ type: 'image_url', image_url: { url: dataUrl } });

export async function analyseMeal(ai, dataUrl) {
  const j = parseJSON(await chat(ai, [{ type: 'text', text: MEAL_PROMPT }, imagePart(dataUrl)]));
  const items = (Array.isArray(j.items) ? j.items : [])
    .map(it => ({
      name: String(it.name || 'Food').slice(0, 80),
      grams: r1(num(it.grams)),
      kcal: Math.round(num(it.kcal)),
      p: r1(num(it.protein ?? it.p)),
      c: r1(num(it.carbs ?? it.c)),
      f: r1(num(it.fat ?? it.f)),
    }))
    .filter(it => it.kcal > 0 || it.grams > 0);
  return { items, note: typeof j.note === 'string' ? j.note : '' };
}

export async function analyseLabel(ai, dataUrl) {
  const j = parseJSON(await chat(ai, [{ type: 'text', text: LABEL_PROMPT }, imagePart(dataUrl)]));
  if (j.error) throw new Error('Could not read the label: ' + j.error);
  const sv = num(j.servingG);
  return {
    name: String(j.name || '').slice(0, 80),
    brand: String(j.brand || '').slice(0, 60),
    servingG: sv > 0 ? r1(sv) : null,
    per100: { kcal: r1(num(j.kcal)), p: r1(num(j.protein)), c: r1(num(j.carbs)), f: r1(num(j.fat)) },
  };
}

/** Cheap check that the key, URL and model all work. */
export async function testAI(ai) {
  const text = await chat(ai, 'Reply with exactly this JSON and nothing else: {"ok":true}', 30000);
  const j = parseJSON(text);
  if (j.ok !== true) throw new Error('Unexpected reply: ' + String(text).slice(0, 80));
  return true;
}
