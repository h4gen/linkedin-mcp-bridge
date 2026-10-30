# Chrome Web Store graphics

Superseded: this concept was rejected. Use the capability-led promotional graphics in `../graphics-v2/` for the current delivery.

English graphics for LinkedIn MCP Bridge BETA, created 2026-10-30.
Open `index.html` for the full visual review. The ZIP contains only upload-ready PNGs.

| Store field | File | Dimensions |
| --- | --- | --- |
| Marquee promotional image | `upload/promo-marquee-1400x560.png` | 1400 × 560 |
| Small promotional image | `upload/promo-small-440x280.png` | 440 × 280 |
| Screenshot 1 — connection | `upload/screenshot-01-connect-1280x800.png` | 1280 × 800 |
| Screenshot 2 — data flow | `upload/screenshot-02-data-flow-1280x800.png` | 1280 × 800 |
| Screenshot 3 — controls | `upload/screenshot-03-controls-1280x800.png` | 1280 × 800 |
| Existing extension icon | `upload/icon-128.png` | 128 × 128 |

Dimensions follow the [Chrome Web Store image specifications](https://developer.chrome.com/docs/webstore/images), checked 2026-10-30. Promo and screenshot exports are opaque RGB PNGs; the existing icon retains transparency. The promotional images intentionally contain no text so they work across locales. The icon is a copy of the existing product icon, not a new identity.

## Provenance and accuracy

The two promotional illustrations were generated with the built-in `image_gen` tool. Exact prompts are preserved in `prompts.json`, and full-resolution originals are in `source/`. The small tile uses the marquee as a visual reference. Export processing only resizes/crops the promotional art.

Screenshot artwork combines editorial copy with captures rendered from the actual `assets/popup.html` and `assets/ui.css`. The popup script is omitted to prevent account operations; the status uses the exact disconnected-state string from `src/extension/popup.ts`. These are deterministic UI renders, not live account captures. No private account information or invented conversations appear. Screenshot 3 places two actual UI section crops together. Its controls do not imply a per-action approval queue: writes execute directly, as stated in the artwork.

The captures are reproduced by `render.mjs`, and the resulting standalone HTML sources are retained for each composition. There is no change to the extension UI or runtime. This asset delivery does not submit the extension or imply store approval. Publishing prerequisites remain governed by `store/release.json` and the release gate.

## Reproduce

Use Node.js with `playwright` and `sharp` available through normal resolution or `NODE_PATH`, plus Playwright Chromium:

```sh
node store/graphics/render.mjs
zip -j store/graphics/linkedin-connector-webstore.zip store/graphics/upload/*.png
```

The renderer validates dimensions for all six upload files. Review text, crops and current feature claims again if the product UI changes. The gallery and original captures are supporting files, not extra store upload slots.
