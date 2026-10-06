# Macros

Personal calorie and protein counter. Phone-only PWA, data stays on the phone.

- **Barcode scan:** Open Food Facts lookup, cached locally after the first scan
- **Photo of meal:** AI estimates each item; you fix the grams before saving
- **Photo of label:** AI reads per-100 g values; you check them, then they are saved against the barcode
- **Search:** your saved foods first, then Open Food Facts (their search servers are often down, so it fails gracefully)
- **Quick add:** type totals; kcal is worked out from macros if left empty
- History (7/30 days, protein streak), favourites, recents, backup export/import

## Files

| File | What |
|---|---|
| `index.html` | Markup and all CSS |
| `app.js` | Views, bottom sheet, every flow |
| `store.js` | localStorage data and macro maths |
| `food.js` | Open Food Facts and AI calls (OpenAI-compatible: Gemini or MiMo) |
| `sw.js` | Offline app shell |

## AI setup

Settings → AI photo scanning.
- **Gemini (free):** key from aistudio.google.com. Default model `gemini-3.8-flash`.
- **MiMo:** pick "Other", base URL from the Token Plan page, model `mimo-v2.6-flash`.

Press **Test connection**.

## Run / test

```bash
python -m http.server 8765
```

```bash
npm test
```

There are 31 tests: store logic, the AI and Open Food Facts layer (one live barcode lookup), and the full UI driven in jsdom.

The camera needs HTTPS (or localhost), so on the phone use the GitHub Pages URL.

## Rename

The name appears in `index.html` (`<title>` and the `apple-mobile-web-app-title` meta), `manifest.json`, and the backup filename in `app.js`.
