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

- `src/core/contracts.ts`: 26 strict tool schemas; no generic transport or browser tool.
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

## Pilot 0.2 additions

Extension-owned session approvals bind the exact account/operation/payload hash/key and expire after 30 minutes. Only packaged popup/review page senders can decide them; no approval tool exists in MCP. Enabled mutations are message_send and conversation_update. The original unaccepted handlers remain present but cannot execute through the extension.

GTM extraction uses copied owned-source parsers, scoped feed-card identity and owned reaction dialogs. Bounded jobs use session storage with result retention and cancellation between pages. A Chrome worker restart leaves jobs interrupted, not automatically resumed. Search normalization flattens actual SearchClusterViewModel entries before determining pagination. Public filter lookup is a fixed guest endpoint with credentials omitted.

The companion build bundles Node-side dependencies and accepts a separately supplied official Node binary for arm64/x64. Pilot and development hosts are distinct. Wire requests include protocol and exact companion version. Chromium's native framing limits are asymmetric (1 MiB host-to-Chrome; 64 MiB reverse); the application further caps responses at 6 MiB of UTF-8 bytes. Socket streams decode UTF-8 across fragmented chunks.
