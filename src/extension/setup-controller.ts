import type { Store } from "../core/engine.js";
import { Fault } from "../core/contracts.js";
import { self, normalize } from "../core/normalize.js";
import { personRef } from "../core/read-models.js";

// Setup owns initial binding only. Existing operations still use the recovery work-tab manager.
export function setupController(deps: {
  store: Store;
  generation: () => number;
  ready: () => boolean;
  invalidate: () => Promise<void>;
  readSelf: (id: number) => Promise<any>;
}) {
  let pending: Promise<void> | undefined;
  let opening: Promise<void> | undefined;
  let error: string | undefined;
  async function reconcile() {
    if (pending) return pending;
    pending = (async () => {
      const { store } = deps;
      const connection = await store.get("connection");
      if (
        !deps.ready() ||
        connection?.paused ||
        (await store.get("setupIntent")) !== "auto"
      )
        return;
      const generation = deps.generation();
      const check = () => {
        if (generation !== deps.generation() || !deps.ready())
          throw new Fault("cancelled");
      };
      try {
        const oldId = connection?.tabId ?? (await store.get("workTabId"));
        let tab = oldId
          ? await chrome.tabs.get(oldId).catch(() => undefined)
          : undefined;
        check();
        if (!tab?.url?.startsWith("https://www.linkedin.com/")) {
          tab = await chrome.tabs.create({
            url: "https://www.linkedin.com/feed/",
            active: false,
          });
          if (!tab.id) throw new Fault("work_tab_unavailable");
          await store.set("workTabId", tab.id);
          await deps.invalidate();
        }
        check();
        const id = tab.id!;
        if (tab.discarded) {
          await chrome.tabs.reload(id);
          tab = await chrome.tabs.get(id);
        }
        const deadline = Date.now() + 20000;
        while (tab.status !== "complete") {
          check();
          if (Date.now() >= deadline)
            throw new Fault("work_tab_loading_timeout");
          await new Promise((resolve) => setTimeout(resolve, 100));
          tab = await chrome.tabs.get(id);
        }
        if (!tab.url?.startsWith("https://www.linkedin.com/"))
          throw new Fault("work_tab_navigation_changed");
        if (/\/(login|checkpoint|challenge)(\/|\?|$)/.test(tab.url))
          throw new Fault("not_logged_in");
        check();
        const raw = await deps.readSelf(id);
        check();
        const account = self(raw);
        if (connection?.account && connection.account !== account)
          throw new Fault("account_changed");
        const normalized = normalize(raw);
        const person =
          normalized.entities.find(
            (p) => p.dashEntityUrn === account || p.entityUrn === account,
          ) ?? normalized.data.miniProfile;
        await store.set("connection", {
          ...connection,
          tabId: id,
          account,
          paused: false,
          accountName: person
            ? personRef(person).name
            : connection?.accountName,
        });
        error = undefined;
      } catch (e) {
        if (generation === deps.generation())
          error = e instanceof Fault ? e.code : "connection_unavailable";
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  async function openPage() {
    if (opening) return opening;
    opening = (async () => {
      const url = chrome.runtime.getURL("setup.html");
      const pages = await chrome.tabs.query({ url });
      const existing = pages.find((t) => t.url === url);
      if (existing?.id) await chrome.tabs.update(existing.id, { active: true });
      else await chrome.tabs.create({ url, active: true });
    })().finally(() => {
      opening = undefined;
    });
    return opening;
  }
  return {
    reconcile,
    openPage,
    error: () => error,
    reset: () => {
      error = undefined;
    },
  };
}
