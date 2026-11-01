# Human setup and settings — 0.8.0

The extension has one setup/settings page. It opens once on installation and is reused by the toolbar button and Chrome extension options. The default screen offers a client selection and one copy action. Once connected, it shows the account and readiness; controls remain inside Settings. The consent checkbox and Connect step are removed.

The copied prompt identifies the exact release, channel and actual extension ID. A local Codex or Claude Code agent follows [INSTALL_AGENT.md](INSTALL_AGENT.md), installs into a durable versioned directory, and configures only the selected client. The human does not need shell commands, JSON or an extension-ID lookup. The repository-first route checks `published_version` before promising a Store installation. It remains null while the Store listing is a draft.

Initial binding waits for a matching native-host handshake and verifies the signed-in account. Login recovery and concurrent setup checks share one reconciliation. Existing account binding, deliberate pause/disconnect and operation receipts survive updates. Choosing a different signed-in account remains explicit. Clear-data remains an advanced destructive control; ordinary repair does not clear storage. All 32 public tool contracts are retained.

## Verification on 2026-11-01

Runtime source: `6602cc8cf18755bfd3f73e710dc7d85a91f5a12a`, immutable Git ref `v0.8.0`. Fingerprint: `c5bfc285ad493953ee54bf4eef395b1bc146f36e0fa19723853fac7647ddb164`.

- **258 tests in 25 files pass**, including all previous 249 tests. Typecheck, formatting and local release consistency pass.
- Real built-background tests cover fresh install, one setup tab, auto-binding, expired login, account change, parallel checks, disconnect during setup, worker restart, version mismatch, pause/disconnect migration and DOM-cursor invalidation. The old bundle failed the new onboarding regressions before implementation.
- Real built HTML/JS/CSS passes clipboard checks for both clients, ready/paused/login/account-change states, keyboard focus, 360px width and 200% zoom.
- [macOS and Windows CI](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41300259974) passes the complete suite, native install/reinstall/conflict/uninstall protection, native process round-trips, actual Chromium native handshake, UI smoke and packaging. These browser tests use synthetic health; they do not claim a signed-in Windows LinkedIn session.
- The installed macOS development extension was reloaded to 0.8.0. Its existing account automatically returned to Ready without a Connect click. Doctor returned connected with 32 capabilities.
- **Codex CLI 0.166.0-alpha.5.1 performed the installation from the copied instructions**, with the explicitly supplied candidate commit. It cloned the public repository into a durable per-user directory, built it, registered the actual paths, verified other MCP settings, and read the inbox. A second, freshly launched Codex process verified the durable registration and successfully called the actual `linkedin_health` and `linkedin_conversations_list` tools. It reported version 0.8.0, 32 tools and one returned conversation. This is actual client acceptance, separate from SDK tests.
- **Claude Code 2.1.63:** the real CLI passed isolated user-scope add/get/remove checks with the actual path and an unrelated entry preserved. The genuine agent-install attempt failed before executing any step because Anthropic returned HTTP 401, “OAuth access token has expired.” Agent-driven installation and a live tool call in Claude remain pending a renewed login. CLI configuration success is not presented as that missing proof.

Private client traces and screenshots stay in ignored `artifacts/setup-0.8.0/`. Public documentation contains no conversation exports. All LinkedIn activity was read-only: no messages, invitations, reactions, comments, posts or read-status changes.

## Store and remaining acceptance

A pilot-channel ZIP is prepared locally under `artifacts/store-0.8.0/`. The five accepted gallery explainers, promo art and icons are unchanged; listing, privacy and reviewer instructions now describe automatic setup. No Store submission or publication occurred.

The current local acceptance manifest credits health, inbox listing and the two CI installation platforms. The unchanged Store gate reports 30 capabilities still lacking live evidence for this exact fingerprint. Historical proofs remain historical. Separately, the real Claude-agent test needs renewed authentication, Windows client-driven live acceptance has not been performed, and the public Store-first path cannot be completed before Store availability. These limits do not prevent using the verified local development setup.
