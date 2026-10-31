# Reviewer instructions

Public Chrome extension with a separate Git-installed MCP server for macOS and native Windows. Follow the repository README to clone, install dependencies and build with `npm run build:store`. Register the exact store extension ID using `node dist/cli.js install EXTENSION_ID`. Configure the local MCP client from the printed JSON. There is no bundled installer or signed companion.

1. Install the extension and Git-based server as above, then run `node dist/cli.js doctor`. Use your own account. No credentials are included.
2. Sign in to your own LinkedIn account. Open the extension on that tab, read the data-flow disclosure, acknowledge it and connect. The extension creates a dedicated LinkedIn work tab and brings it forward for UI actions. No account credentials are supplied in the package.
3. Call linkedin_health and verify account, version and companion connectivity. Read conversations and message history using their returned IDs and cursors. History reads must not silently mark a conversation as read.
4. Request a message to an expressly consenting test contact with a unique idempotency key. It executes directly without extension review. Inspect its receipt and LinkedIn UI.
5. Replay the same key and verify there is still only one message. Never resend a receipt marked unknown_outcome with a new key.
6. Test inbox read/archive operations on a named test conversation and restore its original state. These execute directly too.
7. Search people with explicit supported filters, inspect a post, and page reactions/comments. Incomplete scans must be labeled partial. No Sales Navigator or bulk outreach functionality is present.
8. Repeat a consumed cursor and verify an identical page. Navigate or interact with the work tab, then verify the old DOM cursor is rejected explicitly.
9. Pause/disconnect, close the LinkedIn tab, and restart Chrome. Calls must fail clearly rather than attach to another account or tab.

All executable adapters are bundled. No arbitrary URL, selector, JavaScript or native command is accepted over MCP.

Release prerequisite: all capabilities, including deletion, invitation mutations and public text interactions, require runtime-bound per-capability acceptance evidence. All 32 tools are exposed, but availability does not establish live acceptance or store readiness.

Version 0.7 provides native text drafts and scheduling instead of immediate post creation. Verify draft preservation, future-time validation, scheduled listing and cancellation without immediate publication. Any public acceptance comment or reply must be meaningful and relevant to its actual context; never publish technical test labels or placeholders, even temporarily. Arrange cleanup before performing authorized public acceptance.

The five added primitives are `message_get`, `posts_search`, `profile_posts_list`, `relationship_get` and `conversations_find`. They compose with the existing tools; no built-in outreach workflow or CRM is included. Messages use dedicated messaging APIs and exact conversation/participant identities, never the feed's messaging overlay.
