import fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, root, manifestPath, registryKey } from "./native/paths.js";

import { execFileSync } from "node:child_process";
import { launcherText } from "./native/platform.js";
import { prepareAccess } from "./native/access.js";
import { REPOSITORY, RELEASE_REF, STORE_URL } from "./setup.js";
import {
  VERSION,
  CHANNEL,
  PUBLISHED_VERSION,
  STORE_EXTENSION_ID,
} from "./version.js";
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
  const previous = await fs.readFile(manifestPath, "utf8").catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return undefined;
  });
  if (previous) {
    let old;
    try {
      old = JSON.parse(previous);
    } catch {
      throw Error(
        "existing_installation_conflict: Native registration is not valid JSON; inspect it before replacing it.",
      );
    }
    if (
      old.name !== spec.name ||
      JSON.stringify(old.allowed_origins) !==
        JSON.stringify(spec.allowed_origins)
    )
      throw Error(
        "existing_installation_conflict: This channel is registered to another extension. Keep it intact; inspect that installation before changing it.",
      );
  }
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
    version: VERSION,
    channel: CHANNEL,
    release_ref: RELEASE_REF,
    extension_url: STORE_URL,
    published_version: PUBLISHED_VERSION || null,
    installation_guide:
      REPOSITORY + "/blob/" + RELEASE_REF + "/docs/INSTALL_AGENT.md",
    client_commands: {
      codex: [
        "codex",
        "mcp",
        "add",
        "linkedin",
        "--",
        process.execPath,
        cli,
        "mcp",
      ],
      claude: [
        "claude",
        "mcp",
        "add",
        "--transport",
        "stdio",
        "--scope",
        "user",
        "linkedin",
        "--",
        process.execPath,
        cli,
        "mcp",
      ],
    },
    next: "Register the selected client using its command above. Open Chrome with the extension and sign in to LinkedIn; it connects automatically. Restart the client if needed, then run doctor and verify tools in that client.",
    store_note: PUBLISHED_VERSION
      ? "Use the server release matching the installed extension, not arbitrary main."
      : "The Store listing is not public yet. The public Store-first installation cannot be completed until publication. For pre-release testing only, load the matching dist/extension unpacked and register its actual ID.",
  };
}
export async function uninstall() {
  const current = await fs.readFile(manifestPath, "utf8").catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return undefined;
  });
  if (current) {
    const spec = JSON.parse(current);
    const expected = join(
      root,
      process.platform === "win32" ? "native-host.cmd" : "native-host.sh",
    );
    const currentHost = join(
      dirname(fileURLToPath(import.meta.url)),
      "host.js",
    );
    if (
      spec.name !== HOST ||
      spec.path !== expected ||
      (await fs.readFile(expected, "utf8")) !==
        launcherText(process.platform, process.execPath, currentHost)
    )
      throw Error(
        "installation_owned_by_other_checkout: Use the currently registered installation to uninstall.",
      );
  }

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
