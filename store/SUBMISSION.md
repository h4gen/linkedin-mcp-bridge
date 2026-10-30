# Chrome Web Store draft — 0.6.0

Saved in the Chrome Web Store Developer Dashboard on 2026-10-30. Status: Draft. Nothing submitted for review or published.

- Draft: https://chrome.google.com/webstore/devconsole/ca8c63eb-664b-4353-ac7c-af776311ddff/pibhcinkiadfplcaefllaeappkpnpfjm/edit
- Assigned extension ID: `pibhcinkiadfplcaefllaeappkpnpfjm`.
- Listing language: English; category: Productivity / Tools.
- Distribution: free, public, all regions (applies after publication).
- Saved: description, icon, five explainer graphics, both promo tiles, homepage/support links, permission justifications, privacy URL and reviewer setup instructions.
- Declared data: personally identifiable information, personal communications, website content. No remote executable code.

- Extension: build with `npm run package:store`; upload `dist/linkedin-extension.zip`.
- Listing copy and permission explanations: `store/listing.md`.
- Public privacy policy: https://github.com/h4gen/linkedin-mcp-bridge/blob/main/store/privacy.md
- Repository and installation: https://github.com/h4gen/linkedin-mcp-bridge
- Support: https://github.com/h4gen/linkedin-mcp-bridge/issues
- Reviewer installation/test instructions: `store/reviewer.md`.
- Store gallery explainers: `store/explainers/upload/inbox-1280x800.png` and `store/explainers/upload/research-1280x800.png`. These are illustrated capability explanations, not literal UI captures.
- Promotional art: `store/graphics-v2/upload/promo-small-440x280.png` and `promo-marquee-1400x560.png`.
- Icon: `assets/icon128.png`.
- Visibility: public. Platforms: macOS and native Windows. Separate Git-installed Node server required.

The assigned ID is recorded in `store/release.json` and used by store builds. Development installation still requires its own explicit extension ID. The ZIP does not install the local server. Assigning the Store ID changes the runtime fingerprint; previous live evidence is retained with its original fingerprint and is not relabeled. Fresh runtime-bound acceptance remains required before release.

`npm run release:check` validates local build consistency. `npm run store:check` separately checks submission prerequisites and runtime-bound acceptance. Missing store ID or live acceptance must not be represented as successful store readiness. No website, notarized companion or hosted relay is required.

## Search positioning

Store title: LinkedIn MCP – AI Connector for Claude & Codex. The 2026-10-30 market report prioritizes “linkedin mcp” and “linkedin mcp server”; Claude connection intent is also evidenced. Codex names a supported local client, not a measured keyword-volume claim. Inbox management, people research and post scheduling describe enabled capabilities in the summary and description. No direct ChatGPT-web integration is claimed. Historical research retains the original product name.
