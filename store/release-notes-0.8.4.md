# LinkedIn MCP 0.8.4

Prepared Chrome Web Store update from 0.8.3. Not uploaded, submitted or published.

## Changes for users

- Comment on a selected post or reply to a specific comment as your personal profile or an available company Page. Ask the agent to list the available authors and choose one for that comment.
- Improved comment confirmation, including comments on document posts that use LinkedIn's `ugcPost` identities. Existing uncertain receipts can be checked without sending again.
- More reliable native account selection, including delayed picker contents and saves. Opening a comment editor no longer aborts a request merely because LinkedIn emits a navigation event for the unchanged URL.
- Improved verification of free first messages and exact recipient conversations, with receipt recovery after interruptions.
- Improved paginated reaction reads and recovery from slow work tabs. Workspace settings offer a background tab or a separate window; independent platform focus acceptance is still pending.

## Upgrade and reviewer notes

Requires the matching 0.8.4 local server, Node.js 22+, Chrome and a local MCP client. Use the extension's copied update instructions, which reference immutable source tag `v0.8.4`. The extension ZIP does not install the server. The currently published 0.8.3 extension continues to use `v0.8.3` until updated.

No additional browser permissions or data categories are introduced. The privacy policy, icon, five gallery explainers and two promotional images are retained. Replace the package and detailed listing text; use the updated reviewer instructions in `store/reviewer.md`.

Automated checks and observed functional results are recorded separately from submission acceptance. The release remains subject to `npm run store:check`; missing platform/workspace and current-runtime capability evidence must not be marked passed. Do not publish test placeholders or perform new LinkedIn writes to satisfy a release checklist without a separate, concrete user request.
