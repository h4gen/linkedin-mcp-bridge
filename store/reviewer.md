# Reviewer instructions

This is a macOS-only unlisted beta with a separate Native Messaging companion. The Chrome ZIP alone does not include or install a native executable. Use the matching signed companion and store extension ID from the release manifest. Do not use the development extension ID.

1. Install the extension and companion. Run Setup.command as the current user after placing the companion folder in a durable location. Configure a local STDIO MCP client with the bundled node and cli.js paths from README.txt.
2. Sign in to your own LinkedIn account. Open the extension on that tab, read the data-flow disclosure, acknowledge it and connect. The extension creates a dedicated LinkedIn work tab and brings it forward for UI actions. No account credentials are supplied in the package.
3. Call linkedin_health and verify account, version and companion connectivity. Read conversations and message history using their returned IDs and cursors. History reads must not silently mark a conversation as read.
4. Request a message to an expressly consenting test contact with a unique idempotency key. The MCP response must be approval_required and no message should be sent. Open Review actions, inspect content and account, then reject it. No message should be sent.
5. On a second approved test draft, confirm the exact destination/text. Inspect its receipt and LinkedIn UI; replay the same key and verify there is still only one message. Never resend a receipt marked unknown_outcome with a new key.
6. Test inbox read/archive operations on a named test conversation and restore its original state. Individual approval is the default; the checkbox grants only reversible inbox operations.
7. Search people with explicit supported filters, inspect a post, and page reactions/comments. Incomplete scans must be labeled partial. No Sales Navigator or bulk outreach functionality is present.
8. Repeat a consumed cursor and verify an identical page. Navigate or interact with the work tab, then verify the old DOM cursor is rejected explicitly.
9. Pause/disconnect, close the LinkedIn tab, and restart Chrome. Calls must fail clearly rather than attach to another account or tab.

All executable adapters are bundled. No arbitrary URL, selector, JavaScript or native command is accepted over MCP. Review decisions are accepted only from the extension's own pages, not from MCP or LinkedIn content.

Known platform limitation: LinkedIn prohibits scraping/automation. Reviewability and Google approval do not resolve that separate platform restriction.

Release prerequisite: all original basic capabilities, including deletion, invitation mutations and public text interactions, require per-capability acceptance evidence. The current development build deliberately omits seven unaccepted write tools; it is not a complete store pilot.
