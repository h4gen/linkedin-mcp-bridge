import { Fault } from "../core/contracts.js";
import type { Store } from "../core/engine.js";

// Tab IDs are ephemeral; the persisted account binding is the durable identity.
export function workTab(deps: {
  store: Store;
  generation: () => number;
  verify: (id: number, account: string) => Promise<void>;
  invalidate: () => Promise<void>;
  ready?: (id: number, url: string) => Promise<boolean>;
}) {
  let pending: Promise<number> | undefined;
  async function resolve() {
    const generation = deps.generation();
    const connection = await deps.store.get("connection");
    if (!connection) throw new Fault("disconnected");
    if (connection.paused) throw new Fault("connection_paused");
    const check = () => {
      if (generation !== deps.generation()) throw new Fault("cancelled");
    };
    let tab = await chrome.tabs.get(connection.tabId).catch(() => undefined);
    check();
    let replaced = false;
    if (!tab?.url?.startsWith("https://www.linkedin.com/")) {
      tab = await chrome.tabs
        .create({ url: "https://www.linkedin.com/feed/", active: false })
        .catch(() => {
          throw new Fault("work_tab_create_failed");
        });
      replaced = true;
      check();
      if (!tab.id) throw new Fault("work_tab_unavailable");
      // Persist immediately so a failed login or a suspended worker doesn't spawn more tabs.
      await deps.store.set("connection", { ...connection, tabId: tab.id });
      await deps.store.set("workTabId", tab.id);
      await deps.invalidate();
    }
    const id = tab.id!;
    if (tab.discarded) {
      await chrome.tabs.reload(id).catch(() => {
        throw new Fault("work_tab_unavailable");
      });
      tab = await chrome.tabs.get(id).catch(() => {
        throw new Fault("work_tab_unavailable");
      });
    }
    const deadline = Date.now() + 20000;
    while (tab.status !== "complete") {
      check();
      if (!tab.pendingUrl && tab.url && (await deps.ready?.(id, tab.url)))
        break;
      if (Date.now() >= deadline) throw new Fault("work_tab_loading_timeout");
      await new Promise((resolve) => setTimeout(resolve, 100));
      tab = await chrome.tabs.get(id).catch(() => {
        throw new Fault("work_tab_unavailable");
      });
    }
    check();
    if (!tab.url?.startsWith("https://www.linkedin.com/"))
      throw new Fault("work_tab_navigation_changed");
    if (/\/(login|checkpoint|challenge)(\/|\?|$)/.test(tab.url))
      throw new Fault("not_logged_in");
    if (replaced && connection.account)
      await deps.verify(id, connection.account);
    check();
    return id;
  }
  return () => {
    if (!pending)
      pending = resolve().finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
