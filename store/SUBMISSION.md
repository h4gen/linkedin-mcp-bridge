# Chrome Web Store draft — 0.8.0 setup redesign

Historical listing refresh: the listing copy and four of the five explainer graphics were updated locally on 2026-11-01 to reflect the 0.7.2 capability set. This is a targeted refresh of the existing positioning and visual style, not a new product direction. The title, publishing graphic, icon and both promo tiles are unchanged. The portal update is pending: the existing Store session expired and Google now requires the account owner's passkey. No new package upload, submission or publication has been performed. The last verified portal package remains the 0.6.0 draft; the previous 0.7.0 upload was unconfirmed after renewed sign-in.

Historical local package (0.7.1, not the current release): `artifacts/store-0.7.1/linkedin-extension.zip`, SHA-256 `5da2854c2f0f99b63d1b3ea0b69792a63657092807886a806bd647fd8aa19fb9`. Pilot-channel build metadata and `store-check.json` are alongside it. Historical runtime fingerprint: `e426d1d858b43ef34703c9c49618929191f34cfd06af780441ecc382d6230a78`.

Historical 0.7.2 runtime fingerprint: `2e2b5e2093b0f2319f448cc5e43e9f738fa7fce103889cbec4df60526fc28eb0`. Its acceptance manifest credits ten read/diagnostic capabilities and both installation platforms; the remaining capabilities still need current-runtime evidence for submission. The broader 0.7.1 acceptance remains historical. This content refresh changes no executable code and performs no LinkedIn writes. See `docs/validation.md` and `docs/repairs-0.7.2.md` for the exact acceptance scope.

- Draft: https://chrome.google.com/webstore/devconsole/ca8c63eb-664b-4353-ac7c-af776311ddff/pibhcinkiadfplcaefllaeappkpnpfjm/edit
- Assigned extension ID: `pibhcinkiadfplcaefllaeappkpnpfjm`.
- Listing language: English; category: Productivity / Tools.
- Distribution: free, public, all regions (applies after publication).
- Previously saved: description, icon, five explainer graphics, both promo tiles, homepage/support links, permission justifications, privacy URL and reviewer setup instructions. The 2026-11-01 replacement description and gallery are local until the passkey-gated portal save is verified.
- Declared data: personally identifiable information, personal communications, website content. No remote executable code.

- Extension: build with `npm run package:store`; upload `dist/linkedin-extension.zip`.
- Listing copy and permission explanations: `store/listing.md`.
- Public privacy policy: https://github.com/h4gen/linkedin-mcp-bridge/blob/main/store/privacy.md
- Repository and installation: https://github.com/h4gen/linkedin-mcp-bridge
- Support: https://github.com/h4gen/linkedin-mcp-bridge/issues
- Reviewer installation/test instructions: `store/reviewer.md`.
- Five Store gallery explainers in upload order: inbox, feed, people, research (relationships) and publishing in `store/explainers/upload/`. The first four are refreshed; publishing is unchanged. These are illustrated capability explanations, not literal UI captures.
- Promotional art: `store/graphics-v2/upload/promo-small-440x280.png` and `promo-marquee-1400x560.png`.
- Icon: `assets/icon128.png`.
- Visibility: public. Platforms: macOS and native Windows. Separate Git-installed Node server required.

The assigned ID is recorded in `store/release.json` and used by store builds. Development installation still requires its own explicit extension ID. The ZIP does not install the local server. Assigning the Store ID changes the runtime fingerprint; previous live evidence is retained with its original fingerprint and is not relabeled. Fresh runtime-bound acceptance remains required before release.

`npm run release:check` validates local build consistency. `npm run store:check` separately checks submission prerequisites and runtime-bound acceptance. Missing store ID or live acceptance must not be represented as successful store readiness. No website, notarized companion or hosted relay is required.

## Search positioning

Store title: LinkedIn MCP – AI Connector for Claude & Codex. The 2026-10-30 market report prioritizes “linkedin mcp” and “linkedin mcp server”; Claude connection intent is also evidenced. Codex names a supported local client, not a measured keyword-volume claim. Inbox management stays the entry point; post research, people/context, relationship-aware reconnection and text planning explain the broader value. No direct ChatGPT-web integration is claimed. Historical research retains the original product name.

## 2026-11-01 content refresh

| Story                 | Updated scope                                                                   | Claim boundary                                                                        |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Inbox                 | Find chats by person, read long messages, reply with context                    | Search uses participants/title/preview; no all-message full-text index                |
| Posts and discussions | Search by topic/date; read text, comments and reactions; open returned profiles | Available pages only; no complete discussion-tree or lead-list promise                |
| People                | Read profile sections and author posts before a conversation                    | Available source context; no inferred need or automatic lead score                    |
| Relationships         | Check connections/pending invitations and find earlier personal chats           | Unknown states remain possible; no always-on monitoring or built-in outreach sequence |
| Publishing            | Native text drafts, scheduling and cancellation                                 | Existing graphic retained; no immediate-publish tool                                  |

The existing ivory/navy/cobalt art direction is preserved. Exact built-in image_gen edit prompts are in `store/explainers/refresh-0.7.2-prompts.json`. All five upload PNGs remain 1280 × 800 RGB. The summary and description in `store/listing.md` are ready to paste; permission and single-purpose fields are separate from public description copy. After sign-in, save only the listing draft and replacement gallery, verify the persisted content/order, and do not submit for review as part of this refresh.

## Current execution and acceptance contract

Version 0.8.0 replaces the popup with one setup/settings page, copied agent installation instructions and automatic first connection. Deliberate pause/disconnect is retained across updates. Store availability is explicitly `published_version: null` until publication is verified. Current-runtime acceptance credits health, inbox listing and both CI installation platforms; 30 capability proofs remain pending. Historical 0.7.x proofs are not reused. The five gallery explainers remain unchanged by this UI increment.

Version 0.8.0 exposes 32 composable primitives. Writes execute directly with account checks, exact target validation, idempotency and persisted operation receipts. There is no extension approval queue or review page. Unknown dispatched writes are never automatically repeated. Messaging uses the dedicated messaging API with exact conversation identities, not the feed chat overlay. Post creation supports native drafts and scheduling; there is no immediate publish tool.

Public-facing acceptance content must be meaningful and specific to its actual context, as required by the repository's `AGENTS.md`. Authorized temporary comments and likes must be removed or reversed after verification. Private evidence stays in ignored local artifacts.

Current capability and macOS/Windows installation evidence must match the executable runtime fingerprint. Historical successful writes are preserved with their actual fingerprints and do not make a later runtime submission-ready. `npm run store:check` remains the submission gate; preparing or uploading a draft does not bypass it. See `docs/validation.md` and `docs/primitives-0.7.md` for implementation and live-acceptance scope.

## Prepared 0.8.0 package

Local pilot ZIP: `artifacts/store-0.8.0/linkedin-extension.zip`, SHA-256 `35299f0fcd33ffa13f771572067407217792101bac8c1172217f7656080e0269`. Runtime source/ref: `6602cc8cf18755bfd3f73e710dc7d85a91f5a12a` / `v0.8.0`; fingerprint `c5bfc285ad493953ee54bf4eef395b1bc146f36e0fa19723853fac7647ddb164`. Build metadata and the unchanged Store gate result are alongside the ZIP. The package was built separately so the active local development extension remained on its development channel. No portal upload, submission or publication was performed. See `docs/onboarding-0.8.md` for the exact client and platform acceptance limits.
