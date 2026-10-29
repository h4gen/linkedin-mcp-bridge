# Protocol provenance and acceptance status

## Sources

Protocol facts were inspected on 2026-10-29 from the following primary implementation documentation. This project implements its own adapters; it does not import or execute third-party extension code.

- https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/voyager-endpoints.md
- https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/extension/src/background/voyager.js
- https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md
- https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/ENDPOINTS.md (web search excerpt only; raw source was unavailable)

Modern SDUI post selectors and identity extraction were adapted from the user’s local `lead-extractor-for-linkedin-posts/src/lib/post-dom.ts`.

Native frame encoder/decoder was reused from the user's local `ebay-research-bridge/src/native-host/framing.ts`. The source project is not changed or required at runtime.

## Adapter status after live acceptance

| Operations              | Mechanism                                                  | Current limitation                                                                               |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Health/account          | `/voyager/api/me` + explicit popup binding                 | Live connected account verified                                                                  |
| Inbox lists/search      | Category GraphQL, versioned persisted query                | Live two-page traversal verified; backend pages capped at 20; search is page-local               |
| History                 | Message GraphQL, timestamp pagination                      | Live recent/older pages verified with zero overlap; equal-timestamp boundaries may still overlap |
| Message send            | Typed `createMessage`, origin token, expected participants | Live delivery and same-key deduplication verified; trackingId must be 16 bytes                   |
| Mark read/unread        | Batch partial update                                       | Both transitions live verified and original read state restored                                  |
| Archive/unarchive       | Add/remove `ARCHIVE` category                              | Both transitions live verified and Inbox state restored                                          |
| Profile                 | Top-card REST decoration                                   | Live profile matched the authorized contact; possible profile-view effect                        |
| People                  | Search-clusters GraphQL                                    | Live search returned results; versioned persisted query                                          |
| Invitation list/send    | Typed REST requests                                        | Received and sent lists live verified; sending an invitation remains unverified                  |
| Accept/ignore/withdraw  | Exact-URN DOM card                                         | Selector/URN exposure needs live verification                                                    |
| Feed/post/comments/like | Scoped DOM                                                 | Modern feed pagination live verified; post/comment/reaction writes remain unverified             |
| Delete own conversation | Exact open thread, scoped menu and confirmation            | No live delete target supplied; success reconciliation remains unknown                           |

No adapter captures cookies into extension storage, logs, receipts or MCP responses. The page-context fetch reads JSESSIONID only to populate the browser request's CSRF header. The server never accepts arbitrary browser HTTP requests.

Query IDs are intentionally tied to their captured variable shape. Do not blindly substitute a different hash merely because the prefix matches: LinkedIn has multiple `messengerConversations` operations with incompatible arguments. A drift error should prompt a fresh operation-specific capture and fixture, not a guessed fallback mutation.

## Live acceptance scope

- Connect the extension in the authorized Chrome profile and verify account URN.
- Compare Inbox first/second pages and message history against visible LinkedIn UI. Check unread state remains unchanged by API reads.
- Resolve the authorized test contact **Kirstin Taufertshöfer** to an unambiguous profile and exact participant URN before a send.
- Completed: one clearly labeled test message, visible delivery, same-key replay and exactly one matching message in history.
- Completed: read/unread and archive/unarchive on the approved test thread; initial state restored.
- Invitation test skipped for this contact: the visible search result showed an existing first-degree connection on 2026-10-29.
- No deletion until an explicitly disposable conversation is identified.
- No public post/comment/like acceptance test without a specified target/content.

Automated tests use fictional fixtures. They validate implementation behavior, not LinkedIn endpoint availability.

## 0.2 changes

The table above records the earlier acceptance. Inbox search now scans a bounded number of pages with a cursor (participant/title/preview matching, not full-text message search). History pagination buffers overflow and suppresses overlap; unresolved timestamp boundaries remain explicitly partial. People search flattens nested result clusters and accepts typed connection/location/company filters. The public LinkedIn guest typeahead lookup is a separate fixed GET-only adapter without cookies; protocol facts were inspected at https://github.com/alexey-pelykh/lhremote/blob/main/packages/core/src/operations/resolve-linkedin-entity.ts and independently implemented, with no third-party source copied.

Reaction/comment readers use scoped visible DOM adapters adapted from the user's local extractor. They expose primary cursor interfaces; optional jobs collect those same pages. See [interface patterns](interface-patterns.md) and the 0.2 section of [validation](validation.md) for current acceptance limits. Only message send and inbox state changes are enabled writes in the pilot.

## 0.3 supersedes the job interface

Jobs and dormant alternative reaction/comment adapters have been removed. The active DOM reader retains owned dialogs and binds cursors to a dedicated work tab/document session. Server cursors, timestamp boundaries, offset pages and local scans remain distinct adapter mechanisms. `conversations_get` shares identity-bound lookup with recipient checks and state verification; mailbox-only lookup is used for deletion postconditions. Source arrays are no longer silently truncated, ambiguous/wrong collections fail, and invitation shared secrets are excluded from results.

An already-connected profile inspected on 2026-10-29 exposed its exact profile URN in its Message compose link and visible `· 1st` text near the profile heading. The connection postcondition reader requires both observed identity and visible degree in that profile scope. An invitation card disappearing alone is not sufficient acceptance evidence.

## 0.4 execution policy

The earlier enabled-write restrictions above are historical. All implemented operations now execute directly without extension approval. Endpoint acceptance remains evidence-based and separate from availability.
