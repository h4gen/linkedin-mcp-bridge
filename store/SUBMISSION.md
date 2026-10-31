# Chrome Web Store draft — 0.7.1

The 0.7.1 package is prepared locally only. No portal upload, submission or publication was performed in this repair increment. The last verified portal state remains the 0.6.0 draft; the previous 0.7.0 upload was unconfirmed after Google requested renewed sign-in. The existing listing and five explainers remain unchanged.

Local package: `artifacts/store-0.7.1/linkedin-extension.zip`, SHA-256 `5da2854c2f0f99b63d1b3ea0b69792a63657092807886a806bd647fd8aa19fb9`. Pilot-channel build metadata and `store-check.json` are alongside it. Runtime fingerprint: `e426d1d858b43ef34703c9c49618929191f34cfd06af780441ecc382d6230a78`.

All 21 read/diagnostic capabilities and macOS/Windows installation prerequisites have current matching-runtime evidence. Submission remains blocked by eleven missing current-runtime write capability proofs; this increment intentionally performs no live writes. Historical dispatch proofs retain their original fingerprints. See `docs/validation.md` and `docs/repairs-0.7.1.md` for the exact repair and acceptance scope.

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
- Five Store gallery explainers remain unchanged: inbox, research, people, feed and publishing in `store/explainers/upload/`. These are illustrated capability explanations, not literal UI captures.
- Promotional art: `store/graphics-v2/upload/promo-small-440x280.png` and `promo-marquee-1400x560.png`.
- Icon: `assets/icon128.png`.
- Visibility: public. Platforms: macOS and native Windows. Separate Git-installed Node server required.

The assigned ID is recorded in `store/release.json` and used by store builds. Development installation still requires its own explicit extension ID. The ZIP does not install the local server. Assigning the Store ID changes the runtime fingerprint; previous live evidence is retained with its original fingerprint and is not relabeled. Fresh runtime-bound acceptance remains required before release.

`npm run release:check` validates local build consistency. `npm run store:check` separately checks submission prerequisites and runtime-bound acceptance. Missing store ID or live acceptance must not be represented as successful store readiness. No website, notarized companion or hosted relay is required.

## Search positioning

Store title: LinkedIn MCP – AI Connector for Claude & Codex. The 2026-10-30 market report prioritizes “linkedin mcp” and “linkedin mcp server”; Claude connection intent is also evidenced. Codex names a supported local client, not a measured keyword-volume claim. Inbox management, people research and post scheduling describe enabled capabilities in the summary and description. No direct ChatGPT-web integration is claimed. Historical research retains the original product name.

## Current execution and acceptance contract

Version 0.7.1 exposes 32 composable primitives. Writes execute directly with account checks, exact target validation, idempotency and persisted operation receipts. There is no extension approval queue or review page. Unknown dispatched writes are never automatically repeated. Messaging uses the dedicated messaging API with exact conversation identities, not the feed chat overlay. Post creation supports native drafts and scheduling; there is no immediate publish tool.

Public-facing acceptance content must be meaningful and specific to its actual context, as required by the repository's `AGENTS.md`. Authorized temporary comments and likes must be removed or reversed after verification. Private evidence stays in ignored local artifacts.

Current capability and macOS/Windows installation evidence must match the executable runtime fingerprint. Historical successful writes are preserved with their actual fingerprints and do not make a later runtime submission-ready. `npm run store:check` remains the submission gate; preparing or uploading a draft does not bypass it. See `docs/validation.md` and `docs/primitives-0.7.md` for implementation and live-acceptance scope.
