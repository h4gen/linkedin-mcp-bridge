import { workspace } from "./workspace.js";
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
  const placement = workspace(deps.store);
  let pending: Promise<number> | undefined;
  async function resolve(setup: boolean) {
    const generation = deps.generation();
    const connection = await deps.store.get("connection");
    if (!setup && !connection) throw new Fault("disconnected");
    if (connection?.paused) throw new Fault("connection_paused");
    const check = () => {
      if (generation !== deps.generation()) throw new Fault("cancelled");
    };
    const acquired = await placement.acquire(
      check,
      setup ? "setup" : "operation",
    );
    let tab = acquired.tab;
    const replaced = acquired.created || tab.id !== connection?.tabId;
    if (replaced || (await deps.store.get("workTabId")) !== tab.id) {
      check();
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
    while (tab.pendingUrl || tab.status !== "complete") {
      check();
      if (!tab.pendingUrl && tab.url && (await deps.ready?.(id, tab.url)))
        break;
      if (Date.now() >= deadline) {
        await placement.markStalled(id);
        throw new Fault("work_tab_loading_timeout");
      }
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
    if (replaced && connection?.account && !setup)
      await deps.verify(id, connection.account);
    check();
    if (!setup && connection && connection.tabId !== id) {
      check();
      await deps.store.set("connection", { ...connection, tabId: id });
    }
    return id;
  }
  const ensure = (setup = false) => {
    if (!pending)
      pending = resolve(setup).finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return Object.assign(ensure, { placement });
}
