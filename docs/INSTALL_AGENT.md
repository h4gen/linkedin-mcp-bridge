# Install LinkedIn MCP for the user

This is the canonical installation contract for a local **Codex or Claude Code** agent on macOS or native Windows. The user should only paste your setup instructions, sign in to LinkedIn when necessary, and restart their client if it cannot reload its configuration. Do not require terminal commands, JSON editing, extension IDs or a Connect click from the user. Respect your client's permission controls.

## Inputs and prerequisites

Use the exact release, build channel and extension ID in the copied extension instructions. A release is an immutable `v<version>` tag; an explicitly supplied full candidate commit is also valid for pre-release acceptance. Do not substitute current `main`. If the requested ref is absent, stop with that precise failure rather than silently installing a different version.

If the user started from Git and has no extension yet, read `store/release.json` on the repository's canonical branch. `published_version` identifies the version actually available in the Chrome Web Store. If null, explain that Store installation is not available yet; do not present the Store link as an installable release. Pre-release testers may explicitly use the matching unpacked extension. Once public, use the matching `v<published_version>` server ref and the Store extension ID.

Check the OS, `git --version`, `node --version` (22 or newer), `npm --version`, and the selected client's MCP CLI help. Windows requires native Windows Node and Chrome, not WSL. If a prerequisite is missing, use its official installer or the environment's established package manager, respecting permission prompts. Ask the user only for interactive actions you cannot complete. Do not install a second client or reconfigure all detected clients.

## Install

1. Inspect any existing `linkedin` MCP entry with `codex mcp get linkedin` or `claude mcp get linkedin`. Also inspect higher-priority project entries that could shadow it. Retain unrelated configuration. If `linkedin` points to a different product or an unexpected installation, explain the conflict instead of overwriting it or adding a second name silently.
2. Use a durable versioned checkout: macOS `~/Library/Application Support/LinkedIn MCP/server/<version>`; Windows `%LOCALAPPDATA%\LinkedIn MCP\server\<version>`. Quote paths correctly for the active shell. Inspect an existing directory before reuse; never reset, clean or overwrite another checkout's changes.
3. Clone `https://github.com/h4gen/linkedin-mcp-bridge.git`, fetch the requested immutable ref and check it out detached. Verify `package.json` has the expected extension version. For explicit candidate testing, verify the supplied commit instead of assuming a tag exists.
4. In that checkout run `npm ci`, then `npm run build:store` for the Store/pilot channel or `npm run build` for development. A build failure must not replace a working native registration or client configuration.
5. Run `node dist/cli.js install EXTENSION_ID`, using the copied ID. With a published Store installation, the ID may be omitted. Development/unpacked installations require their actual ID, obtainable through the test browser or extension's copied instructions. Never use a guessed ID or the Store ID for an unpacked extension.
6. Parse installer JSON. Use its **actual absolute** `node` and `mcp_config.mcpServers.linkedin.args` values. Register the selected client only:
   - Codex: `codex mcp add linkedin -- <absolute-node> <absolute-cli> mcp`.
   - Claude Code: `claude mcp add --transport stdio --scope user linkedin -- <absolute-node> <absolute-cli> mcp`.
     Use structured process arguments when possible. If an existing matching entry is already correct, keep it. If replacing an older version of this same product, back up the entry, change only that entry through the client CLI and verify it afterward. Do not destroy unrelated TOML or JSON settings. Do not put credentials in the prompt or configuration.
7. Read the configuration back using the client's `mcp get`. The native registration alone does not prove the MCP client is configured.

## Browser and client completion

Open Chrome. For a public release, install the extension at `https://chromewebstore.google.com/detail/pibhcinkiadfplcaefllaeappkpnpfjm`. The first-install page explains setup and the local server is detected automatically. If LinkedIn is not signed in, the user completes sign-in in Chrome. No extra consent checkbox, Connect click or extension-ID lookup is required.

Keep explicit pause/disconnect intact. If the user wants access restored, direct them to Resume/Enable connection in settings. If another Chrome profile owns the local transport, do not steal it by killing processes or altering its registration. A changed LinkedIn account requires the user's choice in settings.

Run `node dist/cli.js doctor`. Exit zero requires a usable matching-version connection. On failure, follow the specific state; an unreachable local socket cannot tell you whether Chrome is closed, the extension is absent, or host registration failed. Do not claim setup complete on that basis.

Verify the actual selected client loads **32** tools and `linkedin_health` reports connected with the expected version. If the current client session has not reloaded its MCP configuration, request a new chat/client restart, then verify in that client. A standalone SDK smoke test is useful but is not proof the user's client has loaded the server.

Use the account returned by health for one `linkedin_conversations_list` call with `limit: 1`. Keep private results local. **No setup acceptance sends messages, publishes comments/posts, reacts, invites, changes read status or deletes conversations.** Report the checks completed and any remaining interactive step plainly.

## Repair or update

Read the installed extension version/channel from its instructions or health and select that exact Git release. Do not blindly `git pull main`: the Store and Git can advance at different times. Keep the old checkout until the new build, native registration, client configuration and read-only checks pass. Never clear extension storage to repair a transport issue; it contains account binding and duplicate-send receipts. Do not overwrite deliberate pause/disconnect. Use the new version's copied instructions after a Store update.

## Uninstall

Inspect and remove only the selected client's entry that points at this product (`codex mcp remove linkedin` or the corresponding Claude Code user-scope removal). Run this installation's `node dist/cli.js uninstall` only after confirming the native registration still refers to this installation. Do not unregister a newer install from an older checkout. Explain how to remove the Chrome extension separately. Removing the extension clears its browser data; existing content at LinkedIn or the AI provider is unaffected. Do not delete checkouts or other user files without an explicit removal request.

## Evidence and release limits

For acceptance record OS, client/version, source commit, build fingerprint, actual client discovery and read-only result status. Redact private content and local credentials. A synthetic Chromium/native-host smoke is not live LinkedIn acceptance. Windows and macOS results must be identified separately. Missing Store publication, sign-in, client restart or test environment remains an explicit outstanding step.
