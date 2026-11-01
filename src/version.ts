export const VERSION = "0.8.0";
export const PROTOCOL = 1;
export const CHANNEL =
  process.env.BRIDGE_CHANNEL === "pilot" ? "pilot" : "development";
export const NATIVE_HOST =
  "com.hagen.linkedin_mcp_bridge" + (CHANNEL === "pilot" ? ".pilot" : "");

export const STORE_EXTENSION_ID = process.env.BRIDGE_STORE_EXTENSION_ID ?? "";

export const PUBLISHED_VERSION = process.env.BRIDGE_PUBLISHED_VERSION ?? "";
