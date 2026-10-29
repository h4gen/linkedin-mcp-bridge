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

- `src/core/contracts.ts`: 20 strict tool schemas; no generic transport or browser tool.
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
