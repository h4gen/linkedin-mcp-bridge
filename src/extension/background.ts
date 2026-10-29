import { Engine, Store } from "../core/engine.js";
import { Fault } from "../core/contracts.js";
import { self } from "../core/normalize.js";
import { pageFetch } from "./page-fetch.js";
import { domOperation } from "./dom.js";
import type { Request } from "../core/api.js";
const HOST = "com.hagen.linkedin_mcp_bridge";
const area = (k: string) =>
  k.startsWith("cursor:") ? chrome.storage.session : chrome.storage.local;
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
const engine = new Engine({
  store,
  fetch: fetchRequest,
  dom: async (op, a, state) => {
    const result = await chrome.scripting.executeScript({
      target: { tabId: await tabId() },
      world: "ISOLATED",
      func: domOperation,
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
        const result = await engine.run(
          msg.op,
          msg.args,
          Math.min(Number(msg.deadline) || 0, Date.now() + 60000),
          () => cancelled.has(msg.id),
        );
        if (JSON.stringify(result).length > 6 * 1024 * 1024)
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
    sender.tab ||
    sender.url !== chrome.runtime.getURL("popup.html")
  )
    return;
  (async () => {
    if (msg.action === "status")
      return {
        connection: await store.get("connection"),
        native: !!port,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
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
      k.startsWith("cursor:") &&
      (v as { expires: number }).expires < Date.now()
    )
      await chrome.storage.session.remove(k);
  const journal = (await store.get("journal")) ?? {};
  for (const [k, v] of Object.entries(journal) as [string, any][])
    if (Date.now() - v.created_at > 7 * 86400000) delete journal[k];
  await store.set("journal", journal);
  if (await store.get("connection")) connectHost();
});
void store.get("connection").then((c) => {
  if (c) connectHost();
});
