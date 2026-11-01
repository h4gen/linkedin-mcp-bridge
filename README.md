# LinkedIn MCP – AI Connector for Claude & Codex

Bring your LinkedIn inbox, people research and posts into your AI agent. Find earlier conversations, understand a person before replying, and prepare or schedule text posts.

**0.8.1 — public Store installation is not available yet.** The listing is a draft. The setup below is the public-release flow; local testers can use the separate development instructions. macOS and native Windows are supported with Chrome, Codex or Claude Code.

## Start with the Chrome extension

1. Install the extension when its Store release is available. It opens a setup page automatically.
2. Choose **Codex** or **Claude Code**, click **Copy setup instructions**, and paste into your agent.
3. Let your agent install and configure the local server. Sign in to LinkedIn if asked. The extension connects automatically.
4. Continue in your agent. If it has not loaded the new tools yet, start a new chat or restart the client as instructed.

No terminal commands, JSON editing, extension-ID lookup or Connect button are needed from you. Click the extension icon whenever you want settings or help.

## Starting from this repository?

Give your agent this request:

> Install LinkedIn MCP from https://github.com/h4gen/linkedin-mcp-bridge for the AI client I'm using. Read docs/INSTALL_AGENT.md and store/release.json first. Use the version that matches the installed Chrome extension, or the published Store version if I don't have the extension yet. Preserve my other MCP servers. Verify the setup with read-only checks, and tell me any remaining sign-in or client-restart step.

The agent checks Store availability and gives you the exact extension link when it is published. If you already installed the local server, the extension detects it and skips that step. The Store ID is `pibhcinkiadfplcaefllaeappkpnpfjm`; an assigned ID alone does not mean the listing is published.

## What you can ask your agent

- Find a person's earlier conversations, read long messages and prepare a reply with context.
- Search posts about a topic, explore comments and reactions, then research the people involved.
- Check profiles, author posts and connection or pending-invitation status.
- Save a native text draft, schedule a post or cancel a scheduled post.

The agent combines 32 individual tools. There are no built-in campaigns, lead scores, CRM records or always-on reply monitoring. Results can be partial; your agent can request further available pages. No direct ChatGPT website connection is included.

## Settings and troubleshooting

The extension icon opens the same simple setup/settings page. It shows the next useful step: let your agent finish setup, sign in to LinkedIn, resume a deliberate pause, or copy repair instructions. Recovery is automatic while Chrome is running. A changed account is never silently substituted.

Settings contain Pause/Resume and setup instructions for another agent. Advanced settings contain Disconnect, local-data clearing, uninstall instructions and content-free diagnostics. Clearing local data also clears saved duplicate-send protection.

For updates, copy the current extension's instructions to your agent. It installs the matching Git release, not arbitrary latest main. To remove the product, use **Copy uninstall instructions** in Advanced settings; remove the extension separately through Chrome.

## Data and actions

Your agent receives the LinkedIn content you request and can perform requested actions. Its AI provider may process that content. LinkedIn credentials stay in Chrome; there is no hosted relay or product telemetry. Writes execute directly without an extension approval queue. [Data and privacy](store/privacy.md).

## For agents and local testers

- [Exact installation, repair and uninstall instructions](docs/INSTALL_AGENT.md)
- [Tool contracts, behavior and development reference](docs/REFERENCE.md)
- [Validation and current limitations](docs/validation.md)
- [Store draft status](store/SUBMISSION.md)

Before publication, local testers build the selected candidate with `npm ci` and `npm run build`, load `dist/extension` through Chrome's **Load unpacked**, then use that extension's copied instructions. Register its actual ID with `node dist/cli.js install EXTENSION_ID`. Do not use the assigned Store ID for an unpacked build. A development build and a Store/pilot build use separate native registrations.

The repository's instructions are sufficient for a local agent to handle shell work. The human still completes account sign-in and any client/OS permission prompt that requires personal interaction. Store submission and real platform acceptance are tracked separately from automated tests.
