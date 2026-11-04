# Comment receipts — 0.8.3

## Failure and repair

The 0.8.2 adapter compared DOM text exactly with the supplied payload. LinkedIn can collapse paragraph breaks or render a URL as a shortened anchor. Its eight 800 ms confirmation polls could also expire before a new comment appeared. `operation_get` had reconciliation for messages, deletion and planning, but none for comments. The whitespace regression and read-only reconciliation regression both fail against the old adapter.

0.8.3 prepares and persists a content-free comment proof before dispatch: exact post, verified account profile URL, normalized text SHA-256, visible pre-existing comment IDs (bounded to 500), and observation time. Only presentation whitespace is collapsed. Native link destinations may restore shortened URL labels; unrelated destinations, punctuation and case remain distinct. An incomplete expanded-text body is not proof. Comment authors must come from their own metadata, not a mention in the body or a nested reply.

The immediate verification waits at most 15 × 800 ms, bounded by the operation deadline. A matching result requires one stable new comment ID, the exact scoped post, actor and text hash. Parent replies still require parent identity; no fallback to a root comment is introduced. The same-key path and operation_get perform read-only reconciliation, persist a confirmed receipt and never call an editor or submit control. No matching result or multiple matching candidates remains unknown. No arbitrary scan, background polling or new message-body archive is added.

## Observed source contract and conservative freshness

Native compound IDs of the observed form `replaceableComment_urn:li:comment:(activity:<post>,<id>)` encode Unix milliseconds in the high bits (`BigInt(id) >> 22`). This is an inference from observed source identities, not a promised LinkedIn API contract. In the reported 2026-11-03 event, comment ID 7523339271555158016 decodes to 11:04:19.223 UTC; the original operation receipt was created at 11:04:16.142 UTC and the independent publication report places the action at 11:04 UTC. No private conversation content is included here.

This time signal is an additional requirement, never sufficient proof alone. The ID must not be in the persisted baseline, its encoded time must be at or after the pre-dispatch observation and no more than two minutes after it, and must not be in the future. Older identical comments, unsupported ID formats and inconsistent clocks fail closed. This also excludes an older comment that was not loaded in the preflight viewport. Account, exact post, normalized content and unique candidate checks remain necessary. Unknown formats require a new source contract rather than treating any text match as a send receipt.

Legacy 0.8.2 receipts lack the pre-dispatch proof. They report `legacy_comment_proof_missing` and retain their unknown status; existing evidence is not invented after the fact. In particular, the reported Todd publication must not be repeated to repair its receipt.

## Live acceptance discipline

Only the three user-authorized Alex, Dotun and Sophie payloads/keys may be used, each for at most one publication. Health, freshly resolved post and existing comments are checked first. Receipts and independently read comments are recorded locally, one case at a time. Unknown results permit only reading. No replacement key, delete/repost cycle or additional public test comment is allowed. Full payloads and live artifacts stay in ignored local artifacts; this document is the source and verification contract.

Store version remains 0.8.2 until a separate 0.8.3 package is submitted and approved. A Git commit or locally activated development build does not update Store installations.

## Live finding: collapsed SDUI bodies

The first live candidate exposed another verification gap: SDUI retained an `aria-hidden="true"` `button[data-testid="expandable-text-button"]` inside the exact comment's `data-testid="expandable-text-box"`. The complete source text and link were present, but the proof reader correctly rejected the still-collapsed body. Clicking the native “... more” control removed it and exposed the full body; the separate link-preview card was outside the body.

The final adapter opens that observed read-more control only after matching a fresh comment ID and the verified actor. It opens each candidate at most once, with at most 20 candidates per bounded verification call, and retains cancellation/deadline checks. It never clicks an editor or submit control during reconciliation. The subsequent pass still requires the full normalized text hash, unique candidate, scoped post and parent constraints. Older identical comments and foreign authors are not expanded. An observed disabled root Comment button now returns `post_comments_disabled` before dispatch, rather than a misleading missing/ambiguous-control error.

## Verification record — 2026-11-03

The final executable correction is integrated on canonical `main` at `cc4815e3dcaac77dcea3e16ed43ed36cb8abc865`. Runtime fingerprint: `f1be0d8053f7bd988749b411e32c12fa946f2c340a1e95469d1a54ee9bd061fa`. `npm run check` passes 274 tests; formatting and local release checks pass. [CI run 41652507521](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41652507521) passes on macOS and Windows, including built settings UI, installation and native transport smoke. Regression-before logs reproduce both the collapsed-body failure and the missing disabled-comment diagnosis. Original tests remain present; additional negative checks cover old comments, other authors and link-preview text exclusion.

The initial live runtime was `1eb87db1d6906f62fd6f379e381756314f6380885a07a185a9ae9e57c55acf47`. Case 1 failed before dispatch: the target permits comments only from connections, as confirmed in the UI. Case 2 published once and its full text, link and author were independently read, but its receipt remained unknown due to the collapsed body. It must be reconciled read-only after activating the correction; no repeat send is permitted. Case 3 remains unattempted until that result is evaluated. Exact keys, receipts, comment ID and full returned text are in local `artifacts/comment-receipts-0.8.3/live-summary.json` and the per-case JSON evidence. Earlier evidence is not relabelled as the final runtime.

The final development bundle is built at the existing extension path. A durable 0.8.3 server is prepared and registered, and only the LinkedIn executable path in Codex configuration changed; unrelated configuration bytes are identical. Activation of the final correction still awaits one extension reload. Browser automation's security policy rejected access to Chrome's extension-management page; no alternative route was used to bypass it. Each case has an exclusive local send marker and immutable payload file; an existing marker forbids another send.

The updated pilot ZIP is prepared locally at `artifacts/store-0.8.3/linkedin-extension.zip`, SHA-256 `2df78ec20946a3c2376357931905eb0b290780159b8375865a3c8136cf8a00cd`. The initial ZIP is retained separately under `initial-42e4afc/`. Neither package has been uploaded or submitted. Current-runtime capability evidence remains outstanding; the Store gate is not waived. Store text, five explainers, public 0.8.2 metadata and its immutable release are retained.

### Continuation check — 2026-11-04

The local transport responds but the extension still identifies the initial runtime fingerprint (`1eb87db1…`). Health reports `work_tab_create_failed`; the computer-use inventory separately reports that the Mac is locked. No additional public action was attempted. The final build (`f1be0d80…`) still needs activation before read-only reconciliation of case 2 and the single permitted case-3 send. The user has been asked to unlock the Mac and reload the existing development extension. This is an activation/live-acceptance blocker, not a failed automated test.

### Recovery and visible build identifier — 2026-11-04

Canonical source now includes `1e5938c` (verified post URL retained in the durable pre-dispatch proof, plus bounded Most recent selection) and `f59f736` (the observed menu label structure and visible build identification). The active candidate fingerprint is `cf4b6fce2a3509ae4d5866a1b5574dadd67060045a5df774e74606b7d0ad91b8`; both its development and Store builds display `0.8.3 · build cf4b6fce`. Chrome receives this through `version_name`, and the setup page displays the same value outside Advanced settings. The build suffix derives from executable-source contents; rebuilding unchanged sources keeps it stable. Release validation rejects a stale visible identifier. This uses Chrome's [documented display-version field](https://developer.chrome.com/docs/extensions/reference/manifest/version).

All 277 tests, formatting, release consistency and built settings UI checks pass locally. The restart integration tests execute the actual background/page bundles with empty session storage, accept the stored verified post URL, reject a URL for another post and persist a confirmed receipt without another send. The sort fixture reproduces the observed separate paragraph labels (`Most recent` followed immediately by its description), rather than assuming a whitespace boundary in textContent. The final CI run is [41811595407](https://github.com/h4gen/linkedin-mcp-bridge/actions/runs/41811595407); both macOS and Windows jobs pass, with their results independently recorded in local evidence.

During the resumed live check, the earlier `0310a3aa…` build correctly preserved one dispatch but reported `comment_sort_unavailable`. Read-only DOM inspection proved the menu-text mismatch, now repaired. Dotun remains one published comment with an unresolved receipt pending activation of `cf4b6fce`; Sophie remains unattempted. The old Dotun proof predates durable post-URL storage, so its first recovery still resolves the original verified URL before `operation_get`. New proofs retain that URL before dispatch. No receipt has been manually rewritten and no write replay has occurred.

The current local Store candidate ZIP is `artifacts/store-0.8.3/linkedin-extension.zip`, SHA-256 `3c5e0074986fbde303d6373834d43dedea3ee859da0317dcb057ef312e465a3e`. Earlier ZIPs and original-fingerprint evidence remain separately preserved. Store 0.8.2 is unchanged; this candidate has not been uploaded or submitted.
