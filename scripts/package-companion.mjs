// Produces a relocatable macOS companion. Never modifies the installed host.
import { build } from "esbuild";
import {
  mkdir,
  cp,
  readFile,
  writeFile,
  chmod,
  readdir,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const [runtime, extensionId, arch = process.arch] = process.argv.slice(2);
if (
  !runtime ||
  !/^[a-p]{32}$/.test(extensionId ?? "") ||
  !["arm64", "x64"].includes(arch)
)
  throw Error(
    "Usage: npm run package:companion -- NODE_BINARY STORE_EXTENSION_ID arm64|x64",
  );
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const root = resolve(`artifacts/companion-${version}-${arch}`);
const app = join(root, "LinkedIn MCP Bridge");
await mkdir(app, { recursive: true });
await cp(runtime, join(app, "node"));
await chmod(join(app, "node"), 0o755);
const binary = execFileSync("file", [join(app, "node")], { encoding: "utf8" });
if (!binary.includes(arch === "x64" ? "x86_64" : "arm64"))
  throw Error("Runtime architecture mismatch");
await build({
  entryPoints: { cli: "src/cli.ts", host: "src/native/host.ts" },
  outdir: app,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  define: { "process.env.BRIDGE_CHANNEL": '"pilot"' },
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const setup = `#!/bin/sh\nset -eu\nCOMPANION_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n"$COMPANION_DIR/node" "$COMPANION_DIR/cli.js" install ${extensionId}\nprintf '%s\\n' 'Companion registered. Configure your MCP client with the command shown in README.txt.'\n`;
await writeFile(join(app, "Setup.command"), setup, { mode: 0o755 });
await writeFile(
  join(app, "Uninstall.command"),
  '#!/bin/sh\nset -eu\nCOMPANION_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n"$COMPANION_DIR/node" "$COMPANION_DIR/cli.js" uninstall\n',
  { mode: 0o755 },
);
await writeFile(
  join(app, "README.txt"),
  `LinkedIn MCP Bridge ${version} — macOS ${arch}\nMove this entire folder to ~/Applications, then open Setup.command. Keep the folder in place.\nMCP command: /absolute/path/to/LinkedIn MCP Bridge/node\nMCP arguments: ["/absolute/path/to/LinkedIn MCP Bridge/cli.js", "mcp"]\nCheck: node cli.js doctor (use the bundled node).\nUpdates: quit Chrome, replace this folder, rerun Setup.command, reopen Chrome.\nUninstall: run Uninstall.command, remove the extension, then remove this folder.\nUnsigned development artifact unless accompanied by a notarized release receipt.\n`,
);
const licenses = join(app, "licenses");
await mkdir(licenses, { recursive: true });
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const [folder, meta] of Object.entries(lock.packages)) {
  if (!folder || meta.dev) continue;
  const names = await readdir(folder).catch(() => []);
  for (const name of names.filter((x) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(x),
  )) {
    await cp(
      join(folder, name),
      join(licenses, folder.replaceAll("/", "_") + "_" + name),
      { recursive: true },
    );
  }
}
const nodeLicense = resolve(
  process.env.BRIDGE_NODE_LICENSE ??
    "artifacts/runtime-cache/node-v22.22.0-darwin-x64/LICENSE",
);
await cp(nodeLicense, join(licenses, "NODE-LICENSE"));
const identity = process.env.BRIDGE_SIGN_IDENTITY;
if (identity) {
  if (!identity.startsWith("Developer ID Application:"))
    throw Error("Developer ID Application identity required");
  execFileSync(
    "codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--preserve-metadata=entitlements",
      "--sign",
      identity,
      join(app, "node"),
    ],
    { stdio: "inherit" },
  );
  execFileSync("codesign", ["--verify", "--strict", join(app, "node")], {
    stdio: "inherit",
  });
}
const archive = resolve(`artifacts/companion-${version}-${arch}.zip`);
execFileSync("ditto", ["-c", "-k", "--keepParent", app, archive]);
await writeFile(
  archive + ".sha256",
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") +
    "  " +
    archive.split("/").pop() +
    "\n",
);
const pkg = resolve(`artifacts/companion-${version}-${arch}.pkg`);
const pkgArgs = [
  "--root",
  app,
  "--identifier",
  "com.hagen.linkedin-mcp-bridge.pilot",
  "--version",
  version,
  "--install-location",
  "/Applications/LinkedIn MCP Bridge Pilot",
  pkg,
];
if (process.env.BRIDGE_INSTALLER_IDENTITY) {
  if (
    !identity ||
    !process.env.BRIDGE_INSTALLER_IDENTITY.startsWith("Developer ID Installer:")
  )
    throw Error("Both Developer ID signing identities are required");
  pkgArgs.splice(
    pkgArgs.length - 1,
    0,
    "--sign",
    process.env.BRIDGE_INSTALLER_IDENTITY,
  );
}
execFileSync("pkgbuild", pkgArgs, { stdio: "inherit" });
await writeFile(
  pkg + ".sha256",
  createHash("sha256")
    .update(await readFile(pkg))
    .digest("hex") +
    "  " +
    pkg.split("/").pop() +
    "\n",
);
if (process.env.BRIDGE_NOTARY_PROFILE) {
  if (!process.env.BRIDGE_INSTALLER_IDENTITY)
    throw Error("Notarization requires a signed installer");
  const output = execFileSync(
    "xcrun",
    [
      "notarytool",
      "submit",
      pkg,
      "--keychain-profile",
      process.env.BRIDGE_NOTARY_PROFILE,
      "--wait",
      "--output-format",
      "json",
    ],
    { encoding: "utf8" },
  );
  await writeFile(pkg + ".notary.json", output);
  if (JSON.parse(output).status !== "Accepted")
    throw Error("Notarization did not succeed");
  execFileSync("xcrun", ["stapler", "staple", pkg], { stdio: "inherit" });
  await writeFile(
    pkg + ".sha256",
    createHash("sha256")
      .update(await readFile(pkg))
      .digest("hex") +
      "  " +
      pkg.split("/").pop() +
      "\n",
  );
}
console.log(
  JSON.stringify({
    archive,
    installer: pkg,
    version,
    arch,
    signed: !!identity,
    store_extension_id: extensionId,
  }),
);
