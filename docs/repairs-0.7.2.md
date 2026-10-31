# Inbox identity repair 0.7.2

The remaining P1 in 0.7.1 was a cache-ordering defect: messaging may return `/in/<opaque-member-id>/` as a profile link. Treating that path as a public identifier replaced a working profile association. The next profile lookup discarded its original URN and compared the opaque ID with the actual public identifier. A successful slug lookup temporarily repaired the cache; another inbox read broke it again.

## Identity and cache contract

The shared core identity module distinguishes the normalized profile URN, its internal member ID and a public identifier. A URL component equal to the known URN's member ID, or matching the observed opaque 39-character ACo member-ID format, is not promoted to a public identifier. This is not a general length heuristic. Valid vanity slugs, Unicode identifiers and both observed profile URL field spellings remain supported.

Public participant and sender shapes remain unchanged. `public_identifier` and canonical `profile_url` are null when the public slug is unknown; an exact URN still means `identity_status: resolved`. Callers pass that URN directly to profile, relationship and author-post primitives. No guessed slug or name search is required.

All identity-cache writers now use one merge rule, including API normalization, public read projections, verified profile reads and the exact-participant check before message dispatch. Only an identity-matched profile response promotes a public identifier to verified. Subsequent weaker observations cannot replace or erase that association. Normalized nonempty names may refresh. A newly verified slug can replace an older verified slug; dependent author-post URL hints are discarded on rename.

## Lookup contract

For a URN request, the original URN remains in the internal lookup even when a cached slug is available. The slug is only a lookup hint. The returned profile must match the requested normalized URN uniquely, and its explicit public identifier must be valid. Public callers still supply exactly one of URN or public identifier.

If a hint returns no matching profile or HTTP 404, the reader tries the exact member ID once. At most two profile requests are made. Ambiguous matching candidates, authentication/account errors, cancellation, rate limits and unrecognized source shapes do not trigger a broad fallback. Explicit public-identifier requests continue to require an exact identifier match.

## Upgrade and verification

Version 0.7.2 retains all 32 tools and their public input contracts. A separate one-time identity-cache migration removes old identity entries and temporary cursors, including cached public responses. Account binding, explicit pause, operation receipts and planning state are retained. A worker restart after migration does not repeat the cleanup. Existing MCP processes must use the matching new build; no new Connect click is needed.

The failure-first integration test executes the real built background/page bundles through the full inbox → URN profile/relationship → public-slug profile → relationship → inbox → URN profile/relationship sequence. Further cases cover all five inbox read paths, author-post lookup, worker restart, poisoned cache migration, preserved pause/receipts, conflicting identifiers, renamed slugs and bounded fallback.

Live acceptance is read-only, with the reported inbox person and a second existing inbox person. Private evidence stays in ignored local artifacts. Comment-parent reconstruction is a separate P2 increment and is unchanged here. No Store upload or live message/invitation/comment/like is part of this repair. Store submission still requires fingerprint-matched acceptance; the prepared 0.7.1 Store draft remains historical evidence rather than acceptance for 0.7.2.
