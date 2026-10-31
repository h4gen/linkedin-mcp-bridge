# LinkedIn MCP – AI Connector for Claude & Codex

32 primitive LinkedIn tools for local AI agents: inbox and message history, people research, invitations, feed interactions, native text drafts and scheduling. The agent composes these tools; this project does not implement workflows, a CRM or an inbox index.

**0.7.0 — Chrome Web Store draft; live acceptance pending.** Installation from Git supports macOS and native Windows with Google Chrome and Node.js 22+. Both platforms pass CI, including native registration, process round-trips and an isolated Chromium/native-messaging smoke test. Live LinkedIn checks were performed on macOS. Linux/WSL and direct web-chat connections are outside this release.

LinkedIn credentials stay in Chrome. Requested content goes to your selected MCP client and may go to its AI provider. No hosted relay or product telemetry. Writes execute directly after target and idempotency checks; there is no extension approval queue.

## Install from Git (for agents)

Repository: https://github.com/h4gen/linkedin-mcp-bridge

1. Check `git --version`, `node --version` (22+) and `npm --version`. Use native Windows Node with native Windows Chrome, not WSL.
2. Clone into a durable directory; do not delete or move it after setup:

```sh
git clone https://github.com/h4gen/linkedin-mcp-bridge.git
cd linkedin-mcp-bridge
npm ci
npm run build:store
```

3. Install the Chrome Web Store extension once its link is published here. During development, use `chrome://extensions` → Developer mode → Load unpacked → `dist/extension`, then copy its ID.
4. Register the native host as the current user:

```sh
node dist/cli.js install
```

The assigned Store ID is `pibhcinkiadfplcaefllaeappkpnpfjm`; the store build uses it by default. The Store listing is currently a draft and is not yet publicly installable. To override the ID for testing, use `node dist/cli.js install EXTENSION_ID`. The installer prints absolute paths and ready-to-use `mcpServers.linkedin` JSON. Configure your local client's stdio MCP server using that output. Do not guess executable paths. No elevated privileges or notarized package is needed. 5. Open LinkedIn in Chrome, open the extension, acknowledge the data flow and connect the tab. Then check:

```sh
node dist/cli.js doctor
```

The server command is the printed absolute Node path; arguments are the printed absolute `dist/cli.js` path followed by `mcp`. For a TOML-configured client, put these same values under `[mcp_servers.linkedin]` as `command` and `args`.

One Chrome profile owns the connection at a time. Browser authentication is interactive; the agent must not bypass login. While Chrome is running, the bridge recreates a lost work tab on the next request and verifies the saved account. DOM tools may bring the dedicated work tab forward. Pause stops new work; reconnect to resume.

### Update and uninstall

Run `git pull --ff-only`, `npm ci`, `npm run build:store`, then `node dist/cli.js install`. Restart the MCP client to load the updated server and run `doctor`. Compatible extension updates preserve the saved connection and any explicit pause; they do not require another Connect click. Extension and native host versions must match; retain the matching Git release when Chrome has not received the new extension yet.

`node dist/cli.js uninstall` removes this installation's native registration and launcher. Remove the Chrome extension separately to clear browser storage. The checkout can then be removed.

For development, `npm run build` selects the development native host; use the generated extension with that same build. `npm run build:store` selects the separate store host. Never mix the two builds.

## Agent usage

Read MCP server instructions and `health` first. Use returned account and target IDs, inspect coverage and continue bounded pagination. For inbox prioritization, combine conversation pages with selected message histories. For contact context, combine profile reads with relevant conversations. These are examples of composition, not built-in workflows.

`conversations_search` matches participant/title/preview, not message-body history. The agent can read histories ad hoc. Summaries, follow-up reasoning and notes belong to the agent or the user's existing systems.

See [0.7 primitive contracts and migration](docs/primitives-0.7.md) for compact read responses, text windows, exact relationship/conversation lookup and scoped comment replies. Existing MCP processes must restart to discover the five new tools; the browser connection stays bound.

## Tools

All names have a `linkedin_` prefix. First call `health`, then supply its `account_urn` to every account operation.

| Area        | Tools                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox       | `conversations_list`, `conversations_search`, `conversations_get`, `conversations_find`, `messages_list`, `message_get`, `message_send`, `conversation_update`, `conversation_delete` |
| People      | `profile_get`, `profile_posts_list`, `relationship_get`, `people_search`, `invitations_list`, `invitation_send`, `invitation_respond`, `invitation_withdraw`                          |
| Feed        | `feed_list`, `posts_search`, `post_get`, `post_like`, `post_comment`, `comments_list`                                                                                                 |
| Planning    | `post_draft_create`, `post_schedule`, `scheduled_posts_list`, `scheduled_post_cancel`                                                                                                 |
| GTM         | `people_search_filters`, `reactions_list`, `post_resolve`                                                                                                                             |
| Diagnostics | `health`, `operation_get`                                                                                                                                                             |

Lists default to 20, max 50. LinkedIn Inbox requests are capped at 20 per backend page because live requests for 50 return an unusable response; use the cursor to continue. Pass the returned opaque `next_cursor` as `cursor` with the **same arguments**. Cursors expire after 30 minutes, are bound to account, filters and operation, and reset with the browser session. Lists are live, not immutable snapshots. Deduplicate by entity URN when traversing a changing inbox. `conversations_search` searches participant/title/preview content in each fetched page; follow its cursor to search older pages. It is not full historical message search.

Inbox/history reads use HTTP only and never intentionally open a conversation or mark it read. Attachment metadata can appear in normalized read results; uploading or downloading attachment content is not implemented.

### Native drafts and scheduling

`post_create` has been removed. `post_draft_create` saves a personal text-only post as a native LinkedIn draft and verifies it by reopening it. It refuses to replace any existing draft. `post_schedule` schedules text in LinkedIn using an ISO `scheduled_at` with explicit timezone, whole-minute precision, at least ten minutes and at most three months ahead. LinkedIn owns the schedule; no local background publisher is installed.

`scheduled_posts_list` returns native scheduled posts with account-bound `scheduled_ref` values. Pass one to `scheduled_post_cancel` to remove exactly the matching text/time entry. Unknown layouts, ambiguous entries and mismatched accounts fail closed. Planning currently targets the observed English LinkedIn composer. Scheduling does not fall back to immediate publication.

Planning receipts expose `outcome`: `draft_saved`, `scheduled`, or `schedule_cancelled`. Unknown outcomes can be reconciled with `operation_get` or the original key, without repeating the mutation. Schedule references contain hashes and timestamps, not post bodies, and expire seven days after the scheduled time on the next operation. Clear local data removes them immediately.

### Writes and uncertain results

Every write requires `idempotency_key`. Use the same key for a retry of the same operation; changing its payload produces `idempotency_conflict`. Receipts survive service-worker/native-host restarts for seven days. After seven days a key is no longer protected: check LinkedIn before replaying an old action.

`message_send` requires either `conversation_urn` or `recipient_urn`, plus exact `expected_participant_urns` excluding yourself. Existing-conversation validation first checks an exact conversation entity in the history response, then traverses Inbox, Archive and Spam within the operation deadline. It fails closed if participants cannot be verified. There is no fixed 260-thread limit. New recipient sends require one exact profile URN. Group replies use the exact participant set; group creation is excluded.

Writes execute immediately through the connected account. There is no extension review queue or per-operation approval. `operation_get` reads persisted execution receipts, and the same key replays the receipt without dispatching again. Live acceptance is reported separately from availability.

Statuses:

- `confirmed`: a created entity receipt or verified DOM state was observed.
- `unknown_outcome`: the action may have happened. Do not submit a new key or switch adapters. Inspect LinkedIn or use `operation_get`.
- `failed_before_dispatch`: no mutation was dispatched, although a read/precondition failed.

`operation_get` can reconcile an uncertain existing-thread message if its origin token appears in bounded older-history traversal. No matching token is **not** proof of non-delivery. Read/unread and archive/unarchive changes also get a bounded list-based state check after dispatch. Other uncertain operations remain uncertain until checked in LinkedIn. HTTP success without an identifiable receipt/state is deliberately not reported as verified success.

Calls serialize across MCP clients in the extension. HTTP requests have at least one second spacing and a 15-second fetch timeout. Queued calls expire after 60 seconds. Cancellation prevents queued work and checks before dispatch; an in-flight browser operation may finish and its receipt remains available. No automatic write retries or HTTP-to-DOM mutation fallbacks. An explicit same-key call may retry a recorded `failed_before_dispatch` after fresh target checks. Receipts include `dispatch_state`, `attempt_count`, and up to ten prior attempt summaries. Legacy DOM failures are recoverable only when the original pre-click failure and the still-present exact target can be verified; other unknown outcomes remain non-retryable.

### DOM operation boundaries

The DOM adapter uses only packaged operations, exact target URNs, unique visible controls and English/German labels. It never accepts caller-supplied selectors or scripts. `post_resolve` accepts only validated LinkedIn post URLs. A missing/ambiguous target fails rather than clicking an unrelated control.

Feed pagination is a bounded live scroll. `post_resolve` resolves a rendered card's `scan_key` through its scoped control menu and binds its exact identity to that card. A share ID is not advertised as a verified public permalink. Read reactions/comments on the resolved card; if no matching card exists, post reads navigate only the work tab when a supported activity location or observed permalink is available. No arbitrary navigation URL is accepted.

`comments_list` expands comments/replies and returns bounded, deduplicated pages with author profiles and truncation indicators. `reactions_list` opens only the selected post's visible reaction dialog and retains that dialog for cursor continuation. Both remain partial because LinkedIn may rank or omit entries. Reply parent IDs are supplied only when the DOM establishes the relationship.

`people_search` supports `filters.connection_degrees` (`1`, `2`, `3`), `location_ids` and `company_ids`. `people_search_filters` takes `kind: location|company` and a name query to resolve numeric values through LinkedIn's public typeahead. No Sales Navigator requests are made.

Collection jobs were removed in 0.3. Use direct cursor pages. DOM reads use a dedicated LinkedIn work tab and bring it forward to avoid background timer throttling. Navigating or clicking controls in that tab invalidates its traversal cursor; API reads do not. A consumed cursor replays its cached page. Session cursors expire after 30 minutes and share a 5 MiB storage budget. See [interface contract](docs/interface-patterns.md).

The registry exposes all 32 operations in development and pilot builds. `health` reports current-build acceptance separately from availability. `store:check` requires current-runtime evidence for every capability and the publishing prerequisites; acceptance does not gate individual calls.

## Development and packaging

```sh
npm run typecheck
npm test                 # builds actual bundles before testing
npm run package          # dist/linkedin-extension.zip
```

Tests cover strict tool boundaries, native framing/fragmentation, actual MCP stdio registration, actual MV3 bundle startup, installer isolation, native/socket roundtrip, account and recipient mismatches, opaque cursor binding, mutation persistence and ambiguous outcomes. No live writes occur during tests.

`dist/linkedin-extension.zip` is the extension upload artifact. Store listing, privacy notice and reviewer instructions are in `store/`. `npm run release:check` validates the local build; `npm run store:check` separately checks the store ID, screenshots, privacy URL and runtime-bound acceptance. No signed companion is required.

Remove the local host using `node dist/cli.js uninstall`. Remove the Chrome extension separately to erase its local data. Receipts contain payload hashes, target/account IDs, operation IDs, timestamps and statuses, not message bodies. Reads are transient MCP responses, not an inbox database. As with other local MCP tools, clients on the same OS account are trusted; other OS users cannot access the private socket directory.

## Release checks

`npm run check` runs type checking and automated tests with simulated writes. CI runs on macOS and Windows. `npm run package` builds the development extension ZIP; `npm run package:store` builds the store-channel ZIP.

`npm run release:check` checks local build consistency. `npm run store:check` additionally requires a clean source tree, real store ID, public privacy URL, UI screenshots and runtime-bound capability/installation evidence. Passing automated tests does not claim live LinkedIn acceptance. The runtime fingerprint includes source, assets, dependencies and build scripts; documentation-only commits do not invalidate it.

See [validation](docs/validation.md) for historical live checks and current limitations. The release metadata deliberately reports missing external publication requirements rather than fabricating them.

## Market research

[Market report, 30 October 2026](docs/research/2026-10-30/linkedin-market-research.docx) is historical research. The current product scope is primitive tools, Git installation and a public Chrome extension; report recommendations are not implementation requirements.

Connection recovery is automatic after work-tab loss, worker restarts and brief native-host interruptions. Chrome must be running; an expired LinkedIn login or a changed account still needs attention. `doctor` exits nonzero when the connection is unusable. Health reports the specific session/tab error; transport failures report `native_host_unavailable`. A dispatched write is never replayed automatically after a disconnect.
