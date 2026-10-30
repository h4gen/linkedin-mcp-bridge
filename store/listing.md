# LinkedIn MCP Bridge

Connect your LinkedIn inbox and professional research to a local MCP-compatible AI client on macOS or Windows.

Review conversations and message history, search your inbox, and manage read or archive status. Requested writes execute directly through the connected account without extension confirmation. Research people, feed posts, comments and reactions through bounded, paginated reads. LinkedIn can limit or hide results; this tool does not promise complete lead lists.

Requires: macOS or native Windows, Chrome, a Git-installed local MCP bridge, a supported local MCP client, and your own signed-in LinkedIn session. This is not a direct connector for ChatGPT's website. Sales Navigator, attachment uploads and automated outreach campaigns are not included.

Requested LinkedIn content passes through the local MCP bridge to your configured MCP client. That client may transfer it to its AI provider. We do not operate a cloud relay or collect product telemetry. You can pause, disconnect and clear local data.

Independent software, not affiliated with or endorsed by LinkedIn.

Install the local server: https://github.com/h4gen/linkedin-mcp-bridge

Single purpose: let users access and manage their own LinkedIn workflow through their chosen local MCP client, with visible controls over outbound actions.

## Permission justifications

- storage: selected account/tab, temporary pagination, and content-free idempotency receipts.
- scripting: packaged adapters read and operate the selected LinkedIn tab; no caller-supplied JavaScript.
- nativeMessaging: communicates with the independently installed local MCP bridge.
- alarms: expires temporary data and reconnects the local MCP bridge.
- https://www.linkedin.com/*: authenticated operations on the user's explicitly connected LinkedIn tab only.

No cookies permission, all-sites access, debugger access, externally_connectable endpoint or remote executable code.
