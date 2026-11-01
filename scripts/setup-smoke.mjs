// Actual built settings UI, deterministic transport fixture. No LinkedIn requests.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const out = "artifacts/setup-0.8.0";
await mkdir(out, { recursive: true });
const files = new Map(
  await Promise.all(
    ["setup.html", "setup.js", "ui.css", "icon48.png"].map(async (f) => [
      "/" + f,
      await readFile("dist/extension/" + f),
    ]),
  ),
);
const server = createServer((req, res) => {
  if (!files.has(req.url)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    req.url.endsWith(".js")
      ? "text/javascript"
      : req.url.endsWith(".css")
        ? "text/css"
        : req.url.endsWith(".png")
          ? "image/png"
          : "text/html",
  );
  res.end(files.get(req.url));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await page.addInitScript(() => {
    window.fixture = {
      version: "0.8.0",
      channel: "development",
      extensionId: "a".repeat(32),
      setupIntent: "auto",
      nativeReady: false,
    };
    window.calls = [];
    window.copied = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.copied = text;
        },
      },
    });
    window.chrome = {
      runtime: {
        id: "a".repeat(32),
        sendMessage: async (msg) => {
          window.calls.push(msg.action);
          if (msg.action === "status") return window.fixture;
          if (msg.action === "pause") window.fixture.connection.paused = true;
          if (msg.action === "resume") window.fixture.connection.paused = false;
          return {};
        },
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/setup.html`);
  await page.getByRole("button", { name: /Copy setup instructions/ }).click();
  assert.match(await page.evaluate(() => window.copied), /Codex/);
  assert.match(await page.evaluate(() => window.copied), /v0.8.0/);
  await page.getByLabel("Your AI client").selectOption("claude");
  await page.getByRole("button", { name: /Copy setup instructions/ }).click();
  assert.match(await page.evaluate(() => window.copied), /Claude Code/);
  await page.screenshot({ path: out + "/setup.png", fullPage: true });
  await page.evaluate(() => {
    window.fixture.nativeReady = true;
    window.fixture.connection = {
      account: "urn:li:fsd_profile:test",
      accountName: "Test Person",
      paused: false,
    };
    window.dispatchEvent(new Event("focus"));
  });
  await page.getByRole("heading", { name: "Ready for your agent." }).waitFor();
  assert.equal(await page.locator("#primary").isVisible(), false);
  assert.equal(await page.locator("#client-choice").isVisible(), false);
  await page.screenshot({ path: out + "/ready.png", fullPage: true });
  await page.getByText("Settings & help", { exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("heading", { name: "LinkedIn is paused." }).waitFor();
  await page.locator("#primary").click();
  await page.getByRole("heading", { name: "Ready for your agent." }).waitFor();
  await page.evaluate(() => {
    window.fixture.setupError = "account_changed";
    window.dispatchEvent(new Event("focus"));
  });
  await page
    .getByRole("button", { name: "Use current LinkedIn account" })
    .waitFor();
  await page.evaluate(() => {
    window.fixture.setupError = "not_logged_in";
    window.dispatchEvent(new Event("focus"));
  });
  await page
    .getByRole("button", { name: "Open LinkedIn", exact: true })
    .waitFor();
  await page.screenshot({ path: out + "/sign-in.png", fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: out + "/narrow.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: out + "/zoom-200.png", fullPage: true });
  await page.keyboard.press("Tab");
  assert(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle !== "none",
    ),
  );
  assert(
    !(await page.evaluate(() => window.calls)).some((x) =>
      ["connect", "clear"].includes(x),
    ),
  );
  console.log(
    JSON.stringify({
      setup_ui: "passed",
      copy_clients: ["codex", "claude"],
      states: ["missing_host", "ready", "paused", "account_changed", "sign_in"],
      sizes: ["1280", "360", "200%"],
      scope: "Built UI and simulated transport; no LinkedIn writes",
    }),
  );
} finally {
  await browser.close();
  server.close();
}
