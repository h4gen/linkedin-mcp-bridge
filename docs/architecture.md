# Architecture

```mermaid
flowchart LR
  Client[MCP client] -->|stdio tools| Server[Node MCP server]
  Server -->|private Unix socket| Host[Native Messaging host]
  Host -->|Chrome framed JSON| Extension[MV3 service worker]
  Extension --> Queue[Serialized account operations]
  Queue --> Journal[Local mutation receipts]
  Queue --> API[Typed page-context HTTP]
  Queue --> DOM[Scoped DOM operations]
  API --> LinkedIn[Connected LinkedIn tab]
  DOM --> LinkedIn
```

- `src/core/contracts.ts`: 27 strict input contracts, paired output schemas and a shared capability registry; no generic transport or browser tool.
- `src/core/engine.ts`: serialization, account checks, pagination, mutation journal, cancellation boundary and reconciliation.
- `src/core/api.ts`: typed routes, Rest.li variables and operation-specific response handling.
- `src/core/normalize.ts`: bounded normalized-reference resolution; missing collection is a schema error.
- `src/extension/background.ts`: native connection, pause/disconnect, browser-side storage, cooldown and request pacing.
- `src/extension/page-fetch.ts`: browser authentication boundary and strict path allowlist.
- `src/extension/dom.ts`: bounded reads and scoped UI mutations.
- `src/native/`: framed native host, per-user socket, generated wire IDs and client transport.
- `src/installer.ts`: independent macOS manifest and launcher.

Pending receipt persistence happens before a write. An interrupted/pending receipt is replayed as unknown, never resent. Multiple MCP clients share one extension queue. A native host lock prevents two Chrome profiles from simultaneously owning the socket. Restarted sessions must still match the explicitly bound LinkedIn account before any operation.

No cloud dependencies or runtime coupling to the existing Google Ads bridge or LinkedIn extractor. No canonical remote exists yet; this new repository's local `main` is its current integration branch. Store publication/deployment is not part of the local test build.

## Historical pilot 0.2 additions

Extension-owned session approvals bind the exact account/operation/payload hash/key and expire after 30 minutes. Only packaged popup/review page senders can decide them; no approval tool exists in MCP. Enabled mutations are message_send and conversation_update. The original unaccepted handlers remain present but cannot execute through the extension.

GTM extraction uses copied owned-source parsers, scoped feed-card identity and owned reaction dialogs. Historical 0.2 jobs were removed in 0.3; direct cursor reads own the browser traversal state. Search normalization flattens actual SearchClusterViewModel entries before determining pagination. Public filter lookup is a fixed guest endpoint with credentials omitted.

The companion build bundles Node-side dependencies and accepts a separately supplied official Node binary for arm64/x64. Pilot and development hosts are distinct. Wire requests include protocol and exact companion version. Chromium's native framing limits are asymmetric (1 MiB host-to-Chrome; 64 MiB reverse); the application further caps responses at 6 MiB of UTF-8 bytes. Socket streams decode UTF-8 across fragmented chunks.

## 0.3 adapter boundaries

API adapters own server cursor, timestamp and offset semantics. DOM adapters own a session in a dedicated work tab. The Engine only scopes, caches and budgets cursors and translates explicit adapter coverage into the public envelope. `capabilities.ts` owns adapter dispatch, output schemas and tool exposure; unavailable writes cannot be called through the production extension.

Conversation lookup is shared by public reads, exact recipient validation and mutation postconditions. State verification requests the necessary source fields instead of accepting a partial conversation entity. Delete verification scans mailbox membership, not still-readable historical messages. Message reconciliation follows older pages and can locate new-recipient conversations without dispatching again.

A connection-generation change invalidates queued operations and guards journal writes. In-flight external actions may still have taken effect; no retry is implied. Old pending receipts stay unknown. Updating to 0.3 clears temporary cursors/drafts, pauses the connection for reconnection to the work tab, and retains the seven-day mutation journal.

## 0.4 direct writes

All 24 operations are exposed in every build. The approval module, review UI, inbox permission and test-write build flag have been removed. Writes retain account/target checks, serialization, durable receipts and postconditions. Acceptance metadata informs release readiness only. Migration clears session drafts and the old inbox preference without replaying actions or deleting the mutation journal; it pauses the bound connection for reconnection. Local data clearing is available in the popup.

## 0.5 native post planning

The self-contained composer adapter owns native draft save/reopen, time confirmation, schedule listing and exact cancellation. It rejects immediate publish controls. The Engine binds schedule references to account, normalized text hash and timestamp, stores them without post bodies and expires them seven days after their scheduled time. Unknown planning receipts reconcile without redispatch. `post_create` is removed from the contract and executable adapter.
