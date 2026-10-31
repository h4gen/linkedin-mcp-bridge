# LinkedIn primitives 0.7.0

This release extends the canonical 0.6 recovery baseline (`c257977`) from 27 to 32 tools. It adds primitives, not an acquisition workflow, lead score, CRM or background index. Store submission is not part of this increment. Existing five explainer assets and listing copy remain intact.

## Read contracts and migration

Conversation/message responses now use explicit allowlists. Conversations retain `entityUrn`, compact participant references, last activity, a 280-codepoint preview, observed category and read state. Messages retain `entityUrn`, `deliveredAt`, sender, text and attachment metadata. List text is at most 1,000 Unicode codepoints. Internal raw API entities remain available to send verification and recovery; public projections happen only after those internal operations.

`message_get(account_urn, conversation_urn, message_urn, text_offset?, max_chars?, text_revision?)` reads only that conversation, using at most three source pages. Recently listed message timestamps are retained as bounded, expiring locators for older-message lookup. No matching result under incomplete coverage yields `message_lookup_incomplete`, never a false absence claim.

`message_get` and `post_get` return `text_revision`, `text_offset`, `next_text_offset`, `total_chars` and `text_complete`. Offsets/counts use Unicode codepoints, default 0/4,000, maximum 8,000. Continuations must echo the revision. Edited source text returns `text_revision_changed`; restart at offset zero. A source-truncated post remains incomplete even if the current window reaches the end of the observed text.

Messages sort newest-first before buffering, with a stable ID tie-breaker. Duplicate IDs are removed before buffering. The timestamp reader overlaps page boundaries; unresolved ties/missing timestamps report partial coverage instead of skipping an ambiguous boundary. Consumed cursors replay the cached projection. The common pagination envelope remains available.

Storage schema 2 clears temporary cursors, identities and projections exactly once. It preserves account binding, explicit pause/disconnection and mutation receipts. Version changes alone do not reset the connection. Restart existing MCP processes for the new tool schema; no new Connect click is required.

## Search, posts and profiles

- `posts_search`: query, sort `relevance|latest`, date `any|day|week|month`, default limit 20, cursor. Filters are selected in the observed UI and checked after application. A fresh initial search clears state not encoded in its URL. Unsupported inputs fail schema validation.
- `post_resolve`: exactly one `scan_key` or HTTPS `www.linkedin.com` feed-update/posts URL. The visible target must supply its own identity; a number in an input URL is not treated as proof. Scan resolution can follow the exact card's native Copy link action and freshly observed toast to its final permalink, checking author and text on arrival. Native `activity`, `share` and `ugcPost` links are supported; quoted links inside post text cannot identify the containing card. Caller-supplied short links must first be resolved to their actual LinkedIn permalink.
- Feed, search, profile posts, resolution and detail share one post projection, including author reference, date precision, source, resolution and full-text access. Company authors are explicitly unresolved as people.
- `profile_get`: exactly one profile URN or public identifier; optional `basic`, `about`, `current_positions`, `location`, default all four. Each section reports availability. Missing/unloaded sections are `unavailable`, not fabricated from the headline.
- `profile_posts_list`: resolves the exact profile and follows its observed “Show all posts” link. Own posts and visible reposts are distinguished; source omissions remain partial.

DOM operations use the existing serialized work tab. Navigation and new DOM traversals invalidate old cursors. Only API readers may receive bounded transport replay; DOM traversals and writes are never automatically replayed.

## Relationships and exact conversations

`relationship_get` combines verified top-card state and exact profile matches in bounded received/sent invitation pages. It returns `connected`, `outgoing_pending`, `incoming_pending`, `not_connected` or `unknown`, with observation time/evidence. Missing invitations never prove acceptance. Contradictory evidence returns unknown. Messaging permission is separate and requires its own observed control.

`conversations_find` defaults to Inbox and Archive; Spam is opt-in. It checks at most three pages of 20 conversations per call. Only exact one-to-one participant matches qualify, after removing the connected account. Group conversations, unresolved peers and namesake matches do not qualify. Cursor state includes category position, source cursor, buffer and deduplication. Multiple conversations are returned together. Zero matches under partial coverage never means no conversation exists.

## Comment replies and receipts

`post_comment` accepts optional `parent_comment_id`. Existing root-comment calls retain their input and idempotency hash. A parent changes the target/hash. Only stable source IDs can be used, scoped to the exact post; lookup is bounded. Missing, session-only and duplicate IDs fail before submission. The exact reply control opens its editor; no general-comment fallback exists.

SDUI can render an editor in a sibling row. The adapter accepts only the newly opened editor between the selected comment and the next comment. Post-send confirmation waits for delayed rendering and requires a unique new comment ID, the connected author, text and a proven parent relation. For flat rows, the exact reply's native Copy link action supplies a fresh permalink: `dashCommentUrn` identifies the parent and `dashReplyUrn` identifies the reply. Both must match the observed native post identity; the reply's text and author are checked again on the destination document. Pending navigation and the old completed document never count as arrival. If proof is unavailable, the receipt stays `unknown_outcome`, includes an observed reply ID and bounded verification reason when available, and cannot be automatically resent. Receipt lookup survives restart.

## Source observations (2026-10-31)

Read-only browser checks established:

- Content search's visible sort choices: Top Match and Latest. Date choices: Past 24 hours, Past week, Past month; Reset clears the filter. Applied state is represented by checked “Filter by …” controls, not query parameters.
- Profile top cards expose an exact Contact info route and a message-compose link carrying the profile URN. About paragraphs and the observed recent-activity/all link are available. Experience appears only after scrolling in the sampled profile. The adapter performs at most four bounded scroll steps, then reads role/company/date context from that section. Missing sections remain explicitly unavailable.
- SDUI comments use `replaceableComment_urn:li:comment:(ugcPost:…,…)` component keys. The permalink post and comment rows share a `pagedCommentsContainer`; comments and reply editors can be siblings. Flat replies do not, by themselves, prove their parent.
- The native reply permalink exposes distinct parent/reply identifiers. Live acceptance confirmed their match to the submitted reply; unit tests reject exchanged IDs, mismatched posts, foreign hosts and missing parent parameters.
- The user-supplied short post URL resolves to a feed-update activity page; the original content can have a different ugcPost identity than the repost activity URL. Resolution uses the page's scoped source identity.

Tests contain synthetic/anonymized equivalents of these structures. Private message bodies, live account identifiers and browser payloads are not checked into the repository. Live evidence remains in ignored local artifacts.

## Acceptance boundaries

Required gates remain `npm run check`, `npm run format:check`, `npm run release:check`, plus store build/package and `npm run store:check`. The expected 32 names are listed independently in a test. Store acceptance still requires current-fingerprint capability evidence and macOS/Windows installation evidence; missing proof is a blocker, not a waived check.

Public comments and replies must be meaningful in their actual context, including during acceptance; see `AGENTS.md`. Technical placeholders are forbidden even with planned cleanup. Live comment/reply confirmation and same-key replay have been exercised, and all public acceptance comments have been removed. A requested direct message and a personalized invitation have been sent once each. The recipients' actual response/acceptance remain external dependencies. Evidence retains its actual runtime fingerprint; receipt replay on a later build is not relabeled as a new dispatch on that build. See `docs/validation.md` and the ignored local acceptance manifest for the exact release state.
