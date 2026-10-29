# Protocol provenance and acceptance status

## Sources

Protocol facts were inspected on 2026-10-29 from the following primary implementation documentation. This project implements its own adapters; it does not import or execute third-party extension code.

- https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/docs/voyager-endpoints.md
- https://github.com/OpenRecruiterTools/linkedin-toolkit/blob/master/extension/src/background/voyager.js
- https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md
- https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/ENDPOINTS.md (web search excerpt only; raw source was unavailable)

Native frame encoder/decoder was reused from the user's local `ebay-research-bridge/src/native-host/framing.ts`. The source project is not changed or required at runtime.

## Implemented adapters, not live acceptance claims

| Operations              | Mechanism                                                  | Current limitation                                                                                     |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Health/account          | `/voyager/api/me` + explicit popup binding                 | Needs logged-in tab and native installation                                                            |
| Inbox lists/search      | Category GraphQL, versioned persisted query                | Hash/variable contract can drift; search is page-local                                                 |
| History                 | Message GraphQL, timestamp pagination                      | Equal-timestamp boundary messages may overlap; live history coverage unverified                        |
| Message send            | Typed `createMessage`, origin token, expected participants | Live recipient/schema and success receipt need acceptance                                              |
| Mark read/unread        | Batch partial update                                       | Protocol captured by external implementation; live acceptance pending                                  |
| Archive/unarchive       | Add/remove `ARCHIVE` category                              | Bounded category-list postcondition check; unknown if state cannot be established                      |
| Profile                 | Top-card REST decoration                                   | Decoration version can drift; possible profile-view effect                                             |
| People                  | Search-clusters GraphQL                                    | Versioned persisted query                                                                              |
| Invitation list/send    | Typed REST requests                                        | Received list source conflicts with newer upstream reports; detect errors, never silently return empty |
| Accept/ignore/withdraw  | Exact-URN DOM card                                         | Selector/URN exposure needs live verification                                                          |
| Feed/post/comments/like | Scoped DOM                                                 | Requires relevant page open; feed/comments explicitly partial                                          |
| Delete own conversation | Exact open thread, scoped menu and confirmation            | No live delete target supplied; success reconciliation remains unknown                                 |

No adapter captures cookies into extension storage, logs, receipts or MCP responses. The page-context fetch reads JSESSIONID only to populate the browser request's CSRF header. The server never accepts arbitrary browser HTTP requests.

Query IDs are intentionally tied to their captured variable shape. Do not blindly substitute a different hash merely because the prefix matches: LinkedIn has multiple `messengerConversations` operations with incompatible arguments. A drift error should prompt a fresh operation-specific capture and fixture, not a guessed fallback mutation.

## Live acceptance checklist

- Connect the extension in the authorized Chrome profile and verify account URN.
- Compare Inbox first/second pages and message history against visible LinkedIn UI. Check unread state remains unchanged by API reads.
- Resolve the authorized test contact **Kirstin Taufertshöfer** to an unambiguous profile and exact participant URN before a send.
- Send one clearly labeled test message; verify visible delivery, then replay its same idempotency key and verify no second message.
- Test read/unread and archive/unarchive on that approved test thread only, preserving its initial state.
- Invitation test skipped for this contact: the visible search result showed an existing first-degree connection on 2026-10-29.
- No deletion until an explicitly disposable conversation is identified.
- No public post/comment/like acceptance test without a specified target/content.

Automated tests use fictional fixtures. They validate implementation behavior, not LinkedIn endpoint availability.
