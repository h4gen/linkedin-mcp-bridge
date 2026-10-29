# LinkedIn MCP Bridge

A separate macOS-first MCP server and Chrome MV3 extension. The local Node process communicates with the extension through Chrome Native Messaging and a private Unix socket. LinkedIn session credentials stay in the browser. No hosted relay, remote scripts, background inbox indexing or telemetry.

**Development candidate 0.4.0 — not submitted to the Chrome Web Store.** All 24 operations are available. Writes execute directly after account, target and idempotency checks, without extension confirmation. Inbox/history, filtered people search, feed identity resolution and paginated reaction/comment reads have live checks; see [validation](docs/validation.md). The pilot includes a separate bundled macOS companion and a release gate that fails until publishing prerequisites and acceptance are complete.

## Install locally

Requires macOS, Node.js 22+ and Chrome 120+.

```sh
npm ci
npm run check
```

1. Open `chrome://extensions`, enable developer mode, choose **Load unpacked**, and select this repository's `dist/extension` directory.
2. Copy the new extension's ID. Do not use the existing Browser Bridge extension ID.
3. Register the native host with that exact ID:

```sh
node dist/cli.js install YOUR_EXTENSION_ID
```

4. Open LinkedIn, sign in, and choose **Connect this tab** in the new extension popup. It binds to that tab and account. Keep the connected tab open.
5. Check the complete connection:

```sh
node dist/cli.js doctor
```

Pause blocks new work. Connect again to resume. Disconnect removes the account binding and native connection; already dispatched writes cannot be recalled. A rate limit or access challenge imposes a persistent cooldown; resolve any challenge in LinkedIn itself.

The host manifest is `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.hagen.linkedin_mcp_bridge.json`. Its launcher uses absolute paths to this checkout and the current Node executable. Keep both available; rerun `install` after moving the repository or replacing Node. Only one Chrome profile may own the host at a time. Existing Google Ads / Browser Bridge installations are untouched.

## Configure an MCP client

For a local stdio-compatible client, use the absolute paths reported by your shell:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/linkedin-mcp-bridge/dist/cli.js", "mcp"]
    }
  }
}
```

Codex's equivalent server configuration:

```toml
[mcp_servers.linkedin]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/linkedin-mcp-bridge/dist/cli.js", "mcp"]
```

This is local stdio: it does not directly connect the ChatGPT or Claude websites. The authorized local installation also registered the `linkedin` server in Codex. The examples above document setup on another machine. [Official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp#configure-with-the-cli).

## Tools

All names have a `linkedin_` prefix. First call `health`, then supply its `account_urn` to every account operation.

| Area        | Tools                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inbox       | `conversations_list`, `conversations_search`, `conversations_get`, `messages_list`, `message_send`, `conversation_update`, `conversation_delete` |
| People      | `profile_get`, `people_search`, `invitations_list`, `invitation_send`, `invitation_respond`, `invitation_withdraw`                               |
| Feed        | `feed_list`, `post_get`, `post_create`, `post_like`, `post_comment`, `comments_list`                                                             |
| GTM         | `people_search_filters`, `reactions_list`, `post_resolve`                                                                                        |
| Diagnostics | `health`, `operation_get`                                                                                                                        |

Lists default to 20, max 50. LinkedIn Inbox requests are capped at 20 per backend page because live requests for 50 return an unusable response; use the cursor to continue. Pass the returned opaque `next_cursor` as `cursor` with the **same arguments**. Cursors expire after 30 minutes, are bound to account, filters and operation, and reset with the browser session. Lists are live, not immutable snapshots. Deduplicate by entity URN when traversing a changing inbox. `conversations_search` searches participant/title/preview content in each fetched page; follow its cursor to search older pages. It is not full historical message search.

Inbox/history reads use HTTP only and never intentionally open a conversation or mark it read. Attachment metadata can appear in normalized read results; uploading or downloading attachment content is not implemented.

### Writes and uncertain results

Every write requires `idempotency_key`. Use the same key for a retry of the same operation; changing its payload produces `idempotency_conflict`. Receipts survive service-worker/native-host restarts for seven days. After seven days a key is no longer protected: check LinkedIn before replaying an old action.

`message_send` requires either `conversation_urn` or `recipient_urn`, plus exact `expected_participant_urns` excluding yourself. Existing-conversation validation first checks an exact conversation entity in the history response, then traverses Inbox, Archive and Spam within the operation deadline. It fails closed if participants cannot be verified. There is no fixed 260-thread limit. New recipient sends require one exact profile URN. Group replies use the exact participant set; group creation is excluded.

Writes execute immediately through the connected account. There is no extension review queue or per-operation approval. `operation_get` reads persisted execution receipts, and the same key replays the receipt without dispatching again. Live acceptance is reported separately from availability.

Statuses:

- `confirmed`: a created entity receipt or verified DOM state was observed.
- `unknown_outcome`: the action may have happened. Do not submit a new key or switch adapters. Inspect LinkedIn or use `operation_get`.
- `failed_before_dispatch`: no mutation was dispatched, although a read/precondition failed.

`operation_get` can reconcile an uncertain existing-thread message if its origin token appears in bounded older-history traversal. No matching token is **not** proof of non-delivery. Read/unread and archive/unarchive changes also get a bounded list-based state check after dispatch. Other uncertain operations remain uncertain until checked in LinkedIn. HTTP success without an identifiable receipt/state is deliberately not reported as verified success.

Calls serialize across MCP clients in the extension. HTTP requests have at least one second spacing and a 15-second fetch timeout. Queued calls expire after 60 seconds. Cancellation prevents queued work and checks before dispatch; an in-flight browser operation may finish and its receipt remains available. No automatic write retries or HTTP-to-DOM mutation fallbacks.

### DOM operation boundaries

The DOM adapter uses only packaged operations, exact target URNs, unique visible controls and English/German labels. It never accepts caller-supplied selectors, scripts or URLs. A missing/ambiguous target fails rather than clicking an unrelated control.

Feed pagination is a bounded live scroll. `post_resolve` resolves a rendered card's `scan_key` through its scoped control menu and binds its exact identity to that card. A share ID is not advertised as a verified public permalink. Read reactions/comments on the resolved card; if no matching card exists, post reads navigate only the work tab when a supported activity location or observed permalink is available. No arbitrary navigation URL is accepted.

`comments_list` expands comments/replies and returns bounded, deduplicated pages with author profiles and truncation indicators. `reactions_list` opens only the selected post's visible reaction dialog and retains that dialog for cursor continuation. Both remain partial because LinkedIn may rank or omit entries. Reply parent IDs are supplied only when the DOM establishes the relationship.

`people_search` supports `filters.connection_degrees` (`1`, `2`, `3`), `location_ids` and `company_ids`. `people_search_filters` takes `kind: location|company` and a name query to resolve numeric values through LinkedIn's public typeahead. No Sales Navigator requests are made.

Collection jobs were removed in 0.3. Use direct cursor pages. DOM reads use a dedicated LinkedIn work tab and bring it forward to avoid background timer throttling. Navigating or clicking controls in that tab invalidates its traversal cursor; API reads do not. A consumed cursor replays its cached page. Session cursors expire after 30 minutes and share a 5 MiB storage budget. See [interface contract](docs/interface-patterns.md).

The registry exposes all 24 operations in development and pilot builds. `health` reports current-build acceptance separately from availability. `release:check` still requires current-commit evidence for every capability and the publishing prerequisites; acceptance does not gate individual calls.

## Development and packaging

```sh
npm run typecheck
npm test                 # builds actual bundles before testing
npm run package          # dist/linkedin-extension.zip
```

Tests cover strict tool boundaries, native framing/fragmentation, actual MCP stdio registration, actual MV3 bundle startup, installer isolation, native/socket roundtrip, account and recipient mismatches, opaque cursor binding, mutation persistence and ambiguous outcomes. No live writes occur during tests.

`dist/linkedin-extension.zip` is a local upload artifact. Draft store listing, privacy notice and reviewer instructions are in `store/`. Actual store ID, hosted operator/support URLs, screenshots and notarized artifacts remain release prerequisites checked by `npm run release:check`. The installer accepts that future exact store ID; it does not include a wildcard origin.

Remove the local host using `node dist/cli.js uninstall`. Remove the Chrome extension separately to erase its local data. Receipts contain payload hashes, target/account IDs, operation IDs, timestamps and statuses, not message bodies. Reads are transient MCP responses, not an inbox database. As with other local MCP tools, clients on the same OS account are trusted; other OS users cannot access the private socket directory.

## Build the macOS pilot companion

```sh
npm run package:companion -- /path/to/official/node STORE_EXTENSION_ID arm64
npm run package:companion -- /path/to/official/x64/node STORE_EXTENSION_ID x64
BRIDGE_CHANNEL=pilot npm run package
npm run release:check
```

Companion builds include runtime, bundled dependencies, licenses, Setup/Uninstall commands, ZIP and PKG installers with SHA-256 files. Supply `BRIDGE_NODE_LICENSE` pointing to the matching official Node LICENSE when the cached 22.22.0 license is unavailable. No build command installs the companion automatically.

The pilot uses native host `com.hagen.linkedin_mcp_bridge.pilot` and a separate `LinkedIn MCP Bridge Pilot` data directory. A pilot ZIP must be paired with a pilot companion configured with its exact Chrome extension ID. Development builds retain the original host. Extension and companion versions/protocol must match.

Signing requires `BRIDGE_SIGN_IDENTITY` (Developer ID Application) and `BRIDGE_INSTALLER_IDENTITY` (Developer ID Installer); notarization additionally requires `BRIDGE_NOTARY_PROFILE`. The package command rejects the wrong identity type or a non-Accepted notarization response. Unsigned artifacts are explicitly development candidates, not distributable notarized releases.

The PKG places the companion under `/Applications/LinkedIn MCP Bridge Pilot`. Run its Setup.command as the signed-in user to register that user's native host. For a ZIP installation, move the whole directory to a durable location first. Configure the local MCP client with its bundled node and cli.js paths. Updates replace the companion while Chrome is closed, then rerun Setup.command. The unpacked development setup remains available above.
