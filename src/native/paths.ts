import { homedir } from "node:os";
import { join } from "node:path";
import { CHANNEL, NATIVE_HOST } from "../version.js";
export const HOST = NATIVE_HOST;
export const root = join(
  homedir(),
  "Library",
  "Application Support",
  "LinkedIn MCP Bridge" + (CHANNEL === "pilot" ? " Pilot" : ""),
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
