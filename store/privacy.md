# Privacy notice — LinkedIn MCP – AI Connector for Claude & Codex

Project: https://github.com/h4gen/linkedin-mcp-bridge. Questions and support: https://github.com/h4gen/linkedin-mcp-bridge/issues.

## Data and purpose

On your request, the extension accesses LinkedIn account identity, conversations, message contents and attachment metadata, professional profile information, search results, posts, comments and reactions. It uses these to provide inbox management and professional research in your configured MCP client. Browser authentication remains inside the LinkedIn page; cookies, passwords and CSRF credentials are not exported to the local MCP bridge or AI client.

## Recipients

Requested results travel from the LinkedIn tab through Chrome Native Messaging and a private local socket to your chosen MCP client. That client's provider may process the data under its own terms. The extension does not operate a cloud relay, advertising service, analytics service or data resale service. Requested outgoing messages are transmitted to LinkedIn and their intended recipients.

## Storage and controls

The selected account/tab remains locally until disconnected or cleared. Temporary pagination state expires after 30 minutes and is removed during periodic cleanup; session storage also clears when Chrome ends the session. Content-free mutation receipts are retained locally for seven days. Results already delivered to the MCP client are governed by that client's retention policy and are not erased by clearing the extension.

Pause stops new operations; it cannot undo a request already dispatched to LinkedIn. Disconnect removes the binding. The extension popup can clear local data; clearing receipts also removes duplicate-send protection for previous operation keys. Uninstalling the extension removes its Chrome storage. The separate local MCP bridge can be unregistered and removed independently.

## Limited use and security

Data is used only for the disclosed user-facing purpose, not sold, transferred for advertising, or used for credit decisions. Handling of user data complies with the Chrome Web Store User Data Policy, including Limited Use. No product telemetry is collected. Support diagnostics must exclude message bodies, credentials and unrelated profile content. Do not provide such content unless you specifically intend to share it with support.

The local MCP bridge is accessible to processes running as your operating-system user. This local trust boundary is not protection against a compromised computer or a malicious MCP client. All implemented write operations execute directly when requested by the connected MCP client. The extension does not ask for confirmation. Account/target validation and seven-day idempotency receipts protect against mismatched targets and duplicate requests.
