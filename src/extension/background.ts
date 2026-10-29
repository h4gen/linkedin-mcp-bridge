import { Extractions } from "../core/extractions.js";
import { parse } from "../core/contracts.js";
import { Approvals, ACCEPTED_WRITES } from "../core/approvals.js";
import { Engine, Store } from "../core/engine.js";
import { Fault } from "../core/contracts.js";
import { self } from "../core/normalize.js";
import { pageFetch } from "./page-fetch.js";
import { extractionOperation } from "./extraction.js";
import { domOperation } from "./dom.js";
import type { Request } from "../core/api.js";
import { VERSION, PROTOCOL, NATIVE_HOST as HOST } from "../version.js";
const area = (k: string) =>
  k.startsWith("cursor:") ||
  k.startsWith("approval:") ||
  k.startsWith("extraction:")
    ? chrome.storage.session
    : chrome.storage.local;
const store: Store = {
  get: async (k) => (await area(k).get(k))[k],
  set: async (k, v) => area(k).set({ [k]: v }),
  remove: async (k) => area(k).remove(k),
};
let lastRequest = 0;
async function tabId() {
  const c = await store.get("connection");
  if (!c || c.paused) throw new Fault("disconnected_or_paused");
  const tab = await chrome.tabs.get(c.tabId);
  if (!tab.url?.startsWith("https://www.linkedin.com/"))
    throw new Fault("connected_tab_unavailable");
  return c.tabId as number;
}
async function fetchRequest(r: Request) {
  const blocked = await store.get("blockedUntil");
  if (blocked > Date.now()) throw new Fault("session_cooldown");
  await new Promise((r) =>
    setTimeout(r, Math.max(0, lastRequest + 1000 - Date.now())),
  );
  lastRequest = Date.now();
  const out = await chrome.scripting.executeScript({
    target: { tabId: await tabId() },
    world: "MAIN",
    func: pageFetch,
    args: [r],
  });
  const result = out[0]?.result;
  if (result?.error) {
    if (result.error === "rate_limited" || result.error === "session_blocked")
      await store.set(
        "blockedUntil",
        Date.now() + Math.max(60000, Number(result.retry_after || 3600) * 1000),
      );
    throw new Fault(result.error);
  }
  if (!result || !Object.hasOwn(result, "data"))
    throw new Fault("empty_browser_response");
  return result.data;
}
const approvals = new Approvals(store);
const engine = new Engine({
  allowedWrites: ACCEPTED_WRITES,
  authorize: (...args) => approvals.request(...args),
  store,
  fetch: fetchRequest,
  dom: async (op, a, state) => {
    const id = await tabId();
    if (["comments_list", "reactions_list", "post_get"].includes(op)) {
      const url = "https://www.linkedin.com/feed/update/" + a.post_urn + "/";
      const tab = await chrome.tabs.get(id);
      const target = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: "ISOLATED",
        func: (urn: string) =>
          Array.from(
            document.querySelectorAll(
              "[data-mcp-post-urn],[data-urn],[data-id]",
            ),
          ).some((e) =>
            ["data-mcp-post-urn", "data-urn", "data-id"].some(
              (k) => e.getAttribute(k) === urn,
            ),
          ),
        args: [a.post_urn],
      });
      if (!target[0]?.result && tab.url !== url) {
        await chrome.tabs.update(id, { url });
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((r) => setTimeout(r, 250));
          const current = await chrome.tabs.get(id);
          if (current.status === "complete" && current.url === url) break;
          if (attempt === 39) throw new Fault("post_navigation_timeout");
        }
      }
    }
    const result = await chrome.scripting.executeScript({
      target: { tabId: await tabId() },
      world: "ISOLATED",
      func: ["comments_list", "reactions_list"].includes(op)
        ? extractionOperation
        : domOperation,
      args: [op, a, state],
    });
    if (!result[0]?.result) throw new Fault("ui_operation_failed");
    return result[0].result;
  },
  account: async () => {
    const c = await store.get("connection");
    return c && !c.paused ? c.account : undefined;
  },
  now: Date.now,
  uuid: () => crypto.randomUUID(),
  hash: async (text) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
});
const extractions = new Extractions(
  store,
  (op, a) => engine.run(op, a),
  async () => {
    const health = await engine.run("health", {});
    return health.connected ? health.account_urn : undefined;
  },
);
const cancelled = new Set<string>();
let port: chrome.runtime.Port | undefined;
function connectHost() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(async (msg) => {
      if (msg?.cancel) {
        cancelled.add(msg.cancel);
        return;
      }
      if (!msg || typeof msg.id !== "string" || typeof msg.op !== "string")
        return;
      const current = port;
      try {
        if (msg.protocol !== PROTOCOL || msg.hostVersion !== VERSION)
          throw new Fault(
            "companion_version_mismatch",
            "Install the matching companion version " + VERSION,
          );
        const result = msg.op.startsWith("extraction_")
          ? await extractions.handle(msg.op, parse(msg.op, msg.args))
          : await engine.run(
              msg.op,
              msg.args,
              Math.min(Number(msg.deadline) || 0, Date.now() + 60000),
              () => cancelled.has(msg.id),
            );
        if (
          new TextEncoder().encode(JSON.stringify(result)).byteLength >
          6 * 1024 * 1024
        )
          throw new Fault("response_too_large");
        current?.postMessage({ id: msg.id, result });
      } catch (e) {
        current?.postMessage({
          id: msg.id,
          error: {
            code: e instanceof Fault ? e.code : "operation_failed",
            message:
              e instanceof Fault
                ? e.message
                : "Operation failed validation or execution.",
          },
        });
      } finally {
        cancelled.delete(msg.id);
      }
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = undefined;
    });
  } catch {
    port = undefined;
  }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Popup only. No content-script bridge or externally_connectable surface.
  if (
    sender.id !== chrome.runtime.id ||
    !["popup.html", "review.html"].some(
      (page) => sender.url === chrome.runtime.getURL(page),
    )
  )
    return;
  (async () => {
    if (msg.action === "approvals") {
      const all = await chrome.storage.session.get(null);
      return {
        items: Object.entries(all)
          .filter(
            ([k, v]) =>
              k.startsWith("approval:") && (v as any).expires > Date.now(),
          )
          .map(([, v]) => v),
      };
    }
    if (msg.action === "decide") {
      const row = await approvals.decide(msg.key, msg.id, msg.approve === true);
      if (msg.approve === true) return engine.run(row.operation, row.args);
      return { status: "rejected" };
    }
    if (msg.action === "inbox-permission") {
      await store.set("allowInboxChanges", msg.enabled === true);
      return { enabled: msg.enabled === true };
    }
    if (msg.action === "clear") {
      await store.remove("connection");
      port?.disconnect();
      port = undefined;
      await chrome.storage.session.clear();
      await chrome.storage.local.clear();
      return { cleared: true };
    }
    if (msg.action === "status")
      return {
        connection: await store.get("connection"),
        native: !!port,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        allowInboxChanges: (await store.get("allowInboxChanges")) === true,
        blockedUntil: await store.get("blockedUntil"),
      };
    if (msg.action === "connect") {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/"))
        throw new Fault("open_linkedin_tab");
      await store.set("connection", { tabId: tab.id, paused: false });
      try {
        const account = self(await fetchRequest({ path: "/me" }));
        await store.set("connection", {
          tabId: tab.id,
          account,
          paused: false,
        });
        connectHost();
        return { account };
      } catch (e) {
        await store.remove("connection");
        throw e;
      }
    }
    if (msg.action === "pause") {
      const c = await store.get("connection");
      if (c) await store.set("connection", { ...c, paused: true });
      return { paused: true };
    }
    if (msg.action === "disconnect") {
      await store.remove("connection");
      port?.disconnect();
      port = undefined;
      return { disconnected: true };
    }
    throw new Fault("unknown_popup_action");
  })()
    .then(reply)
    .catch((e) =>
      reply({ error: e instanceof Fault ? e.code : "connection_failed" }),
    );
  return true;
});
chrome.alarms.create("host-reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async () => {
  const cursors = await chrome.storage.session.get(null);
  for (const [k, v] of Object.entries(cursors))
    if (
      (k.startsWith("cursor:") ||
        k.startsWith("approval:") ||
        k.startsWith("extraction:")) &&
      (v as { expires: number }).expires < Date.now()
    )
      await chrome.storage.session.remove(k);
  const journal = (await store.get("journal")) ?? {};
  for (const [k, v] of Object.entries(journal) as [string, any][])
    if (Date.now() - v.created_at > 7 * 86400000) delete journal[k];
  await store.set("journal", journal);
  if (await store.get("connection")) connectHost();
});
void chrome.storage.session.get(null).then(async (all) => {
  for (const [key, row] of Object.entries(all) as [string, any][])
    if (key.startsWith("extraction:") && row.status === "running")
      await store.set(key, { ...row, status: "interrupted", partial: true });
});
void store.get("connection").then((c) => {
  if (c) connectHost();
});
