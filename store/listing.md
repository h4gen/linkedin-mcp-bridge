# LinkedIn MCP – AI Connector for Claude & Codex

## Short description

Connect LinkedIn to Claude & Codex: manage your inbox, research posts and people, check connections, draft and schedule posts.

## Detailed description

Bring LinkedIn conversations, people and posts into Claude Code, Codex and other local MCP-compatible AI clients. Give your agent the context to research a person, pick up an earlier conversation or prepare your next post, with less copying between tabs.

This Chrome extension connects your signed-in LinkedIn account to a separately installed LinkedIn MCP server. Its 32 tools work together; you choose the task and your agent combines the steps.

MANAGE YOUR INBOX WITH CONTEXT
Find conversations by participant, title or preview, or find the exact personal chats for a profile, including archived conversations. Read recent messages and older history, retrieve long message text, send replies, and manage read or archive status. History reads leave the read status unchanged. Conversation search is not a full-text search of all message bodies.

FIND RELEVANT POSTS AND THE PEOPLE BEHIND THEM
Search LinkedIn posts by topic, sort by relevance or newest, and use supported date filters. Open a post from its link, read the available text beyond the preview, and explore comments and reactions. Follow returned author, commenter and reactor references straight to their profiles. Continue through available result pages instead of stopping at the first few hits.

UNDERSTAND A PERSON BEFORE YOU REACH OUT
Search people and read their background, current positions, location and recent posts. Check available connection and invitation status, then find previous personal conversations. Ask your agent to bring that context together before a meeting, a reconnection or a personal reply. Send and manage invitations, or react and comment on selected posts when requested.

PREPARE AND SCHEDULE TEXT POSTS
Create native LinkedIn text drafts, schedule posts for later, inspect scheduled posts and cancel a scheduled post. Your agent can turn research or your own notes into a draft. There is no immediate-publish tool.

For example, ask your agent to:

- Find recent posts about a topic, read the comments and research a relevant participant.
- Check how you are connected to a person and read your earlier conversation before preparing a reply.
- Turn your notes into a LinkedIn text draft and schedule it for your chosen time.

These are tasks your agent can compose, not built-in campaigns or a CRM. Reads are bounded and paginated. Unavailable profile sections, uncertain relationship states and incomplete results are identified; missing results are not proof that nothing exists. There is no always-on reply monitoring or automatic outreach sequence.

SETUP AND CONTROL
Requires macOS or native Windows, Chrome, Node.js 22+, the Git-installed local MCP server, a supported local MCP client and your own signed-in LinkedIn session. On first install, a setup page lets you copy instructions into Codex or Claude Code. Your agent installs the matching local server and configures the connection for you. Sign in to LinkedIn if needed; the extension connects automatically. This is not a direct connector for ChatGPT's website. Sales Navigator and attachment uploads are not included.

The extension settings let you pause or disconnect. Once connected, it can recover its work tab and local connection while Chrome is running. It preserves an explicit pause or disconnect. Requested writes execute directly through the connected account without an extension approval queue; operation receipts help avoid duplicate sends after interruptions.

Requested LinkedIn content passes through the local MCP bridge to your configured MCP client. That client may transfer it to its AI provider. We do not operate a cloud relay or collect product telemetry. You can pause, disconnect and clear local data.

Install the local server: https://github.com/h4gen/linkedin-mcp-bridge

Independent software, not affiliated with or endorsed by LinkedIn.

## Single purpose

Let users read and manage their LinkedIn conversations, professional context and text posts through their chosen local MCP client.

## Permission justifications

- storage: selected account/tab, temporary pagination, and content-free idempotency receipts.
- scripting: packaged adapters read and operate the selected LinkedIn tab; no caller-supplied JavaScript.
- nativeMessaging: communicates with the independently installed local MCP bridge.
- alarms: expires temporary data and reconnects the local MCP bridge.
- https://www.linkedin.com/*: authenticated operations on the user's explicitly connected LinkedIn tab only.

No cookies permission, all-sites access, debugger access, externally_connectable endpoint or remote executable code.
