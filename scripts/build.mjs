import { build } from "esbuild";
import { mkdir, writeFile, chmod, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/extension", { recursive: true });
await build({
  entryPoints: { cli: "src/cli.ts", host: "src/native/host.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});
await build({
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
      name: "LinkedIn MCP Bridge",
      version: "0.1.0",
      description:
        "Local MCP access to your connected LinkedIn tab. Messaging, profiles and feed.",
      minimum_chrome_version: "120",
      permissions: [
        "storage",
        "scripting",
        "tabs",
        "nativeMessaging",
        "alarms",
      ],
      host_permissions: ["https://www.linkedin.com/*"],
      background: { service_worker: "background.js" },
      action: { default_popup: "popup.html" },
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
      },
    },
    null,
    2,
  ),
);
await writeFile(
  "dist/extension/popup.html",
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>LinkedIn MCP Bridge</title><style>body{width:360px;font:14px system-ui;padding:16px;color:#17334c}button{padding:8px;margin:4px}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{display:block;margin-top:16px}</style><h2>LinkedIn MCP Bridge</h2><p>Open LinkedIn in the tab you want to connect.</p><button data-action="connect">Connect this tab</button><button data-action="pause">Pause</button><button data-action="disconnect">Disconnect</button><button data-action="status">Refresh status</button><pre id="status"></pre><small>Install the local host first:<br><code>node dist/cli.js install EXTENSION_ID</code><br>Use the extension ID shown above. Messages stay in your browser; mutation receipts are retained locally for seven days.</small><script src="popup.js"></script></html>`,
);
