export const VERSION = "0.4.0";
export const PROTOCOL = 1;
export const CHANNEL =
  process.env.BRIDGE_CHANNEL === "pilot" ? "pilot" : "development";
export const NATIVE_HOST =
  "com.hagen.linkedin_mcp_bridge" + (CHANNEL === "pilot" ? ".pilot" : "");
