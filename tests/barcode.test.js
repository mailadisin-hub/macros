// Real decode through the vendored scanner (same files the app serves), fully offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const wasmPath = fileURLToPath(new URL('../vendor/zxing_reader.wasm', import.meta.url));
// Browser built-ins the scanner returns results in; every browser and Android WebView has them.
globalThis.DOMRectReadOnly ??= class DOMRectReadOnly {
  constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }); }
  static fromRect(r = {}) { return new DOMRectReadOnly(r.x, r.y, r.width, r.height); }
};
globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { this.data = data; this.width = width; this.height = height; this.colorSpace = 'srgb'; }
};

/** Pixels of a real EAN-13 symbol, with optional blur-ish grey noise. */
function ean13Pixels(code, scale = 3, noise = 0) {
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  const PAR = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PAR[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += '101';
  const w = (bits.length + 24) * scale, h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = Math.floor(x / scale) - 12;
    let v = (m >= 0 && m < bits.length && bits[m] === '1' && y > 10 && y < h - 10) ? 20 : 235;
    v = Math.max(0, Math.min(255, v + (rnd() - 0.5) * noise));
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return new ImageData(data, w, h);
}

const { BarcodeDetector, prepareZXingModule } = await import('../vendor/barcode-detector.js');
// Node's fetch can't read file:// URLs, so hand Emscripten the bytes of the same vendored WASM directly.
const { readFileSync } = await import('node:fs');
prepareZXingModule({ overrides: { wasmBinary: readFileSync(wasmPath) } });

test('vendored scanner reads real EAN-13 barcodes offline', async () => {
  const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
  for (const code of ['5000159461122', '4006381333931', '0012345678905']) {
    const r = await det.detect(ean13Pixels(code));
    assert.equal(r[0]?.rawValue, code, `decoded ${code}`);
    assert.equal(r[0]?.format, 'ean_13');
  }
});

test('copes with a noisy camera-like image', async () => {
  const det = new BarcodeDetector({ formats: ['ean_13'] });
  const r = await det.detect(ean13Pixels('5000159461122', 3, 40));
  assert.equal(r[0]?.rawValue, '5000159461122');
});

test('blank frame returns nothing instead of throwing', async () => {
  const det = new BarcodeDetector({ formats: ['ean_13'] });
  const blank = new ImageData(new Uint8ClampedArray(200 * 100 * 4).fill(255), 200, 100);
  assert.deepEqual(await det.detect(blank), []);
});
