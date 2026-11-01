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

Automated: typecheck and 63 tests pass, including the short-people-page regression, undocumented inbox-search matches, history buffer draining, duplicate comment identities, retained reaction dialogs, foreign/expired/invalidated cursors, shared-secret exclusion, generation changes during dispatch and receipt-expiry serialization. Runtime tests exercise the actual extension bundle, 17 exposed MCP tools with output contracts, and native/socket transport. Production dependency audit reports zero known vulnerabilities.

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

A repeat against integrated commit `43e8825` passed all nine read-check groups: two inbox pages, exact conversation lookup/history with unchanged read state, inbox search, profile, two person pages, nonempty location/company lookups plus company-filtered people, sanitized received/sent invitations, eight reaction pages (160 unique), comment pages (17 unique), cursor replay and invalidation, and receipt lookup. Subsequent build-metadata wiring embeds only acceptance evidence matching a clean current canonical revision; it never infers acceptance from enabled status or historical tests. The final matching manifest is `artifacts/acceptance-0.3.0.json`.

The final SDK integration check now discovers tools before calling them. This caught and fixed a registration bug: passing only an output schema's shape discarded its passthrough policy. Registration now passes the complete Zod schema. A real MCP client/server/socket regression test protects the published JSON Schema as well as server-side parsing.

## Scoped mutation acceptance (2026-10-29)

The user authorized a deletion test for Parth Patel, selection of a new invitation recipient, one received invitation each for accept/ignore, and a sent invitation for withdrawal. Public posting is deferred; like/comment targets remain pending. No mutation is accepted merely from this authorization.

A local development build can explicitly expose these four capabilities for acceptance with `BRIDGE_TEST_WRITES=conversation_delete,invitation_send,invitation_respond,invitation_withdraw npm run build`. Each is marked `acceptance_test_only` in health and still requires the normal extension-owned approval and postcondition checks. A normal build disables them; pilot builds reject the flag, and packaged companions ignore it. This does not change accepted capability evidence. Test-build policy and the existing regression suite pass 65 tests.

The extension review page is inaccessible to the browser automation surface due to its security policy. No alternate surface or approval-storage bypass is used. Live mutations require the user to review the prepared requests in the extension; until that happens, they remain pending and must not be reported as accepted.

## 0.4 direct execution (2026-10-29)

All 24 operations are exposed without extension approvals or acceptance-based execution gates. The review page, approval store/handlers and test-write build flag were removed. Migration preserves mutation receipts, clears temporary state and the obsolete inbox permission, and pauses the connection without dispatching old drafts. The earlier approval requirements in this record are historical.

Typecheck and 65 automated tests pass, including immediate single dispatch with idempotent replay, actual MCP discovery of all 24 tools, and actual MV3 migration with retained receipts and no draft execution. Live results for the five previously prepared actions are recorded separately against the tested canonical commit under `artifacts/qa/`. No additional public-write or message acceptance is inferred.

## 0.4.1 DOM recovery

Regression coverage reproduces extended invitation labels, link controls, delayed thread rendering, owned menus/dialogs, hidden/duplicate/disabled targets, session cancellation and pre/post-click failures. Engine integration tests cover same-key recovery, legacy proof requirements, restart, serialization and payload conflicts. Live recovery evidence for the four original pending actions is stored under `artifacts/qa/write-recovery-0.4.1.json`, tied to the canonical revision. Earlier 0.4.0 failed attempts remain in their original evidence and receipt histories.

Native HTML withdrawal dialogs and delayed dropdown controls are covered by the recovery tests. Known navigation failures before adapter invocation retain retryable receipts. The initial link-only withdrawal attempt can be migrated only with its original receipt history and fresh target proof. Deletion verification scans inbox, archive and spam in bounded batches persisted between receipt reads; it confirms absence only after all categories are exhausted. This prevents large mailboxes from losing a completed deletion to the request deadline.

## 0.5 native drafts and scheduled posts

`post_create` is removed; MCP exposes 27 operations. Typecheck and 97 automated tests cover native draft save/reopen, existing-draft preservation, stale editor hydration, timestamp/offset validation, scoped schedule cancellation, post-dispatch verification failures, restart reconciliation and same-key replay. Prior DOM/API regression tests remain in the suite.

Live checks on 2026-10-30 used only marked disposable text and scheduling seven days ahead. A draft was saved and reopened unchanged; its same-key replay returned the original confirmed receipt. Scheduled test entries were matched by text, timestamp and native share ID, then removed through `scheduled_post_cancel`. The final cancellation was confirmed against a newly loaded LinkedIn document, with `Scheduled (0)` afterward. Test drafts were discarded. No immediate publication was performed.

Evidence: `artifacts/qa/post-planning-complete-0.5.0.json`, `artifacts/qa/schedule-acceptance-0.5.0.json`, and `artifacts/qa/schedule-cleanup-0.5.0.jpg`. Earlier diagnostic attempts are retained separately; uncertain results were inspected/reconciled rather than resent. The final adapter waits for fresh save notifications and hydrated rows, resolves `aria-labelledby`, and verifies schedule changes after a complete document replacement because SDUI caches its manager. A nonempty open composer prevents that refresh. No additional Chrome permissions are required.

This is a local development extension, not a Chrome Web Store release. Native planning currently supports the observed English personal text composer; unsupported/truncated rows and ambiguous identities fail closed.

## 0.6.0 Git distribution and Windows acceptance — 2026-10-30

[CI run on canonical main](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41042286131) passed on macOS and Windows: 101 automated tests, type checking, formatting, extension packaging, runtime fingerprint checks and a real Chromium/native-host round-trip using synthetic health responses. The browser smoke test loads the packaged MV3 extension but does not open LinkedIn. Native installation is repeated to check idempotence; Windows rejects requests with an incorrect local transport token.

A fresh public GitHub checkout on macOS completed dependency installation, store-channel build, native registration, MCP configuration output and uninstall. No signed binary distribution is involved. Runtime fingerprints match between macOS and Windows.

The installed development extension was reloaded to 0.6.0 and reconnected. Live checks passed for two inbox pages, two message-history pages with unchanged read state, bounded inbox search, profile reads, people/filter searches, both invitation views and receipt lookup. Feed and engagement checks passed after opening the work tab on the feed: 49 unique reactions and 3 comments over three pages each, plus DOM cursor invalidation. A leftover composer initially produced the explicit `open_feed_in_connected_tab` error; no silent fallback or wrong-page action occurred.

Historical write acceptance below/above is retained as historical evidence. Automated tests cover all tool contracts; this release does not claim fresh live message, invitation, like, comment or conversation-deletion writes. Store materials are prepared locally only, as requested. Store submission and the real store extension ID remain pending.

Before initial public publication, the original Git history was backed up locally and Google Ads account identifiers were redacted from the public history with user authorization. Research measurements and the report remain available; original unredacted metadata is not distributed.

Native planning was also rechecked on 0.6.0: draft save/reopen and same-key receipt replay passed; the marked draft was discarded, a test post was scheduled seven days ahead, cancellation was confirmed and a fresh scheduled listing returned zero items. No immediate post, message, comment or invitation was dispatched during this release acceptance.

## Connection recovery — 2026-10-31

Runtime change: `83bc7aa`. Development build fingerprint: `f6ba079240b57639ca6fab2bfe40f523bbd46d845c65c21cabfe0eee85aecae1`.

- Failure-first reproduction: health returned disconnected for two queued clients when the saved work-tab ID no longer existed. The regression now passes without a Connect action.
- Typecheck and all 123 tests passed on integrated `main` after a fresh remote fetch. Coverage includes tab loss, changed IDs after a simulated browser restart, worker recreation, single-flight recovery, load timeout, discarded tabs, pause/disconnect, account mismatch, expired login, host backoff, pre-dispatch retries and no replay after dispatched-write transport loss. Existing receipt, draft/scheduling, pagination and MCP contract tests remain passing.
- Reloaded the installed development extension from the canonical build without reconnecting. With no LinkedIn tab open, real MCP health automatically created a background work tab and returned connected. Installed and local build fingerprints matched.
- Read-only inbox listing returned two rows. Closed the recovered work tab, then ran a first-degree people search and a separate CLI doctor concurrently. Both succeeded; people search returned two rows and doctor exited zero.
- Terminated only the verified development native-host process. The extension restarted it automatically; an immediately launched doctor succeeded in 2.16 seconds with a new host PID.
- No LinkedIn writes, messages, invitations or posts were dispatched during live acceptance. A full browser restart was simulated in tests rather than interrupting the user's other Chrome tabs. Chrome Store draft and five explainer assets were preserved; no Store submission was made.

## Recovery stress follow-up — 2026-10-31

Compared the existing Google Keyword Planner / shared Browser Bridge's bounded replay and reconnect behavior with this bridge. Four failing regression tests exposed a lookup/injection tab-loss race, queued work surviving its native port, interrupted API reads surfacing transient disconnects, and a client recovery window shorter than the extension's maximum backoff. The fixes are integrated in `e774391`.

- Typecheck, formatting and all 135 tests pass. Additional coverage includes 20 successive host/tab failures, cancellation during request pacing, a 30-second host outage, bounded API replay with identical cursor arguments, no DOM/write replay, and unknown outcomes for corrupted write responses.
- Reloaded the installed development extension; verified fingerprint `6682a44791faad4977155ee15acf4a03d08a7c2c6c745cd70fa7f29d5a72fdd9` matches the canonical build. A temporary macOS screen-control failure was resolved before this verification.
- Three live SIGKILL cycles each interrupted four outstanding doctor clients. All 12 returned connected with exit code zero and the expected build. Each cycle acquired a new host PID and recovered its stale host lock without intervention. All four clients completed 5.02, 5.17 and 5.05 seconds after the respective crash.
- Final connected-MCP health and a two-row inbox read passed after the stress test. No external writes were performed. Full-browser restart and tab-discard cases remain simulated tests; this does not constitute a multi-day soak test or a Windows live acceptance run.

## Complete primitive expansion 0.7.0 — 2026-10-31

The cumulative implementation extends baseline `c257977` from 27 to 32 tools. All five new primitives and the extended existing inputs are integrated on canonical `main`. The independent 32-name acceptance list is checked both against schemas and through the built MCP process. The original 135-test baseline is retained; the suite now contains 185 passing tests in 17 files, with typecheck, formatting and local release consistency passing.

Coverage includes explicit public projections versus full internal verification data; a twenty-conversation fixture below 32 KiB; Unicode text windows and revision changes; deterministic message ordering, overlap deduplication, buffered rows, missing timestamps and unresolved ties; exact counterpart matching and bounded category scans; profile sections and positive relationship evidence; stable parent-comment targeting, native parent/reply permalink verification, idempotency and unknown-outcome preservation; schema migration and worker/native-host/tab recovery. Safe API reads can retry once. DOM traversals and dispatched writes cannot automatically replay.

Live checks exposed and repaired delayed profile activity links, native share/ugcPost permalinks, ID-only search results without a navigable location, nested SDUI reaction controls, and feed navigation after other primitives changed the work route. A pending destination is never treated as an already completed navigation. A bounded navigation timeout remains an explicit error, not a successful read; one such timeout during browser inspection required replacing the work tab before the acceptance run continued.

Authorized write acceptance sent one private message to the named test contact and one personalized invitation to a relevant, previously unconnected profile. Both returned confirmed receipts with one attempt. Meaningful root-comment and exact-parent reply acceptance also returned confirmed receipts; same-key replay did not create another reply. All public acceptance comments were deleted and the test like was reversed. The repository's `AGENTS.md` now forbids public technical placeholders or AI-function-test labels, including temporary acceptance content. Messaging uses the dedicated messaging API and exact conversation/participant IDs, never the feed chat overlay.

These write artifacts retain their actual earlier runtime fingerprints. Reading their persisted receipts on the final build verifies restart continuity; it is not a fresh dispatch on that runtime. A real reply from the message recipient and a real invitation acceptance remain external dependencies. No such events are inferred from disappearance, sent receipts or simulated tests. Private evidence remains in ignored `artifacts/`; no message bodies or private conversation exports are published.

Final executable fingerprint: `52da5d75629b8af52d99be94397f9b7a0060d91ebe68c343cd1a4a54637d199c` (runtime commit `09c940f`). The built MCP and installed extension completed 24 live chain checks plus 8 supplementary read checks, covering all 21 read/diagnostic capabilities. Twenty conversations serialized to 18,772 bytes; message pagination and repeated cursors matched exactly, and message/post windows retained their revisions. All four supported search combinations, returned profile references and author-post lists worked. Native scheduled-post listing returned zero entries. The existing invitation remained positively listed as sent; no later message from the recipient was observed.

[CI on macOS and Windows](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41217598813) passed 185 tests, typecheck, formatting, packaging and runtime consistency. Both platforms also passed native installation/reinstallation and the packaged-extension/native-host browser smoke test. CI uses synthetic health and does not claim live LinkedIn operation on Windows. Local installation evidence is stored in `artifacts/installation-0.7.0-{darwin,win32}.json` with the actual matching fingerprint.

Killing only the verified development native-host PID during four concurrent clients recovered automatically: all four completed real inbox reads and the separate doctor exited zero in 18.1 seconds overall. The host PID changed. No Connect action or write replay occurred. Full Chrome restart remains a simulated test so the user's unrelated tabs are not interrupted.

Closing the dedicated LinkedIn work tab on the same final build also recovered without reconnecting: four parallel clients read the inbox and doctor exited zero, in 19.2 seconds overall. Reloading the extension earlier preserved the connection and confirmed message/reply/invitation receipts, each with `attempt_count: 1`. Recovery evidence is local under `artifacts/live-0.7/recovery/`.

The local acceptance manifest credits 21 current-runtime read/diagnostic capabilities and both installation platforms. Fresh final-runtime dispatch evidence remains pending for eleven write capabilities: message send, conversation update/delete, invitation send/respond/withdraw, draft creation, scheduling/cancellation, like and comment. Historical write evidence remains separately linked. These are Store-submission blockers; no acceptance gate was weakened and no destructive mailbox action was performed merely to fill a release checklist.

The pilot Store ZIP was built and preserved separately under `artifacts/store-0.7.0/`; `store:check` reported exactly those eleven missing write proofs. The development build was then restored and all 185 tests, typecheck, formatting and local release checks passed again on canonical `main`. The existing portal draft, listing and five graphics were inspected; the package upload encountered Google's renewed passkey sign-in. Portal 0.7.0 is therefore not confirmed or represented as submitted. `store/SUBMISSION.md` records the package hash and current draft status.

## Read primitive repairs 0.7.1 — 2026-10-31

The four reported regressions are repaired on cumulative `main`. The original 185 tests remain; 226 tests now pass in 22 files. The actual built background/page-adapter integration covers native share/ugcPost engagement handoff, three-page search and cursor replay for six filter combinations, Chrome-storage property reordering, API reads between DOM pages, and invalidation on navigation/document change/trusted interaction. The public messaging-engine test covers all five affected name projections. Relationship tests cover owned More menus, nested header/action rows, restricted profiles, conflicting signals and bounded invitation scans.

The first live repair build exposed an additional filter-comparison defect: Chrome storage reordered object keys, so a JSON-string comparison rejected equal filters. The fixture now reproduces that behavior and compares filter values independently of key order. Live profile inspection also confirmed the actions live beside the inner name block; the verified enclosing profile section now owns both. Partial message-source identities preserve known cached profile references instead of erasing them.

Runtime source commit: `811281ca28c49b4c9b02ee05ef675e822df71564`. Fingerprint: `e426d1d858b43ef34703c9c49618929191f34cfd06af780441ecc382d6230a78`. [macOS and Windows CI](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41227369003) passed tests, typecheck, formatting, packaging, release consistency, native registration/reinstallation and actual Chromium/native-messaging smoke tests. The browser smoke uses synthetic health and does not imply live LinkedIn testing on Windows.

Live evidence is private in ignored `artifacts/live-0.7.1/`; intermediate fingerprints remain separately recorded and are not relabeled. The activated development extension reports 0.7.1 and all 32 tools, retaining its account without another Connect click.

Verified on the final runtime:

- All three reported native post URLs resolve and feed `post_get`, `comments_list` and `reactions_list`. Todd and Neeraj provide two distinct pages of commenters/reactors and identical cursor replay. Aamir returns zero visible comments with explicit partial coverage; his one visible reactor is followed by an explicitly stalled partial page. Neither is falsely represented as complete source coverage.
- All five messaging primitives return normalized participant/sender names. Twenty conversations occupy 22,137 UTF-8 JSON bytes. Two text windows preserve their revision. Thirty-six messages across two history pages are newest first, without overlap, and replay identically. Reading an unread conversation preserves its unread state.
- Todd and Neeraj return `not_connected` with positive Connect evidence and exhausted received/sent invitation scans. The existing contact returns `connected` with first-degree evidence. The earlier invitation recipient now also returns positive first-degree evidence; this is not inferred from invitation disappearance. No new invitation or message was sent.

- A returned commenter identifier and a returned reactor identifier each open `profile_get` directly, followed by their author posts, relationship evidence and exact conversation lookup. Both bounded conversation searches returned no match with explicit partial coverage and a continuation; this does not claim no conversation exists.
- All six `relevance/latest` × `any/week/month` search combinations return three successive pages with no duplicate identities, identical cursor replay and an API invitation read between pages. After another DOM navigation, the old cursor correctly returns `cursor_invalidated` with public reason `document_changed`.
- Four separate MCP clients read health and inbox concurrently; all succeeded and `doctor` exited 0. After terminating the actual native-host process, four new clients recovered automatically and read the inbox; `doctor` again exited 0. Closing the actual work tab also recovered automatically for four clients without another Connect click.

All live activity in this increment is read-only. Public comments, likes, invitations and private messages were neither created nor modified. Existing write/recovery tests and persisted receipts remain intact; historical dispatch proofs do not become current Store submission acceptance merely because the reads pass.

The local pilot Store ZIP is preserved under `artifacts/store-0.7.1/`. All 21 read/diagnostic capability proofs and both platform installation proofs match the final fingerprint. The unchanged submission gate still requires current proofs for eleven write tools. No Store upload or submission was attempted. Listing text and all five explainer graphics are unchanged.

## Inbox identity repair 0.7.2 — 2026-10-31

Runtime source commit: `6a021d977329d6fe5d1b3357d1293f7fb04318f9`. Fingerprint: `2e2b5e2093b0f2319f448cc5e43e9f738fa7fce103889cbec4df60526fc28eb0`. The repair separates opaque member IDs from public identifiers, protects verified cache associations and retains the original requested URN through profile lookups. Details and fallback limits are in [the repair contract](repairs-0.7.2.md).

The regression first failed against the old built background/page bundles with `profile_not_unique`. The complete repeated inbox/profile/relationship sequence now passes against the real new bundles. All 249 tests in 23 files pass, retaining the earlier 226 tests, including messaging, pagination, engagement, write receipts and recovery. Further cases cover all five messaging projections, exact identities, cache precedence, bounded fallback, author posts, worker restart and the one-time migration retaining connection, pause, receipts and planning state. Typecheck, formatting and local release consistency also pass.

[macOS and Windows CI](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41234226637) passed on the runtime source commit: the full suite, packaging, native installation/reinstallation, process round-trips and an actual Chromium/native-host smoke test. Both platform builds report the same fingerprint. CI uses synthetic health; this is not live LinkedIn acceptance on Windows.

Read-only live acceptance on the installed 0.7.2 development extension completed 32 checks for the reported inbox person and a second existing inbox person. The sequence reads the exact conversation, resolves the returned URN, checks the relationship, explicitly resolves the known public identifier, reads the conversation again and repeats URN profile/relationship lookup. Both people remain correctly resolved and positively connected throughout. The first person has two exact personal conversations; both were read on each pass rather than silently treated as a single match. Message list/single-message reads followed by further profile/relationship reads also pass, as does author-post lookup for both people.

Twenty conversations occupy 18,016 UTF-8 JSON bytes. Opaque message-source links produce null public identifiers while retaining resolved URNs. Names remain normalized. A persisted confirmed message receipt remains readable; no new dispatch is inferred from it. Health reports 32 tools and the matching runtime without another Connect click. Private evidence stays in ignored `artifacts/live-0.7.2/` and installation artifacts; no private messages or conversation exports are committed.

The local acceptance manifest credits only the ten read/diagnostic capabilities actually checked here and the two installation platforms. Other capabilities remain pending for this fingerprint; older acceptance is not relabeled. All live actions were reads. No messages, invitations, comments or likes were created or modified. Comment-parent reconstruction remains the separate P2 item. No 0.7.2 Store package was uploaded, no submission was made, and the historical 0.7.1 package, listing and five explainer graphics remain intact.

## Human setup 0.8.0 — 2026-11-01

See [the onboarding implementation and evidence](onboarding-0.8.md): 258 passing tests, macOS/Windows CI, automatic live account recovery after the UI update, and genuine Codex installation plus a fresh-client read. Claude CLI configuration passed; after a repeated 401 and an explicit subscription requirement in the authorization flow, its agent test remains blocked by the Free account’s lack of Claude Code access. Claude Desktop is a separate, unverified setup path. All LinkedIn acceptance remained read-only. The local Store package is a draft with current-runtime capability evidence still incomplete.
