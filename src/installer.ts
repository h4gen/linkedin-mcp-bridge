import fs from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST, root, manifestPath } from "./native/paths.js";
const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
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
export async function install(id: string) {
  if (process.platform !== "darwin")
    throw Error("Installer supports macOS only.");
  const launcher = join(root, "native-host.sh");
  const spec = manifest(id, launcher);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700);
  const host = join(dirname(fileURLToPath(import.meta.url)), "host.js");
  await fs.access(host);
  await fs.writeFile(
    launcher,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(host)}\n`,
    { mode: 0o700 },
  );
  await fs.chmod(launcher, 0o700);
  await fs.mkdir(dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(spec, null, 2) + "\n", {
    mode: 0o600,
  });
  return { manifest: manifestPath, extension_id: id, node: process.execPath };
}
export async function uninstall() {
  await fs.unlink(manifestPath).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await fs.unlink(join(root, "native-host.sh")).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  return {
    uninstalled: true,
    extension_data:
      "Remove the Chrome extension separately to erase its local journal.",
  };
}
