import { runtimeFingerprint } from "./runtime-fingerprint.mjs";
import { acceptanceDefine } from "./build-acceptance.mjs";
import { build } from "esbuild";
import { mkdir, writeFile, chmod, rm, cp, readFile } from "node:fs/promises";
const channel =
  process.env.BRIDGE_CHANNEL === "pilot" || process.argv.includes("--store")
    ? "pilot"
    : "development";
const release = JSON.parse(await readFile("store/release.json", "utf8"));
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const define = {
  "process.env.BRIDGE_STORE_EXTENSION_ID": JSON.stringify(
    release.store_extension_id || "",
  ),
  "process.env.BRIDGE_CHANNEL": JSON.stringify(channel),
  "process.env.BRIDGE_ACCEPTANCE": await acceptanceDefine(),
};
await rm("dist", { recursive: true, force: true });
await mkdir("dist/extension", { recursive: true });
await build({
  define,
  entryPoints: { cli: "src/cli.ts", host: "src/native/host.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});
await build({
  define,
  entryPoints: ["src/extension/background.ts", "src/extension/popup.ts"],
  outdir: "dist/extension",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
});
await chmod("dist/cli.js", 0o755);
await writeFile(
  "dist/extension/manifest.json",
  JSON.stringify(
    {
      manifest_version: 3,
      name:
        "LinkedIn MCP – AI Connector for Claude & Codex" +
        (channel === "pilot" ? "" : " Dev"),
      version,
      description:
        "Connect LinkedIn to Claude and Codex via a local MCP server. Manage your inbox, research people, draft and schedule posts.",
      minimum_chrome_version: "120",
      permissions: ["storage", "scripting", "nativeMessaging", "alarms"],
      host_permissions: ["https://www.linkedin.com/*"],
      background: { service_worker: "background.js" },
      action: { default_popup: "popup.html" },
      icons: { 16: "icon16.png", 48: "icon48.png", 128: "icon128.png" },
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
      },
    },
    null,
    2,
  ),
);
for (const file of [
  "popup.html",
  "ui.css",
  "icon16.png",
  "icon48.png",
  "icon128.png",
])
  await cp("assets/" + file, "dist/extension/" + file);

await writeFile(
  "dist/build.json",
  JSON.stringify(
    { version, channel, fingerprint: await runtimeFingerprint() },
    null,
    2,
  ) + "\n",
);
