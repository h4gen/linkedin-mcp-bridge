// Browser/native transport acceptance. Synthetic health only; never opens LinkedIn.
import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const taskDir = await mkdtemp(
  join(process.platform === "darwin" ? "/tmp" : tmpdir(), "li-browser-"),
);
const hostName = "com.linkedin_bridge.test_" + process.pid;
const fixture = join(taskDir, "extension");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const env = {
  ...process.env,
  LINKEDIN_BRIDGE_HOME: taskDir,
  LOCALAPPDATA: join(taskDir, "AppData", "Local"),
};
const registrations = [];
let context;
try {
  await mkdir(fixture);
  await writeFile(
    join(fixture, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Native transport test",
      version: "1.0",
      permissions: ["nativeMessaging"],
      background: { service_worker: "background.js" },
    }),
  );
  await writeFile(
    join(fixture, "background.js"),
    "chrome.runtime.onInstalled.addListener(() => {});",
  );
  await writeFile(
    join(fixture, "test.html"),
    "<!doctype html><title>Native transport test</title>",
  );
  context = await chromium.launchPersistentContext(join(taskDir, "profile"), {
    channel: "chromium",
    headless: true,
    env,
    args: [
      "--disable-extensions-except=" +
        fixture +
        "," +
        resolve("dist/extension"),
      "--load-extension=" + fixture + "," + resolve("dist/extension"),
    ],
  });
  let worker;
  for (let i = 0; i < 100; i++) {
    for (const candidate of context.serviceWorkers()) {
      if (
        (await candidate.evaluate(() => chrome.runtime.getManifest().name)) ===
        "Native transport test"
      )
        worker = candidate;
    }
    if (worker) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(worker, "Fixture extension did not load");
  const id = new URL(worker.url()).host;
  const launcher = join(
    taskDir,
    process.platform === "win32" ? "host.cmd" : "host.sh",
  );
  const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
  const cmdQuote = (value) => '"' + value.replaceAll("%", "%%") + '"';
  await writeFile(
    launcher,
    process.platform === "win32"
      ? "@echo off\r\nsetlocal DisableDelayedExpansion\r\n" +
          cmdQuote(process.execPath) +
          " " +
          cmdQuote(resolve("dist/host.js")) +
          "\r\n"
      : "#!/bin/sh\nexec " +
          quote(process.execPath) +
          " " +
          quote(resolve("dist/host.js")) +
          "\n",
    { mode: 0o700 },
  );
  const spec = JSON.stringify({
    name: hostName,
    description: "Isolated native transport test",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  });
  if (process.platform === "win32") {
    const file = join(taskDir, "manifest.json");
    await writeFile(file, spec);
    for (const product of ["Google\\Chrome", "Chromium"]) {
      const key =
        "HKCU\\Software\\" + product + "\\NativeMessagingHosts\\" + hostName;
      execFileSync(
        "reg.exe",
        ["ADD", key, "/ve", "/t", "REG_SZ", "/d", file, "/f"],
        { stdio: "pipe" },
      );
      registrations.push(key);
    }
  }

  if (process.platform === "darwin") {
    const folder = join(taskDir, "profile", "NativeMessagingHosts");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, hostName + ".json"), spec);
  }
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/test.html`);
  await page.evaluate(
    ({ hostName, version }) => {
      globalThis.nativeError = null;
      globalThis.nativePort = chrome.runtime.connectNative(hostName);
      nativePort.onDisconnect.addListener(() => {
        globalThis.nativeError =
          chrome.runtime.lastError?.message || "disconnected";
      });
      nativePort.onMessage.addListener((msg) => {
        if (msg.op === "health")
          nativePort.postMessage({
            id: msg.id,
            result: { version, connected: false, capabilities: [] },
          });
      });
    },
    { hostName, version },
  );
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => globalThis.nativeError), null);
  const cli = spawn(process.execPath, ["dist/cli.js", "doctor"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  cli.stdout.on("data", (b) => (stdout += b));
  cli.stderr.on("data", (b) => (stderr += b));
  const [code] = await once(cli, "exit");
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).version, version);
  assert(
    context.serviceWorkers().length >= 2,
    "Product MV3 service worker did not load",
  );
  console.log(
    JSON.stringify({
      platform: process.platform,
      version,
      browser_native_transport: "passed",
      fixture: "synthetic health; no LinkedIn actions",
      packaged_extension_loaded: true,
    }),
  );
} finally {
  await context?.close();
  for (const entry of registrations) {
    if (process.platform === "win32")
      execFileSync("reg.exe", ["DELETE", entry, "/f"], { stdio: "pipe" });
    else await rm(entry, { force: true });
  }
  await rm(taskDir, { recursive: true, force: true });
}
