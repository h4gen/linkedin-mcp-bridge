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
  async function separateTab(
    check: () => void,
    recoverSaved: boolean,
    allowWindow: boolean,
  ) {
    const url = chrome.runtime.getURL("workspace.html");
    const anchors = (await chrome.tabs.query({ url })).filter(
      (tab) => tab.url === url,
    );
    let anchor = anchors.length === 1 ? anchors[0] : undefined;
    if (anchor?.id && recoverSaved) {
      const bound = await store.get("connection");
      const saved =
        bound?.tabId &&
        (await chrome.tabs.get(bound.tabId).catch(() => undefined));
      // Across an extension reload, the exact extension page AND Chrome's
      // opener relationship witness ownership. A numeric tab ID alone cannot.
      if (
        saved &&
        !saved.active &&
        saved.windowId === anchor.windowId &&
        saved.openerTabId === anchor.id &&
        saved.url?.startsWith("https://www.linkedin.com/")
      )
        return saved as chrome.tabs.Tab;
    }
    check();
    if (!anchor) {
      if (!allowWindow) return undefined;
      const win = await chrome.windows.create({
        url,
        state: "minimized",
        focused: false,
        type: "normal",
      });
      if (!win?.id) throw new Fault("work_tab_create_failed");
      anchor =
        win.tabs?.[0] ??
        (await chrome.tabs.query({ windowId: win.id, active: true }))[0];
    }
    if (!anchor?.id) throw new Fault("work_tab_create_failed");
    check();
    return chrome.tabs.create({
      windowId: anchor.windowId,
      openerTabId: anchor.id,
      url: feed,
      active: false,
    });
  }
  async function acquire(
    check: () => void,
    purpose: "operation" | "setup" | "show" = "operation",
  ) {
    const m = await mode();
    const found = await existing(m);
    check();
    const lease = found && (await store.get(key(m)));
    const replaceStalled =
      purpose !== "show" &&
      found &&
      lease?.id === found.id &&
      lease.stalled &&
      (found.pendingUrl || found.status === "loading") &&
      !(lease.recoveryAfter > Date.now());
    if (
      found &&
      !replaceStalled &&
      (purpose !== "operation" || !found.active) &&
      !(purpose === "show" && m === "separate_window" && !lease.dedicated)
    ) {
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
    let dedicated = false;
    try {
      if (m === "separate_window") {
        tab = await separateTab(check, !found, purpose === "show");
        dedicated = !!tab;
      }
      if (!tab) {
        // Naming an existing window prevents Chrome from implicitly creating
        // one when the user has closed every window but kept Chrome running.
        const window = await chrome.windows
          .getLastFocused({ windowTypes: ["normal"] })
          .catch(() => undefined);
        if (
          window?.id === undefined ||
          window.id === chrome.windows.WINDOW_ID_NONE
        )
          throw new Fault("work_window_unavailable");
        check();
        tab = await chrome.tabs.create({
          windowId: window.id,
          url: feed,
          active: false,
        });
      }
    } catch (error) {
      if (error instanceof Fault) throw error;
      throw new Fault("work_tab_create_failed");
    }
    if (!tab?.id) throw new Fault("work_tab_unavailable");
    await store.set(key(m), {
      id: tab.id,
      windowId: tab.windowId,
      dedicated,
      ...(replaceStalled ? { recoveryAfter: Date.now() + 600000 } : {}),
    });
    check();
    return { tab, created: true };
  }
  // Only the human settings action may reveal a workspace. No MCP caller.
  async function show(check: () => void) {
    const { tab } = await acquire(check, "show");
    check();
    await chrome.tabs.update(tab.id!, { active: true });
    if (tab.windowId !== undefined)
      await chrome.windows.update(
        tab.windowId,
        (await mode()) === "separate_window"
          ? { state: "normal", focused: true }
          : { focused: true },
      );
  }
  async function actualMode() {
    const m = await mode(),
      lease = await store.get(key(m));
    if (!lease?.id) return undefined;
    return m === "separate_window" && lease.dedicated
      ? "separate_window"
      : "background_tab";
  }
  return { mode, actualMode, existing, acquire, show, markStalled };
}
