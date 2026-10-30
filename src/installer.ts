import fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, root, manifestPath, registryKey } from "./native/paths.js";

import { execFileSync } from "node:child_process";
import { launcherText } from "./native/platform.js";
import { prepareAccess } from "./native/access.js";
import { STORE_EXTENSION_ID } from "./version.js";
export function manifest(id: string, launcher: string) {
  if (!/^[a-p]{32}$/.test(id))
    throw Error("Expected a Chrome extension ID (32 letters a-p).");
  return {
    name: HOST,
    description: "Local LinkedIn MCP bridge",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  };
}
export async function install(id: string = STORE_EXTENSION_ID) {
  if (!id)
    throw Error(
      "Store ID not configured yet. Supply install EXTENSION_ID from chrome://extensions.",
    );
  const launcher = join(
    root,
    process.platform === "win32" ? "native-host.cmd" : "native-host.sh",
  );
  const spec = manifest(id, launcher);
  await prepareAccess();
  const host = join(dirname(fileURLToPath(import.meta.url)), "host.js");
  await fs.access(host);
  await fs.writeFile(
    launcher,
    launcherText(process.platform, process.execPath, host),
    { mode: 0o700 },
  );
  if (process.platform !== "win32") await fs.chmod(launcher, 0o700);
  await fs.mkdir(dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(spec, null, 2) + "\n", {
    mode: 0o600,
  });
  if (process.platform === "win32")
    execFileSync(
      "reg.exe",
      ["ADD", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
      { stdio: "pipe", windowsHide: true },
    );
  const cli = join(dirname(host), "cli.js");
  return {
    manifest: manifestPath,
    extension_id: id,
    node: process.execPath,
    mcp_config: {
      mcpServers: {
        linkedin: { command: process.execPath, args: [cli, "mcp"] },
      },
    },
    next: "Install the Chrome extension, connect your LinkedIn tab, then run doctor.",
  };
}
export async function uninstall() {
  if (process.platform === "win32") {
    let registered = "";
    try {
      registered = execFileSync("reg.exe", ["QUERY", registryKey, "/ve"], {
        encoding: "utf8",
        windowsHide: true,
      });
    } catch {
      /* Already absent. */
    }
    if (registered.toLowerCase().includes(manifestPath.toLowerCase()))
      execFileSync("reg.exe", ["DELETE", registryKey, "/f"], {
        stdio: "pipe",
        windowsHide: true,
      });
  }
  await fs.unlink(manifestPath).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await fs
    .unlink(
      join(
        root,
        process.platform === "win32" ? "native-host.cmd" : "native-host.sh",
      ),
    )
    .catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  return {
    uninstalled: true,
    extension_data:
      "Remove the Chrome extension separately to erase its local journal.",
  };
}
