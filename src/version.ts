export const VERSION = "0.7.2";
export const PROTOCOL = 1;
export const CHANNEL =
  process.env.BRIDGE_CHANNEL === "pilot" ? "pilot" : "development";
export const NATIVE_HOST =
  "com.hagen.linkedin_mcp_bridge" + (CHANNEL === "pilot" ? ".pilot" : "");

export const STORE_EXTENSION_ID = process.env.BRIDGE_STORE_EXTENSION_ID ?? "";
