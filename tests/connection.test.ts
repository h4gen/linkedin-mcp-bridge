import { it, expect, vi, afterEach } from "vitest";
import vm from "node:vm";
import fs from "node:fs/promises";
import { VERSION, PROTOCOL } from "../src/version.js";
const account = "urn:li:fsd_profile:me";
afterEach(() => vi.useRealTimers());
async function harness(
  options: {
    missing?: boolean;
    paused?: boolean;
    schema?: string;
    local?: any;
  } = {},
) {
  const local: any = options.local ?? {
    schemaVersion: options.schema ?? VERSION,
    connection: { tabId: 10, account, paused: options.paused ?? false },
    workTabId: 10,
  };
  const session: any = {};
  const area = (data: any) => ({
    get: async (k: string | null) =>
      k === null ? { ...data } : { [k!]: data[k!] },
    set: async (v: any) => {
      Object.assign(data, v);
    },
    remove: async (k: string | string[]) => {
      for (const key of Array.isArray(k) ? k : [k]) delete data[key];
    },
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
    },
  });
  const tabs = new Map<number, any>();
  if (!options.missing)
    tabs.set(10, {
      id: 10,
      url: "https://www.linkedin.com/feed/",
      status: "complete",
    });
  const ports: any[] = [];
  let popup: any;
  let alarm: any;
  let pageError: string | undefined;
  let currentAccount = account;
  let scriptError = false;
  const chrome: any = {
    storage: { local: area(local), session: area(session) },
    tabs: {
      get: vi.fn(async (id: number) => {
        if (!tabs.has(id)) throw Error(`No tab with id: ${id}.`);
        return tabs.get(id);
      }),
      create: vi.fn(async (opts: any) => {
        const t = { ...opts, id: 20 + tabs.size, status: "complete" };
        tabs.set(t.id, t);
        return t;
      }),
      update: vi.fn(async (id: number, opts: any) =>
        Object.assign(tabs.get(id), opts),
      ),
    },
    scripting: {
      executeScript: vi.fn(async (opts: any) => {
        if (scriptError) throw Error("Frame was removed.");
        if (!tabs.has(opts.target.tabId)) throw Error("No tab with id");
        return [
          {
            result: pageError
              ? { error: pageError }
              : {
                  data: {
                    data: { miniProfile: { entityUrn: currentAccount } },
                  },
                },
          },
        ];
      }),
    },
    runtime: {
      id: "extension",
      getURL: (s: string) => "chrome-extension://extension/" + s,
      getManifest: () => ({ version: VERSION }),
      onMessage: {
        addListener: (fn: any) => {
          popup = fn;
        },
      },
      connectNative: vi.fn(() => {
        const p: any = {
          onMessage: {
            addListener: (fn: any) => {
              p.receive = fn;
            },
          },
          onDisconnect: {
            addListener: (fn: any) => {
              p.close = fn;
            },
          },
          postMessage: vi.fn(),
          disconnect: () => p.close(),
        };
        ports.push(p);
        return p;
      }),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: {
        addListener: (fn: any) => {
          alarm = fn;
        },
      },
    },
  };
  vm.runInNewContext(
    await fs.readFile("dist/extension/background.js", "utf8"),
    {
      chrome,
      console,
      crypto: globalThis.crypto,
      setTimeout,
      clearTimeout,
      TextEncoder,
      URLSearchParams,
      URL,
    },
  );
  const action = (action: string) =>
    new Promise<any>((resolve) =>
      popup(
        { action },
        { id: "extension", url: chrome.runtime.getURL("popup.html") },
        resolve,
      ),
    );
  await action("status");
  const request = async (op = "health", args = {}) => {
    const p = ports.at(-1);
    const id = crypto.randomUUID();
    await p.receive({
      id,
      op,
      args,
      protocol: PROTOCOL,
      hostVersion: VERSION,
      deadline: Date.now() + 60000,
    });
    return p.postMessage.mock.calls.find((c: any) => c[0].id === id)?.[0];
  };
  return {
    local,
    session,
    tabs,
    ports,
    chrome,
    action,
    request,
    alarm: () => alarm({ name: "host-reconnect" }),
    pageError: (e: string) => {
      pageError = e;
    },
    currentAccount: (a: string) => {
      currentAccount = a;
    },
    scriptError: () => {
      scriptError = true;
    },
  };
}
it("health recreates a lost work tab without reconnecting and serves parallel clients", async () => {
  const h = await harness({ missing: true });
  const replies = await Promise.all([h.request(), h.request()]);
  expect(replies.map((r) => r.result.connected)).toEqual([true, true]);
  expect(h.chrome.tabs.create).toHaveBeenCalledTimes(1);
  expect(h.chrome.tabs.create.mock.calls[0][0].active).toBe(false);
  expect(h.local.connection.account).toBe(account);
  expect(h.local.connection.tabId).not.toBe(10);
});

it("restores after a worker/browser restart with changed tab IDs", async () => {
  const first = await harness();
  expect((await first.request()).result.connected).toBe(true);
  const restarted = await harness({ local: first.local, missing: true });
  expect((await restarted.request()).result.connected).toBe(true);
  expect(restarted.chrome.tabs.create).toHaveBeenCalledTimes(1);
});
it("recovers when the work tab closes between requests and invalidates DOM cursors", async () => {
  const h = await harness();
  expect((await h.request()).result.connected).toBe(true);
  h.session["cursor:dom"] = { state: { dom_session: "old" } };
  h.session["cursor:api"] = { state: { offset: 1 } };
  h.tabs.clear();
  expect((await h.request()).result.connected).toBe(true);
  expect(h.session["cursor:dom"]).toBeUndefined();
  expect(h.session["cursor:api"]).toEqual({ state: { offset: 1 } });
});
it.each([false, true])(
  "compatible migration preserves explicit pause=%s and receipts",
  async (paused) => {
    const h = await harness({ paused, schema: "0.3.0", missing: true });
    expect(h.local.connection.paused).toBe(paused);
    expect(h.local.schemaVersion).toBe(2);
    const reply = (await h.request()).result;
    expect(reply.connected).toBe(!paused);
    if (paused) {
      expect(reply.error).toBe("connection_paused");
      expect(h.chrome.tabs.create).not.toHaveBeenCalled();
    }
  },
);
it.each(["not_logged_in", "session_blocked"])(
  "preserves real session error %s without creating more tabs",
  async (error) => {
    const h = await harness({ missing: true });
    h.pageError(error);
    expect((await h.request()).result.error).toBe(error);
    expect((await h.request()).result.error).toBe(error);
    expect(h.chrome.tabs.create).toHaveBeenCalledTimes(1);
  },
);
it("refuses a changed account without changing the saved binding", async () => {
  const h = await harness({ missing: true });
  h.currentAccount("urn:li:fsd_profile:other");
  expect((await h.request()).result.error).toBe("account_changed");
  expect(h.local.connection.account).toBe(account);
});
it("distinguishes browser execution from missing native transport", async () => {
  const h = await harness();
  h.scriptError();
  const health = (await h.request()).result;
  expect(health.error).toBe("browser_execution_failed");
  expect(health.connection).toEqual({
    transport: "connected",
    session: "unavailable",
    stage: "tab",
  });
});
it("reconnects the native host with backoff and exposes the disconnect cause", async () => {
  vi.useFakeTimers();
  const h = await harness();
  h.chrome.runtime.lastError = { message: "Native host exited." };
  h.ports[0].close();
  expect((await h.action("status")).nativeError).toBe("Native host exited.");
  await vi.advanceTimersByTimeAsync(999);
  expect(h.ports).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.ports).toHaveLength(2);
  h.ports[1].close();
  await vi.advanceTimersByTimeAsync(1999);
  expect(h.ports).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.ports).toHaveLength(3);
  const pending = h.request();
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).result.connected).toBe(true);
  expect((await h.action("status")).nativeError).toBeUndefined();
});
it("explicit disconnect prevents scheduled reconnect and tab recovery", async () => {
  vi.useFakeTimers();
  const h = await harness();
  await h.action("disconnect");
  await vi.advanceTimersByTimeAsync(60000);
  await h.alarm();
  expect(h.local.connection).toBeUndefined();
  expect(h.ports).toHaveLength(1);
  expect(h.chrome.tabs.create).not.toHaveBeenCalled();
});

it("recovers when the tab vanishes between lookup and read injection", async () => {
  const h = await harness();
  h.chrome.scripting.executeScript.mockImplementationOnce(async () => {
    h.tabs.clear();
    throw Error("No tab with id: 10.");
  });
  expect((await h.request()).result.connected).toBe(true);
  expect(h.chrome.tabs.create).toHaveBeenCalledTimes(1);
});
it("cancels queued work belonging to a dead native port", async () => {
  vi.useFakeTimers();
  const h = await harness();
  const read = h.request();
  const queuedWrite = h.request("message_send", {
    account_urn: account,
    recipient_urn: "urn:li:fsd_profile:friend",
    expected_participant_urns: ["urn:li:fsd_profile:friend"],
    text: "Never send",
    idempotency_key: "dead-port-queue",
  });
  h.ports[0].close();
  await vi.advanceTimersByTimeAsync(5000);
  await Promise.all([read, queuedWrite]);
  expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(h.local.journal).toBeUndefined();
});

it("stops a request that loses its host while waiting for request pacing", async () => {
  vi.useFakeTimers();
  const h = await harness();
  const first = h.request();
  await vi.advanceTimersByTimeAsync(1);
  await first;
  h.chrome.scripting.executeScript.mockClear();
  const paced = h.request();
  await vi.advanceTimersByTimeAsync(100);
  h.ports[0].close();
  await vi.advanceTimersByTimeAsync(2000);
  await paced;
  expect(h.chrome.scripting.executeScript).not.toHaveBeenCalled();
});
it("survives twenty successive host and tab losses without accumulating tabs", async () => {
  vi.useFakeTimers();
  const h = await harness();
  for (let i = 0; i < 20; i++) {
    h.tabs.clear();
    h.ports.at(-1).close();
    await vi.advanceTimersByTimeAsync(1000);
    const pending = h.request();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).result.connected).toBe(true);
    expect(h.tabs.size).toBe(1);
  }
  expect(h.ports).toHaveLength(21);
  expect(h.chrome.tabs.create).toHaveBeenCalledTimes(20);
});
