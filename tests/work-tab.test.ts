import { afterEach, expect, it, vi } from "vitest";
import { workTab } from "../src/extension/work-tab.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture(ready?: (id: number, url: string) => Promise<boolean>) {
  let generation = 0;
  const data: any = {
    "workspace:background_tab": { id: 1 },
    connection: { tabId: 1, account: "me", paused: false },
  };
  const tab: any = {
    id: 2,
    status: "complete",
    url: "https://www.linkedin.com/feed/",
  };
  const tabs = {
    get: vi.fn(async (id: number) => {
      if (id === 1) throw Error("missing");
      return tab;
    }),
    create: vi.fn(async () => tab),
    reload: vi.fn(async () => {}),
  };
  vi.stubGlobal("chrome", {
    tabs,
    windows: { getLastFocused: async () => ({ id: 1 }) },
  });
  const verify = vi.fn(async () => {}),
    invalidate = vi.fn(async () => {});
  const ensure = workTab({
    ready,
    store: {
      get: async (k) => data[k],
      set: async (k, v) => {
        data[k] = v;
      },
      remove: async (k) => {
        delete data[k];
      },
    },
    generation: () => generation,
    verify,
    invalidate,
  });
  return {
    ensure,
    tabs,
    tab,
    data,
    verify,
    invalidate,
    cancel: () => generation++,
  };
}
it("coalesces concurrent recovery into one tab and one account check", async () => {
  const f = fixture();
  expect(await Promise.all([f.ensure(), f.ensure(), f.ensure()])).toEqual([
    2, 2, 2,
  ]);
  expect(f.tabs.create).toHaveBeenCalledTimes(1);
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(2, "me");
});
it("waits for a loading replacement before account verification", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.tab.status = "loading";
  const result = f.ensure();
  await vi.advanceTimersByTimeAsync(200);
  expect(f.verify).not.toHaveBeenCalled();
  f.tab.status = "complete";
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toBe(2);
  expect(f.verify).toHaveBeenCalledTimes(1);
});
it("bounds page load wait without creating extra tabs", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.tab.status = "loading";
  const result = f.ensure().catch((e) => e);
  await vi.advanceTimersByTimeAsync(20100);
  expect((await result).code).toBe("work_tab_loading_timeout");
  expect(f.tabs.create).toHaveBeenCalledTimes(1);
});
it("pause/disconnect during creation cancels without restoring connection", async () => {
  const f = fixture();
  f.tabs.create.mockImplementation(async () => {
    f.cancel();
    delete f.data.connection;
    return f.tab;
  });
  await expect(f.ensure()).rejects.toMatchObject({ code: "cancelled" });
  expect(f.data.connection).toBeUndefined();
  expect(f.verify).not.toHaveBeenCalled();
});
it("revives a discarded work tab without replacing it", async () => {
  const f = fixture();
  f.data.connection.tabId = 2;
  f.data["workspace:background_tab"] = { id: 2 };
  f.tab.discarded = true;
  expect(await f.ensure()).toBe(2);
  expect(f.tabs.reload).toHaveBeenCalledExactlyOnceWith(2);
  expect(f.tabs.create).not.toHaveBeenCalled();
});

it("accepts an interactive exact document despite lingering resource loads", async () => {
  const ready = vi.fn(async () => true),
    f = fixture(ready);
  f.tab.status = "loading";
  expect(await f.ensure()).toBe(2);
  expect(ready).toHaveBeenCalledWith(2, "https://www.linkedin.com/feed/");
  expect(f.verify).toHaveBeenCalledTimes(1);
});
it("never mistakes the old interactive document for a pending navigation", async () => {
  vi.useFakeTimers();
  const ready = vi.fn(async () => true),
    f = fixture(ready);
  f.tab.status = "loading";
  f.tab.pendingUrl = "https://www.linkedin.com/in/next/";
  const result = f.ensure().catch((e) => e);
  await vi.advanceTimersByTimeAsync(20100);
  expect((await result).code).toBe("work_tab_loading_timeout");
  expect(ready).not.toHaveBeenCalled();
});

it("never adopts a personal LinkedIn tab when Chrome reuses yesterday's tab ID", async () => {
  const f = fixture();
  delete f.data["workspace:background_tab"];
  f.tabs.get.mockImplementation(async (id) =>
    id === 1 ? { ...f.tab, id: 1 } : f.tab,
  );
  expect(await f.ensure()).toBe(2);
  expect(f.tabs.create).toHaveBeenCalledExactlyOnceWith({
    windowId: 1,
    url: "https://www.linkedin.com/feed/",
    active: false,
  });
  expect(f.tabs.get).not.toHaveBeenCalledWith(1);
});
it("keeps the agent window unfocused, shares it across requests, and only reveals it on explicit request", async () => {
  const f = fixture();
  f.data.workspaceMode = "separate_window";
  f.tab.windowId = 42;
  const marker = "chrome-extension://test/workspace.html";
  const anchor = { id: 7, windowId: 42, url: marker, active: true };
  const windows = {
    getLastFocused: vi.fn(async () => ({ id: 1 })),
    create: vi.fn(async () => ({ id: 42, tabs: [anchor] })),
    update: vi.fn(),
  };
  let created = false;
  const tabs = {
    ...f.tabs,
    query: vi.fn(async () => (created ? [anchor] : [])),
    update: vi.fn(),
  };
  vi.stubGlobal("chrome", { tabs, windows, runtime: { getURL: () => marker } });
  expect(await Promise.all([f.ensure(), f.ensure()])).toEqual([2, 2]);
  expect(await f.ensure.placement.actualMode()).toBe("background_tab");
  expect(windows.create).not.toHaveBeenCalled();
  expect(tabs.create).toHaveBeenCalledExactlyOnceWith({
    windowId: 1,
    url: "https://www.linkedin.com/feed/",
    active: false,
  });
  await f.ensure.placement.show(() => {});
  expect(windows.create).toHaveBeenCalledExactlyOnceWith({
    url: marker,
    state: "minimized",
    focused: false,
    type: "normal",
  });
  expect(tabs.create).toHaveBeenLastCalledWith({
    windowId: 42,
    openerTabId: 7,
    url: "https://www.linkedin.com/feed/",
    active: false,
  });
  expect(tabs.update).toHaveBeenCalledExactlyOnceWith(2, { active: true });
  expect(windows.update).toHaveBeenCalledExactlyOnceWith(42, {
    state: "normal",
    focused: true,
  });
  created = true;
  expect(await f.ensure()).toBe(2);
  expect(await f.ensure.placement.actualMode()).toBe("separate_window");
  expect(windows.create).toHaveBeenCalledTimes(1);
});

it("replaces a previously timed-out navigation on the next request and bounds repeat replacements", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const stuck = {
    ...f.tab,
    id: 1,
    status: "complete",
    pendingUrl: "https://www.linkedin.com/posts/next/",
  };
  f.tabs.get.mockImplementation(async (id) => (id === 1 ? stuck : f.tab));
  const first = f.ensure().catch((e) => e);
  await vi.advanceTimersByTimeAsync(20100);
  expect((await first).code).toBe("work_tab_loading_timeout");
  expect(f.tabs.create).not.toHaveBeenCalled();
  expect(await f.ensure()).toBe(2);
  expect(f.verify).toHaveBeenCalledExactlyOnceWith(2, "me");
  f.tab.status = "loading";
  for (let i = 0; i < 2; i++) {
    const pending = f.ensure().catch((e) => e);
    await vi.advanceTimersByTimeAsync(20100);
    expect((await pending).code).toBe("work_tab_loading_timeout");
  }
  expect(f.tabs.create).toHaveBeenCalledTimes(1);
});

it("reuses an inactive LinkedIn tab after reload only with the extension page as its actual opener", async () => {
  const f = fixture();
  f.data.workspaceMode = "separate_window";
  f.data.connection.tabId = 2;
  const url = "chrome-extension://test/workspace.html",
    anchor = { id: 7, windowId: 42, url };
  Object.assign(f.tab, { windowId: 42, openerTabId: 7, active: false });
  const tabs = { ...f.tabs, query: vi.fn(async () => [anchor]) };
  const windows = { create: vi.fn(), update: vi.fn() };
  vi.stubGlobal("chrome", { tabs, windows, runtime: { getURL: () => url } });
  expect(await f.ensure()).toBe(2);
  expect(tabs.create).not.toHaveBeenCalled();
  delete f.data["workspace:separate_window"];
  f.tab.openerTabId = 77;
  await f.ensure();
  expect(tabs.create).toHaveBeenCalledExactlyOnceWith({
    windowId: 42,
    openerTabId: 7,
    url: "https://www.linkedin.com/feed/",
    active: false,
  });
  expect(windows.create).not.toHaveBeenCalled();
  expect(windows.update).not.toHaveBeenCalled();
});
it("leaves a human-selected work tab alone when the next agent operation begins", async () => {
  const f = fixture();
  f.data["workspace:background_tab"] = { id: 2 };
  f.tab.active = true;
  const replacement = { ...f.tab, active: false, id: 3 };
  f.tabs.create.mockResolvedValue(replacement);
  expect(await f.ensure()).toBe(3);
  expect(f.tabs.create).toHaveBeenCalledExactlyOnceWith({
    windowId: 1,
    active: false,
    url: "https://www.linkedin.com/feed/",
  });
  expect(f.verify).toHaveBeenCalledWith(3, "me");
});
