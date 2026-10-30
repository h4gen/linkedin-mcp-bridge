import path from "node:path";
import { createHash } from "node:crypto";

/** Platform details belong here, never in LinkedIn adapters. */
export function platformPaths(
  platform: string,
  home: string,
  localAppData: string | undefined,
  host: string,
  pilot: boolean,
) {
  if (platform !== "darwin" && platform !== "win32")
    throw Error(
      "Supported platforms: macOS and Windows (native Node.js, not WSL).",
    );
  const p = platform === "win32" ? path.win32 : path.posix;
  const root = p.join(
    platform === "win32"
      ? localAppData || p.join(home, "AppData", "Local")
      : p.join(home, "Library", "Application Support"),
    "LinkedIn MCP Bridge" + (pilot ? " Pilot" : ""),
  );
  return {
    root,
    socketPath:
      platform === "win32"
        ? "\\\\.\\pipe\\linkedin-mcp-" +
          createHash("sha256")
            .update(root.toLowerCase() + host)
            .digest("hex")
            .slice(0, 32)
        : p.join(root, "bridge.sock"),
    manifestPath:
      platform === "win32"
        ? p.join(root, host + ".json")
        : p.join(
            home,
            "Library",
            "Application Support",
            "Google",
            "Chrome",
            "NativeMessagingHosts",
            host + ".json",
          ),
    registryKey:
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\" + host,
  };
}
export function launcherText(platform: string, node: string, host: string) {
  if (/[\r\n\0]/.test(node + host)) throw Error("Invalid launcher path");
  if (platform === "win32") {
    // Quoted paths, literal percent signs and disabled delayed expansion.
    const quote = (value: string) => '"' + value.replaceAll("%", "%%") + '"';
    if ((node + host).includes('"')) throw Error("Invalid Windows path");
    return (
      "@echo off\r\nsetlocal DisableDelayedExpansion\r\n" +
      quote(node) +
      " " +
      quote(host) +
      "\r\n"
    );
  }
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  return "#!/bin/sh\nexec " + quote(node) + " " + quote(host) + "\n";
}
