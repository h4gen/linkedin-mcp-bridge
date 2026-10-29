# Validation record — 2026-10-29

Local development build 0.1.0, integrated on `main`.

## Automated checks

- TypeScript check passed.
- 31 tests passed: core contracts, actual built MCP/stdin/native/socket runtimes, installer isolation, MV3 bundle boot, SDUI feed parsing and overflow scrolling.
- Native socket permissions verified as 0600 inside a private directory.
- Account/recipient mismatch, concurrent duplicate sends, queued cancellation, unknown outcomes, cursor binding and mutation postconditions covered.

## Installed configuration

- Chrome extension: `epaamfamoldfahkbmbhgajcjojaoipno`, loaded by the user from `dist/extension`.
- Native host registered: `com.hagen.linkedin_mcp_bridge`.
- Chrome popup connected the explicitly selected LinkedIn tab and verified the signed-in account.
- Global Codex MCP server `linkedin` registered through `codex mcp add`, using `/usr/local/bin/node` and this repository's absolute `dist/cli.js` path.
- Existing Browser Bridge and LinkedIn extractor installations were retained unchanged.

The browser-control URL policy originally blocked opening `chrome://extensions/`. The user subsequently loaded the extension and opened that page. Its installed ID was read from the visible UI; the agent then registered the host, connected the popup and reloaded only this installed extension for tested updates. No browser permission setting or security policy was bypassed.

## Live results

| Check                      | Result                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Account health             | Connected and account identity verified                                                                                         |
| Inbox pagination           | Two pages of three conversations, zero overlapping IDs                                                                          |
| Inbox large requested page | LinkedIn rejected backend count 50 with an unusable response; fixed to backend count 20 with cursor continuation, verified live |
| Profile lookup             | Authorized test contact matched the visible profile and exact profile URN                                                       |
| People search              | Three results returned                                                                                                          |
| Received invitations       | Three results returned                                                                                                          |
| Sent invitations           | One result returned                                                                                                             |
| History pagination         | Test thread: three recent messages plus three older messages, zero overlap                                                      |
| Preserve unread status     | An unread conversation stayed unread with unread count 1 after API history reading                                              |
| Message send               | One clearly labeled test message successfully delivered to the authorized contact and visibly confirmed in LinkedIn             |
| Send idempotency           | Same key returned the same confirmed receipt with `replayed: true`; history contained exactly one copy of the test text         |
| Mark unread then read      | Both operations confirmed through read postconditions                                                                           |
| Archive then unarchive     | Both operations confirmed through category-list postconditions                                                                  |
| Restore test conversation  | Back in Inbox and read, matching its initial state                                                                              |
| Modern feed                | Two pages of three distinct posts, zero overlapping scan keys; results explicitly marked partial                                |

The authorized test contact was Kirstin Taufertshöfer, already a first-degree connection:
https://www.linkedin.com/in/kirstin-taufertshoefer/

The first send attempt returned HTTP 400 and no test message appeared in the conversation. Its UUID-shaped tracking ID was corrected to the 16-byte representation expected by LinkedIn. The corrected request returned a created-message URN; visible UI and subsequent MCP history both confirmed delivery. No automatic retry was performed. The later same-key call only returned the stored receipt.

## Remaining acceptance boundaries

No invitation was sent because the named contact was already connected. No invitation was accepted/ignored/withdrawn, no conversation was deleted, and no public post/comment/reaction was published. Those implemented handlers have not been live-validated and should not be described as production-tested.

Some SDUI feed posts omit a discoverable URN. They return readable content with a local scan key and no invented permalink. Feed/comments are bounded partial reads, not complete snapshots. Posting and comment selectors remain operation-specific live acceptance work.

The repository has no remote, so no remote fetch, push or hosted/store deployment is claimed. No extra worktree was created. The local Chrome development deployment contains cumulative local `main`; all source changes made during acceptance are committed there.
