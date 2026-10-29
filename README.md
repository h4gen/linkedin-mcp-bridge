# LinkedIn MCP Bridge

A separate macOS-first MCP server and Chrome MV3 extension. The local Node process communicates with the extension through Chrome Native Messaging and a private Unix socket. LinkedIn session credentials stay in the browser. No hosted relay, remote scripts, background inbox indexing or telemetry.

**Development build 0.1.0.** The protocol adapters and DOM operations are implemented, but live acceptance against the connected account is still pending. Synthetic tests do not establish that LinkedIn currently accepts an endpoint. See [capability status](docs/protocol.md) before treating any operation as production-ready.

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

This is local stdio: it does not directly connect the ChatGPT or Claude websites. Client configuration is provided, not silently added to an existing client configuration.

## Tools

All names have a `linkedin_` prefix. First call `health`, then supply its `account_urn` to every account operation.

| Area        | Tools                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Inbox       | `conversations_list`, `conversations_search`, `messages_list`, `message_send`, `conversation_update`, `conversation_delete` |
| People      | `profile_get`, `people_search`, `invitations_list`, `invitation_send`, `invitation_respond`, `invitation_withdraw`          |
| Feed        | `feed_list`, `post_get`, `post_create`, `post_like`, `post_comment`, `comments_list`                                        |
| Diagnostics | `health`, `operation_get`                                                                                                   |

Lists default to 20, max 50. LinkedIn Inbox requests are capped at 20 per backend page because live requests for 50 return an unusable response; use the cursor to continue. Pass the returned opaque `next_cursor` as `cursor` with the **same arguments**. Cursors expire after 30 minutes, are bound to account, filters and operation, and reset with the browser session. Lists are live, not immutable snapshots. Deduplicate by entity URN when traversing a changing inbox. `conversations_search` searches participant/title/preview content in each fetched page; follow its cursor to search older pages. It is not full historical message search.

Inbox/history reads use HTTP only and never intentionally open a conversation or mark it read. Attachment metadata can appear in normalized read results; uploading or downloading attachment content is not implemented.

### Writes and uncertain results

Every write requires `idempotency_key`. Use the same key for a retry of the same operation; changing its payload produces `idempotency_conflict`. Receipts survive service-worker/native-host restarts for seven days. After seven days a key is no longer protected: check LinkedIn before replaying an old action.

`message_send` requires either `conversation_urn` or `recipient_urn`, plus exact `expected_participant_urns` excluding yourself. Existing-conversation validation currently searches the first 260 Inbox threads. Archived/older threads fail closed rather than guessing recipients. New recipient sends require one exact profile URN. Group replies use the exact participant set; group creation is excluded.

Statuses:

- `confirmed`: a created entity receipt or verified DOM state was observed.
- `unknown_outcome`: the action may have happened. Do not submit a new key or switch adapters. Inspect LinkedIn or use `operation_get`.
- `failed_before_dispatch`: no mutation was dispatched, although a read/precondition failed.

`operation_get` can reconcile an uncertain existing-thread message if its origin token appears in the latest 50 messages. No matching token is **not** proof of non-delivery. Read/unread and archive/unarchive changes also get a bounded list-based state check after dispatch. Other uncertain operations remain uncertain until checked in LinkedIn. HTTP success without an identifiable receipt/state is deliberately not reported as verified success.

Calls serialize across MCP clients in the extension. HTTP requests have at least one second spacing and a 15-second fetch timeout. Queued calls expire after 60 seconds. Cancellation prevents queued work and checks before dispatch; an in-flight browser operation may finish and its receipt remains available. No automatic write retries or HTTP-to-DOM mutation fallbacks.

### DOM operation boundaries

The DOM adapter uses only packaged operations, exact target URNs, unique visible controls and English/German labels. It never accepts caller-supplied selectors, scripts or URLs. A missing/ambiguous target fails rather than clicking an unrelated control.

Feed and post tools act on the connected tab: open the feed or the exact post first. Feed pagination is a bounded live scroll, marked `partial`. Comments return currently rendered comments, also marked `partial`. Invitation respond/withdraw require the matching invitation URN in the rendered invitation card. Conversation deletion requires the exact thread already open; it deletes from your own inbox, not recipients' inboxes. These DOM contracts need live acceptance and selector updates for LinkedIn UI changes.

## Development and packaging

```sh
npm run typecheck
npm test                 # builds actual bundles before testing
npm run package          # dist/linkedin-extension.zip
```

Tests cover strict tool boundaries, native framing/fragmentation, actual MCP stdio registration, actual MV3 bundle startup, installer isolation, native/socket roundtrip, account and recipient mismatches, opaque cursor binding, mutation persistence and ambiguous outcomes. No live writes occur during tests.

`dist/linkedin-extension.zip` is a local upload artifact. Chrome Web Store listing, store-assigned extension ID, privacy-policy URL, screenshots and publication are separate release work. The installer accepts that future exact store ID; it does not include a wildcard origin.

Remove the local host using `node dist/cli.js uninstall`. Remove the Chrome extension separately to erase its local data. Receipts contain payload hashes, target/account IDs, operation IDs, timestamps and statuses, not message bodies. Reads are transient MCP responses, not an inbox database. As with other local MCP tools, clients on the same OS account are trusted; other OS users cannot access the private socket directory.
