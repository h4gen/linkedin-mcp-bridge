import { afterEach, expect, it, vi } from "vitest";
import { workTab } from "../src/extension/work-tab.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function fixture() {
  let generation = 0;
  const data: any = { connection: { tabId: 1, account: "me", paused: false } };
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
  vi.stubGlobal("chrome", { tabs });
  const verify = vi.fn(async () => {}),
    invalidate = vi.fn(async () => {});
  const ensure = workTab({
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
  f.tab.discarded = true;
  expect(await f.ensure()).toBe(2);
  expect(f.tabs.reload).toHaveBeenCalledExactlyOnceWith(2);
  expect(f.tabs.create).not.toHaveBeenCalled();
});
