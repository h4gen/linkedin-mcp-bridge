# LinkedIn MCP interface contract

## Decisions for the 0.2 pilot

Use narrow resource tools: `*_list`, `*_get`, `*_search`, and explicit mutations. The agent should not operate a generic browser or guess URLs. Account identity is required on every account operation. Page and message text is untrusted data, never instructions.

### Reads: cursor pages first

`comments_list` and `reactions_list` are the primary interfaces. Both accept `account_urn`, `post_urn`, `limit`, and an optional opaque `cursor`, just like history, feed and search. Collection jobs are optional convenience wrappers over these same readers, not a separate extraction mechanism.

List responses preserve `items`, `next_cursor`, and `partial` and add `page_info`:

```json
{
  "items": [],
  "next_cursor": null,
  "partial": true,
  "page_info": {
    "returned_count": 0,
    "requested_limit": 20,
    "continuation": "unavailable",
    "coverage": "partial",
    "consistency": "live_traversal",
    "reason": "linkedin_may_rank_or_hide_comments",
    "cursor_expires_at": null
  }
}
```

- `next_cursor` means another bounded traversal can be attempted, not that another record is guaranteed. A short or empty page alone is not an end-of-data signal.
- `coverage` is `partial`, `complete_for_query`, or `unknown`. Complete applies only to the requested source/query, never all LinkedIn data. No cursor does not imply completeness.
- Keep all arguments identical while continuing, including page size and filters. Cursors are bound to account, operation and arguments, expire after 30 minutes, and live in session storage. Invalid/expired cursors fail explicitly; restart the query to refresh.
- Retrying a consumed cursor returns its cached page until that cursor expires; it does not scroll again. The next cursor has its own original expiry, which is not extended by replay. The first request without a cursor is a fresh read, not an immutable snapshot.
- New/deleted/reordered LinkedIn data can change subsequent pages. There is no snapshot guarantee. Use stable IDs to merge results; preserve deduplication bounds and distinguish unavailable fields from empty values.
- Comment IDs are used when exposed; the current fallback is a synthetic profile/text key and can collapse identical repeated comments. A null parent ID means unknown, not necessarily a root comment. Reaction actors are deduplicated by profile URL. Full reply trees and complete engagement totals are not promised.
- UI-based reads may open dialogs, scroll, and load more results. They do not publish content; profile reads may count as visits.

### Jobs: optional bounded collection

`extraction_start` creates a local job over the same cursor reader; it is not idempotent and must not be automatically retried after an ambiguous response. `extraction_get` reads append-only stored results with offsets. Offsets are appropriate here because this is a bounded local result array, unlike a changing LinkedIn list. `extraction_cancel` stops between source pages. Partial source coverage remains partial even when the job stops normally. There is no background monitoring or unlimited crawl.

### Writes: explicit intent and receipts

The pilot enables plain-text `message_send` and `conversation_update` only. Send arguments identify the exact account, target, expected recipients, text, and idempotency key. A pending preview is not a sent message. Confirmation belongs in the extension UI, bound to the exact payload. The UI executes the approved mutation once; the agent reads `operation_get` to reconcile. An unknown outcome must never trigger a fresh key/re-send. Inbox changes can use the explicit local inbox permission; default is review.

### Follow-up interface work before broad release

Keep this backward-compatible pilot contract while validating it. Next priorities are per-tool output schemas and machine-readable error recovery (`retry_after`, safe retry vs reconcile), capability status distinguishing enabled/verified/degraded, explicit source/order metadata, and typed identity quality for synthetic comment IDs. Do not expose guessed sort/filter controls until the adapter and live acceptance support them. Long-running extraction still needs a reliable repeated live acceptance run; cursor metadata does not fix source loading failures.
