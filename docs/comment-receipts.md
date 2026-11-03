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
