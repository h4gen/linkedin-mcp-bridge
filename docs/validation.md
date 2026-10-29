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

## 0.2 pilot implementation and interface follow-up

The 0.1 live acceptance above remains historical evidence. The 0.2 work adds extension-owned confirmation, disabled unaccepted writes, consent/pause/clear controls, typed people filters, post identity resolution, reaction/comment readers, optional collection jobs, and relocatable macOS companion packaging.

This turn's live reads verified two distinct people-search pages, two history pages without overlap, a resolved post, and paginated reaction/comment reads. A new draft was shown in the extension and rejected; no additional message was sent. A subsequent collection job returned zero partial results despite earlier positive direct reads; this remains an unresolved acceptance issue. Public company/location lookup was implemented and fixture-tested, but its final live output was not retained and is not claimed as accepted.

The cursor contract follow-up passes typecheck and 43 automated tests, including identical-page replay, cross-target cursor rejection, expiry and partial coverage without continuation. These new cursor changes have not yet been reloaded and live-accepted. Source changes are on local main; earlier generated companion ZIP/PKG files predate this interface follow-up and are not final release artifacts.

Store submission remains blocked: public operator/support/privacy details, reserved Store extension ID, store screenshots, Developer ID signing/notarization, fresh macOS installation acceptance on both architectures, and the remaining live adapter checks. Unsigned arm64/x64 PKG and ZIP artifacts exist for development; their existence is not signing or fresh-machine acceptance. No store publication has occurred.

## 0.3 source-contract repair

The development candidate removes background collection jobs and unaccepted writes from MCP listing. It adds source-specific pagination metadata, paired output contracts, explicit capability states, compact profile/invitation results, dedicated work-tab DOM sessions, replay/eviction checks, mutation-generation guards and shared conversation verification. Existing send receipts are retained. Seven original write capabilities remain disabled pending their separate acceptance; they remain required by the release gate.

Automated: typecheck and 62 tests pass, including the short-people-page regression, undocumented inbox-search matches, history buffer draining, duplicate comment identities, retained reaction dialogs, foreign/expired/invalidated cursors, shared-secret exclusion, generation changes during dispatch and receipt-expiry serialization. Runtime tests exercise the actual extension bundle, 17 exposed MCP tools with output contracts, and native/socket transport. Production dependency audit reports zero known vulnerabilities.

Live during implementation (read-only unless explicitly stated):

- Connected version 0.3 to the existing account through its own work tab.
- Read two inbox pages, located the named contact through bounded inbox search, read her compact profile, and read two filtered people-search pages.
- Public location and company lookup both returned successfully.
- Resolved a public feed card, then traversed 160 unique reactors across eight pages of 20; no duplicate IDs, identical cached cursor replay.
- Read 17 unique comments across three nonempty pages on the same post; replay was identical. The terminal empty page remained partial/blocked, not falsely complete.
- An inactive-tab DOM timeout was reproduced and fixed by foregrounding the dedicated work tab for UI actions. Later traversal completed without that timeout.
- Inspected first-degree evidence on the already-authorized contact's public profile to ground the connection postcondition reader; this is not acceptance of an actual invitation mutation.

The source received further regression and postcondition improvements after these live reads. Final-build rerun evidence is kept under ignored `artifacts/qa/`; build-bound release acceptance is deliberately separate. No new message, invitation, public post, comment, like or deletion was performed during this implementation. The existing test conversation is retained.

Outstanding release blockers: authorized targets/content for live testing the seven additional write capabilities, full final-build mutation/read-state acceptance, operator/support/privacy details, reserved Store ID, store screenshots, signed/notarized companions and fresh-machine arm64/x64 installation checks. These are not replaced by a boolean approval flag: release checking requires per-capability evidence tied to the current canonical revision and artifact signatures.
