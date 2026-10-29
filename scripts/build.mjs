import { build } from "esbuild";
import { mkdir, writeFile, chmod, rm, cp } from "node:fs/promises";
const channel =
  process.env.BRIDGE_CHANNEL === "pilot" ? "pilot" : "development";
const define = { "process.env.BRIDGE_CHANNEL": JSON.stringify(channel) };
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
  entryPoints: [
    "src/extension/background.ts",
    "src/extension/popup.ts",
    "src/extension/review.ts",
  ],
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
      name: "LinkedIn MCP Bridge" + (channel === "pilot" ? " BETA" : " Dev"),
      version: "0.2.0",
      description:
        "Local MCP access to your connected LinkedIn tab. Messaging, profiles and feed.",
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
  "review.html",
  "ui.css",
  "icon16.png",
  "icon48.png",
  "icon128.png",
])
  await cp("assets/" + file, "dist/extension/" + file);
