import { homedir } from "node:os";
import { CHANNEL, NATIVE_HOST } from "../version.js";
import { platformPaths } from "./platform.js";
export const HOST = NATIVE_HOST;
export const { root, socketPath, manifestPath, registryKey } = platformPaths(
  process.platform,
  process.env.LINKEDIN_BRIDGE_HOME ?? homedir(),
  process.env.LOCALAPPDATA,
  HOST,
  CHANNEL === "pilot",
);
