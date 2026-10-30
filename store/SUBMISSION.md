# Local Chrome Web Store submission kit — 0.6.0

Prepared locally only. No store entry was created and nothing was submitted.

- Extension: build with `npm run package:store`; upload `dist/linkedin-extension.zip`.
- Listing copy and permission explanations: `store/listing.md`.
- Public privacy policy: https://github.com/h4gen/linkedin-mcp-bridge/blob/main/store/privacy.md
- Repository and installation: https://github.com/h4gen/linkedin-mcp-bridge
- Support: https://github.com/h4gen/linkedin-mcp-bridge/issues
- Reviewer installation/test instructions: `store/reviewer.md`.
- Actual popup screenshots: `store/screenshots/connection-1280x800.png` and `store/screenshots/data-controls-1280x800.png`.
- Promotional art: `store/graphics-v2/upload/promo-small-440x280.png` and `promo-marquee-1400x560.png`.
- Icon: `assets/icon128.png`.
- Visibility: public. Platforms: macOS and native Windows. Separate Git-installed Node server required.

When an entry is created later, record its assigned ID in `store/release.json`, rebuild both server and extension, and verify the exact native-host binding. Before that, development installation requires an explicit extension ID. The ZIP does not install the local server.

`npm run release:check` validates local build consistency. `npm run store:check` separately checks submission prerequisites and runtime-bound acceptance. Missing store ID or live acceptance must not be represented as successful store readiness. No website, notarized companion or hosted relay is required.
