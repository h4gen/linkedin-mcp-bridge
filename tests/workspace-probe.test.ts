import { afterEach, it, expect, vi } from "vitest";
import { workspaceProbe } from "../src/extension/workspace-probe.js";
import { pageFetch } from "../src/extension/page-fetch.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("records transient focus changes even when both samples end in the background", async () => {
  let focus = (id: number) => {};
  const script = vi.fn(async () => [
    {
      documentId: "doc",
      result: {
        visibility: "hidden",
        documentFocused: false,
        ready: "complete",
      },
    },
  ]);
  vi.stubGlobal("chrome", {
    tabs: {
      get: async () => ({ id: 1, active: false, windowId: 2 }),
      query: async () => [{ id: 3 }],
    },
    windows: {
      getLastFocused: async () => ({ id: 2, focused: true }),
      onFocusChanged: {
        addListener: (fn: typeof focus) => {
          focus = fn;
        },
      },
    },
    scripting: { executeScript: script },
  });
  const probe = workspaceProbe();
  await probe.sample("entry", "read", 1);
  expect(script).not.toHaveBeenCalled();
  probe.start();
  const mark = probe.begin("read");
  await probe.sample("entry", "read", 1);
  focus(5);
  focus(2);
  await probe.finish("read", mark, 1, true);
  expect(probe.last()).toMatchObject({
    complete: true,
    window_focus_events: 2,
    work_foreground: false,
    visibility: ["hidden"],
  });
  vi.useFakeTimers();
  script.mockImplementation(() => new Promise(() => {}));
  const m = probe.begin("frozen");
  const pending = probe.finish("frozen", m, 1, false);
  await vi.advanceTimersByTimeAsync(800);
  await pending;
  expect(probe.last()).toMatchObject({ complete: false });
});
it("does not send an API mutation when a suspended page wakes after its deadline", async () => {
  vi.stubGlobal("location", new URL("https://www.linkedin.com/feed/"));
  vi.stubGlobal("document", { cookie: 'JSESSIONID="fixture"' });
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  expect(
    await pageFetch({
      method: "POST",
      path: "/voyagerMessagingDashMessengerMessages",
      execution_deadline: Date.now() - 1,
    }),
  ).toEqual({ error: "deadline_exceeded" });
  expect(send).not.toHaveBeenCalled();
});
