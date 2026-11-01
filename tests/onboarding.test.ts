import { expect, it } from "vitest";
import fs from "node:fs/promises";
import vm from "node:vm";
import { VERSION, PROTOCOL } from "../src/version.js";

async function boot(local: Record<string, any> = {}) {
  const session: Record<string, any> = {};
  const area = (data: Record<string, any>) => ({
    get: async (k: string | null) =>
      k === null ? { ...data } : { [k]: data[k] },
    set: async (v: any) => {
      Object.assign(data, v);
    },
    remove: async (ks: string | string[]) => {
      for (const k of [ks].flat()) delete data[k];
    },
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
    },
  });
  let message: any, installed: any, nativeMessage: any, alarm: any;
  let gate: Promise<void> | undefined;
  let failure: string | undefined;
  let account = "urn:li:fsd_profile:me";
  const tabs = new Map<number, any>();
  let created = 0,
    fetches = 0,
    ports = 0;
  const chrome: any = {
    storage: { local: area(local), session: area(session) },
    runtime: {
      id: "extension",
      getURL: (p: string) => "chrome-extension://extension/" + p,
      getManifest: () => ({ version: VERSION }),
      onMessage: { addListener: (f: any) => (message = f) },
      onInstalled: { addListener: (f: any) => (installed = f) },
      connectNative: () => {
        ports++;
        return {
          onMessage: { addListener: (f: any) => (nativeMessage = f) },
          onDisconnect: { addListener() {} },
          postMessage() {},
          disconnect() {},
        };
      },
    },
    action: { onClicked: { addListener() {} } },
    tabs: {
      query: async () => [...tabs.values()],
      get: async (id: number) => {
        if (!tabs.has(id)) throw Error("missing");
        return tabs.get(id);
      },
      create: async (o: any) => {
        const t = { ...o, id: ++created, status: "complete" };
        tabs.set(t.id, t);
        return t;
      },
      update: async (id: number, o: any) => Object.assign(tabs.get(id), o),
      onUpdated: { addListener() {} },
    },
    scripting: {
      executeScript: async (o: any) => {
        fetches++;
        if (gate) await gate;
        if (failure) return [{ result: { error: failure } }];
        return [
          {
            result: {
              data: {
                data: {
                  miniProfile: {
                    entityUrn: account,
                    firstName: "Test",
                    lastName: "Person",
                  },
                },
              },
            },
          },
        ];
      },
    },
    alarms: { create() {}, onAlarm: { addListener: (f: any) => (alarm = f) } },
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
      URL,
      URLSearchParams,
    },
  );
  const action = (name: string, url = "setup.html") =>
    new Promise<any>((resolve) =>
      message(
        { action: name },
        { id: "extension", url: chrome.runtime.getURL(url) },
        resolve,
      ),
    );
  await action("status");
  return {
    local,
    tabs,
    session,
    delay: (p: Promise<void>) => {
      gate = p;
    },
    failure: (e: string | undefined) => {
      failure = e;
    },
    action,
    installed: async (reason: string) => {
      await installed({ reason });
    },
    hello: async (version = VERSION) => {
      await nativeMessage?.({
        type: "hello",
        hostVersion: version,
        protocol: PROTOCOL,
        channel: "development",
      });
    },
    alarm: async () => alarm({ name: "host-reconnect" }),
    stats: () => ({ created, fetches, ports }),
    account: (v: string) => {
      account = v;
    },
  };
}
it("fresh install opens one setup page, detects the host and binds LinkedIn without a Connect action", async () => {
  const h = await boot();
  await h.installed("install");
  await h.installed("install");
  expect(
    [...h.tabs.values()].filter((t) => t.url.endsWith("setup.html")),
  ).toHaveLength(1);
  expect(h.local.connection).toBeUndefined();
  await h.hello();
  expect(h.local.connection.account).toBe("urn:li:fsd_profile:me");
  expect((await h.action("status")).nativeReady).toBe(true);
  await h.installed("update");
  expect(h.stats().created).toBe(2);
});
it("keeps legacy disconnect and pause intentional, including worker restart", async () => {
  for (const connection of [
    undefined,
    { account: "urn:li:fsd_profile:me", paused: true, tabId: 5 },
  ]) {
    const local = {
      schemaVersion: 2,
      identitySchemaVersion: 1,
      connection,
      journal: { receipt: { status: "confirmed" } },
    };
    const h = await boot(local);
    await h.hello();
    expect(h.stats().fetches).toBe(0);
    const restarted = await boot(local);
    await restarted.hello();
    expect(restarted.stats().fetches).toBe(0);
    expect(local.journal.receipt.status).toBe("confirmed");
  }
});
it("never binds on a mismatched native handshake and clear remains disconnected", async () => {
  const h = await boot();
  await h.hello("0.1.0");
  expect(h.local.connection).toBeUndefined();
  expect((await h.action("status")).nativeReady).toBe(false);
  await h.action("clear");
  const restarted = await boot(h.local);
  await restarted.hello();
  expect(restarted.local.connection).toBeUndefined();
});
it("ships one options surface with a copyable agent setup and no consent or popup", async () => {
  const m = JSON.parse(
    await fs.readFile("dist/extension/manifest.json", "utf8"),
  );
  expect(m.action.default_popup).toBeUndefined();
  expect(m.options_ui).toEqual({ page: "setup.html", open_in_tab: true });
  const html = await fs.readFile("dist/extension/setup.html", "utf8");
  expect(html).toContain("Copy setup instructions");
  expect(html).not.toMatch(/id="consent"|Connect this LinkedIn tab/);
});

it("resumes after login without spawning more tabs and refuses an account switch", async () => {
  const h = await boot();
  h.failure("not_logged_in");
  await h.hello();
  expect(h.local.connection).toBeUndefined();
  const created = h.stats().created;
  h.failure(undefined);
  await h.action("check-setup");
  expect(h.stats().created).toBe(created);
  expect(h.local.connection.account).toBe("urn:li:fsd_profile:me");
  h.account("urn:li:fsd_profile:other");
  await h.action("check-setup");
  expect(h.local.connection.account).toBe("urn:li:fsd_profile:me");
  expect((await h.action("status")).setupError).toBe("account_changed");
  await h.action("use-current-account");
  expect(h.local.connection.account).toBe("urn:li:fsd_profile:other");
});
it("deduplicates parallel initial checks and cancels binding on deliberate disconnect", async () => {
  const h = await boot();
  let release!: () => void;
  h.delay(new Promise<void>((r) => (release = r)));
  const first = h.hello();
  const second = h.action("check-setup");
  for (let i = 0; i < 20 && !h.stats().fetches; i++)
    await new Promise((r) => setTimeout(r, 1));
  expect(h.stats().created).toBe(1);
  await h.action("disconnect");
  release();
  await Promise.all([first, second]);
  expect(h.local.connection).toBeUndefined();
  const restarted = await boot(h.local);
  expect(restarted.stats().ports).toBe(0);
});
it("invalidates old DOM state when setup recovery replaces a lost work tab", async () => {
  const h = await boot();
  await h.hello();
  h.session["cursor:dom"] = { state: { dom_session: "old" } };
  h.session["cursor:api"] = { state: { offset: 1 } };
  h.tabs.clear();
  await h.action("check-setup");
  expect(h.session["cursor:dom"]).toBeUndefined();
  expect(h.session["cursor:api"]).toBeDefined();
});
