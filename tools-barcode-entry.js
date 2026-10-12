// Bundled to vendor/barcode-detector.js by `npm run vendor`. Self-hosted so the app never
// depends on a CDN: the WASM decoder is served from vendor/ next to it.
export { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
