# Privacy notice — LinkedIn MCP Bridge pilot

Publication draft. Operator, contact and hosted policy URL must be filled in before submission; see release.json.

## Data and purpose

On your request, the extension accesses LinkedIn account identity, conversations, message contents and attachment metadata, professional profile information, search results, posts, comments and reactions. It uses these to provide inbox management and professional research in your configured MCP client. Browser authentication remains inside the LinkedIn page; cookies, passwords and CSRF credentials are not exported to the companion or AI client.

## Recipients

Requested results travel from the LinkedIn tab through Chrome Native Messaging and a private local socket to your chosen MCP client. That client's provider may process the data under its own terms. The extension does not operate a cloud relay, advertising service, analytics service or data resale service. User-confirmed outgoing messages are transmitted to LinkedIn and their intended recipients.

## Storage and controls

The selected account/tab and reversible inbox permission remain locally until disconnected or cleared. Temporary pagination state and approval drafts expire after 30 minutes and are removed during periodic cleanup; session storage also clears when Chrome ends the session. Rejected drafts lose their content immediately. Content-free mutation receipts are retained locally for seven days. Results already delivered to the MCP client are governed by that client's retention policy and are not erased by clearing the extension.

Pause stops new operations; it cannot undo a request already dispatched to LinkedIn. Disconnect removes the binding. The review page can clear local data; clearing receipts also removes duplicate-send protection for previous operation keys. Uninstalling the extension removes its Chrome storage. The separate companion can be unregistered and removed independently.

## Limited use and security

Data is used only for the disclosed user-facing purpose, not sold, transferred for advertising, or used for credit decisions. Handling of user data complies with the Chrome Web Store User Data Policy, including Limited Use. No product telemetry is collected. Support diagnostics must exclude message bodies, credentials and unrelated profile content. Do not provide such content unless you specifically intend to share it with support.

The companion is accessible to processes running as your macOS user. This local trust boundary is not protection against a compromised computer or a malicious MCP client. Outbound and destructive actions require a content-bound review in the extension; public writes and deletion are disabled in this pilot pending acceptance.
