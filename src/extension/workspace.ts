// Browser-session leases establish ownership. Never adopt a personal LinkedIn tab
// from a URL search or a numeric ID left behind by a previous browser session.
import { Fault } from "../core/contracts.js";
import type { Store } from "../core/engine.js";
export type WorkspaceMode = "background_tab" | "separate_window";
export const feed = "https://www.linkedin.com/feed/";
export function workspace(store: Store) {
  const mode = async (): Promise<WorkspaceMode> =>
    (await store.get("workspaceMode")) === "separate_window"
      ? "separate_window"
      : "background_tab";
  const key = (m: WorkspaceMode) => "workspace:" + m;
  async function existing(m: WorkspaceMode) {
    const lease = await store.get(key(m));
    if (!lease?.id) return;
    const tab = await chrome.tabs.get(lease.id).catch(() => undefined);
    if (
      tab?.url?.startsWith("https://www.linkedin.com/") &&
      (m !== "separate_window" || tab.windowId === lease.windowId)
    )
      return tab;
  }
  async function markStalled(id: number) {
    const m = await mode(),
      lease = await store.get(key(m));
    if (lease?.id === id) await store.set(key(m), { ...lease, stalled: true });
  }
  async function acquire(check: () => void, recover = true) {
    const m = await mode();
    const found = await existing(m);
    check();
    const lease = found && (await store.get(key(m)));
    const replaceStalled =
      recover &&
      found &&
      lease?.id === found.id &&
      lease.stalled &&
      (found.pendingUrl || found.status === "loading") &&
      !(lease.recoveryAfter > Date.now());
    if (found && !replaceStalled) {
      if (lease?.stalled && found.status === "complete" && !found.pendingUrl)
        await store.set(key(m), { ...lease, stalled: false });
      return { tab: found, created: false };
    }
    check();
    // A timed-out request has already ended. One future request may acquire
    // a replacement. Never close the old page or replay its operation.
    if (replaceStalled)
      await store.set(key(m), { ...lease, recoveryAfter: Date.now() + 600000 });
    check();
    let tab: chrome.tabs.Tab | undefined;
    try {
      if (m === "separate_window") {
        const win = await chrome.windows.create({
          url: feed,
          focused: false,
          type: "normal",
        });
        tab = win?.tabs?.[0];
        if (!tab && win?.id !== undefined)
          [tab] = await chrome.tabs.query({ windowId: win.id, active: true });
      } else tab = await chrome.tabs.create({ url: feed, active: false });
    } catch {
      throw new Fault("work_tab_create_failed");
    }
    if (!tab?.id) throw new Fault("work_tab_unavailable");
    await store.set(key(m), {
      id: tab.id,
      windowId: tab.windowId,
      ...(replaceStalled ? { recoveryAfter: Date.now() + 600000 } : {}),
    });
    check();
    return { tab, created: true };
  }
  // Only the human settings action may reveal a workspace. No MCP caller.
  async function show(check: () => void) {
    const { tab } = await acquire(check, false);
    check();
    await chrome.tabs.update(tab.id!, { active: true });
    if (tab.windowId !== undefined)
      await chrome.windows.update(tab.windowId, { focused: true });
  }
  return { mode, existing, acquire, show, markStalled };
}
