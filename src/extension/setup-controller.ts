import type { Store } from "../core/engine.js";
import { Fault } from "../core/contracts.js";
import { self, normalize } from "../core/normalize.js";
import { personRef } from "../core/read-models.js";

// Setup owns initial binding only. Existing operations still use the recovery work-tab manager.
export function setupController(deps: {
  store: Store;
  generation: () => number;
  ready: () => boolean;
  setupTab: () => Promise<number>;
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
        const id = await deps.setupTab();
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
