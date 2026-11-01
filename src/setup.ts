import { VERSION, CHANNEL, STORE_EXTENSION_ID } from "./version.js";
export const REPOSITORY = "https://github.com/h4gen/linkedin-mcp-bridge";
export const STORE_URL =
  "https://chromewebstore.google.com/detail/" + STORE_EXTENSION_ID;
export const RELEASE_REF = "v" + VERSION;
export type SetupClient = "codex" | "claude";
export function agentInstructions(
  client: SetupClient,
  extensionId: string,
  task: "install" | "repair" | "uninstall" = "install",
) {
  return `Please ${task === "uninstall" ? "uninstall" : task === "repair" ? "repair or update" : "install"} LinkedIn MCP for ${client === "codex" ? "Codex" : "Claude Code"} on this computer.
Repository: ${REPOSITORY}
Required release: ${RELEASE_REF}; extension version: ${VERSION}; channel: ${CHANNEL}; extension ID: ${extensionId}.
Read docs/INSTALL_AGENT.md from that exact release and follow its ${task} instructions. Use a durable per-user directory and the matching build channel. Configure only this client's user-level linkedin MCP entry, retaining other servers and checking existing settings before changes. Use the actual absolute Node and CLI paths returned by the installer.
The Chrome extension connects automatically. Ask me only for actions you cannot perform, such as signing in to LinkedIn or restarting this client if needed. Do not ask me to paste JSON, find extension IDs, use a terminal, or click Connect. Do not bypass client permissions.
${task === "uninstall" ? "Remove only this installation's registration and matching client entry. Explain how to remove the Chrome extension; do not erase other data." : "Verify the registered configuration, 32 tools, matching version and linkedin_health. Finish with one read-only inbox request. Never send, publish, like, invite or change a conversation during setup. If a required step is unavailable, report the concrete remaining step rather than claiming success."}`;
}
