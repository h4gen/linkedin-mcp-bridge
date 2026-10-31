# Read primitive repairs 0.7.1

This increment repairs the four issues reported against 0.7.0. It retains the same 32 primitive tools and all existing input contracts. It adds no workflow, approval step, background poller or new write operation.

## Post handoff (LI-01)

`post-context.ts` owns source-backed identity and target scope for resolution, post reading, comments, reactions and existing comment/like targets. Native `/posts/` links and observed activity/share/ugcPost aliases are supported. Canonical URLs are cached for observed aliases. Quoted links inside post text and independently authored embedded cards do not establish their surrounding card's identity. Nested containers for one card collapse; independent matches fail closed.

The adapters ship in a static `page-adapters.js` extension bundle. Background injection pins invocation to the document that loaded that bundle. MCP callers cannot supply executable code or selectors. Missing, ambiguous and loading targets now return `post_target_not_found`, `post_target_ambiguous` or `post_target_loading`, with bounded candidate/match counts. Empty visible comment results remain partial; they do not prove the source has no comments.

## Search continuation (LI-02)

A search session starts before filter application but binds its final route and effective filters only after the controls confirm them. Cursor state includes the tab, Chrome document ID, per-document token, session token, route and filters. Storage round-trips may reorder object properties, so filter equality compares values independently of property order.

Validation runs before cached cursor replay. Document/tab changes, another DOM traversal, trusted interaction, changed route, missing session markers and changed filters remain invalidations. API-only reads can run between pages. Old cursor contexts without the versioned binding must restart their query. No account, pause or receipt migration is needed.

Public errors preserve an allowlisted `reason` such as `document_changed`, `path_changed`, `filters_changed` or `user_interaction`. They never export raw DOM, route query strings or session tokens.

## People in messaging responses (LI-03)

A shared person projection normalizes full, first and last names as strings or source text objects, including mixed/empty/Unicode fields. Participant, sender, profile and identity-cache paths use it. Both observed `profileUrl` and `profile_url` fields are accepted only for supported LinkedIn profile URLs. Names are never converted into guessed profile slugs or used as identities.

The five public primitives `conversations_list`, `conversations_find`, `conversations_get`, `messages_list` and `message_get` are exercised through the engine. Reads continue to use the dedicated messaging API and exact conversation IDs; they do not open the feed chat overlay or mark a thread read.

## Relationship evidence (LI-04)

`relationship_get` now also returns `connection_degree`, `messaging_evidence`, `action_scan`, `invitation_scan` and a `reason`. Degree, pending invitation, Connect availability and messaging affordance are separate observations. `messaging: allowed` with a compose-link observation means the UI offers the route, not that a test message was sent.

Actions are scoped to the verified profile top card, including one owned More menu when needed. An already open menu is not taken over. Each invitation direction scans at most three pages of 20 entries; exact profile IDs establish matches. The response reports pages, checked count, completeness, match status and stop reason, including source failure or the page limit.

Positive first-degree evidence establishes a connection. Positive invitation evidence establishes pending state. Connect plus exhausted invitation scans can establish `not_connected`. Missing evidence, conflicting observations and incomplete exclusion scans remain `unknown` with an explanation. A disappeared invitation never establishes acceptance.

## Verification and release scope

The regression suite executes the actual built background and page bundles against a deterministic DOM and Chrome-storage fixture. It covers native post handoff, engagement pagination/replay, six search filter combinations over three pages, storage property reordering, intervening API reads, invalidation, restricted profiles, owned More menus, invitation scan limits/conflicts, and public name projections. Existing recovery, account checks and write receipts remain covered.

Live validation in this increment is exclusively read-only. Private evidence remains under ignored local `artifacts/live-0.7.1/`. The Store package is a local draft. Current capability and both platform installation proofs remain required by `store:check`; historical writes are not relabeled for the new fingerprint. See `validation.md` for completed live checks and remaining submission gates.
