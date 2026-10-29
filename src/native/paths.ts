import { homedir } from "node:os";
import { join } from "node:path";
export const HOST = "com.hagen.linkedin_mcp_bridge";
export const root = join(
  homedir(),
  "Library",
  "Application Support",
  "LinkedIn MCP Bridge",
);
export const socketPath = join(root, "bridge.sock");
export const manifestPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "NativeMessagingHosts",
  HOST + ".json",
);
