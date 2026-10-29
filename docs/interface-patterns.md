# Interface contract — 0.3

## Source-shaped reads

Use narrow list/get/search tools. Lists accept an account, a limit and an optional opaque cursor. Keep query, target, filters and page size identical when continuing. No background extraction jobs exist in 0.3.

| Source        | Tools                     | Continuation                                                                             |
| ------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| Server cursor | Inbox                     | Captured next cursor                                                                     |
| Timestamp     | History                   | Boundary overlap plus buffered overflow; unresolved equal-time boundaries remain partial |
| Offset        | People, invitations       | Source paging rather than extracted row count                                            |
| Local scan    | Inbox search              | Explicit participant/title/preview scope and scan budget                                 |
| DOM session   | Feed, reactions, comments | Dedicated work tab, exact target and live document/session                               |

Every list has `items`, `next_cursor`, `partial` and `page_info`. `page_info` includes source, observed order, observation time, returned count, requested limit, cursor expiry, reason, continuation (`available`, `exhausted`, `blocked`) and coverage (`complete_for_scope`, `partial`, `unknown`). A short/empty page is not necessarily final; no cursor is not necessarily completeness. Source exhaustion only establishes coverage for that source/query, not all LinkedIn data.

Cursor lifetime is 30 minutes. Replays return cached results but validate account and DOM session first. Cursor cache/state share a 5 MiB budget; eviction returns `cursor_evicted`, never a silent restart. Oversized pages and traversal limits fail explicitly. Results are a live traversal, not a snapshot.

DOM reads bring the separate work tab forward. One DOM traversal is active at a time; new DOM operations or user control clicks invalidate the previous session. API operations do not. Reaction dialogs remain open across pages. Lost document/session state requires a fresh query. Unknown post locations are not replaced by guessed share/ugcPost permalinks.

Comments expose identity quality (`source` or `session`), text truncation and parent relation. Identical comments without source IDs are separate nodes rather than collapsed by author/text. A null parent means unknown. Profile URLs are observed/resolved, not constructed from arbitrary URN suffixes.

## Writes and recovery

Writes use exact targets, idempotency keys and extension-owned payload confirmation. A preview is not a send. Message previews use resolved recipient names and verified profile URLs. Existing-thread sends validate all participants. Only message send and read/archive changes are enabled pending further acceptance.

Operation receipts survive updates for seven days. A pending/interrupted send is unknown, never automatically resent. `operation_get` can read known receipts without a live network session and attempts bounded reconciliation for unknown sends. Reconciliation uses the origin token and exact conversation, traversing older history or locating a new-recipient conversation. Missing evidence never proves failure.

Read timeouts permit read retry; ambiguous writes require receipt inspection. Cursor loss requires restarting the query. Session/account errors require reconnecting. Rate-limit cooldowns parse seconds and HTTP dates. Pause/disconnect/data-clear invalidate queued work; already dispatched mutations cannot be recalled.

## Compatibility and capability reporting

0.3 removes the three extraction job tools and introduces `conversations_get` and output schemas for every operation. Profile and invitation results are compact typed views. Temporary 0.2 cursors/drafts are cleared on migration; content-free send receipts are retained. Original write inputs and fingerprints remain compatible.

The capability registry is shared by dispatch, tool listing and release checking. The development build exposes 17 of 24 operations. All original capabilities are mandatory for the full pilot; seven unaccepted writes are blockers, not silently dropped scope. Current-build live acceptance must be documented separately from historical evidence and passing unit tests.
