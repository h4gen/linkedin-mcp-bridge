import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import fs from "node:fs/promises";
import { VERSION, PROTOCOL } from "../src/version.js";
const account = "urn:li:fsd_profile:me";
const windows: JSDOM[] = [];
afterEach(() => {
  for (const d of windows.splice(0)) d.window.close();
});
const card = (i: number) =>
  `<div role="listitem" componentkey="postContentUrn:urn:li:activity:${100 + i}"><button aria-label="Open control menu for post by Author ${i}"></button><p data-testid="expandable-text-box">Useful post ${i}</p></div>`;
it.each([
  "document_changed",
  "path_changed",
  "user_interaction",
  "session_marker_missing",
  "filters_changed",
  "context_version_mismatch",
])("retains cursor invalidation with diagnostic %s", async (reason) => {
  const h = await harness(),
    args = { query: "fixture", sort: "latest", date_posted: "week", limit: 3 };
  const first = await h.request("posts_search", args);
  expect(first.error).toBeUndefined();
  if (reason === "document_changed") h.changeDocument();
  if (reason === "path_changed") h.w.history.replaceState({}, "", "/feed/");
  if (reason === "user_interaction") h.userClick();
  if (reason === "session_marker_missing") delete h.w.__liBridgeSession;
  if (reason === "filters_changed")
    h.w.document
      .getElementById("date")
      .setAttribute("aria-label", "Filter by Past month");
  if (reason === "context_version_mismatch")
    delete h.session["cursor:" + first.result.next_cursor].state.dom_context;
  const next = await h.request("posts_search", {
    ...args,
    cursor: first.result.next_cursor,
  });
  expect(next.error).toMatchObject({ code: "cursor_invalidated", reason });
});
it("invalidates an old traversal when another DOM primitive starts", async () => {
  const h = await harness(),
    args = {
      query: "fixture",
      sort: "relevance",
      date_posted: "any",
      limit: 3,
    };
  const first = await h.request("posts_search", args);
  expect(first.error).toBeUndefined();
  expect((await h.request("feed_list", { limit: 2 })).error).toBeUndefined();
  expect(
    (
      await h.request("posts_search", {
        ...args,
        cursor: first.result.next_cursor,
      })
    ).error,
  ).toMatchObject({ code: "cursor_invalidated" });
});
async function harness() {
  const dom = new JSDOM("<main></main>", {
    url: "https://www.linkedin.com/feed/",
    runScripts: "outside-only",
  });
  windows.push(dom);
  const w = dom.window as any;
  w.crypto.randomUUID = () => crypto.randomUUID();
  w.Element.prototype.getClientRects = () => [{}];
  const clicks: Array<(event: any) => void> = [];
  const add = w.document.addEventListener.bind(w.document);
  w.document.addEventListener = (
    type: string,
    listener: any,
    ...rest: any[]
  ) => {
    if (type === "click") clicks.push(listener);
    return add(type, listener, ...rest);
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const fastTimeout = (fn: any, ms: number, ...args: any[]) =>
    setTimeout(fn, Math.min(ms ?? 0, 2), ...args);
  w.setTimeout = fastTimeout;
  w.clearTimeout = clearTimeout;
  let interactDuringFilter = false;
  let apiEntities: any[] = [];
  let documentId = "document-1",
    scrolls = 0;
  const local: any = {
    schemaVersion: 2,
    connection: { tabId: 10, account, paused: false },
    workTabId: 10,
  };
  const session: any = {};
  const area = (data: any) => ({
    // Chrome storage does not preserve object property insertion order.
    get: async (k: string | null) =>
      JSON.parse(
        JSON.stringify(
          k === null ? { ...data } : { [k]: data[k] },
          (_key, value) =>
            value && typeof value === "object" && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
                )
              : value,
        ),
      ),
    set: async (v: any) => Object.assign(data, v),
    remove: async (k: string | string[]) => {
      for (const x of Array.isArray(k) ? k : [k]) delete data[x];
    },
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
    },
  });
  const tab: any = { id: 10, url: w.location.href, status: "complete" };
  function searchPage() {
    w.document.body.innerHTML =
      '<button id="sort" aria-label="Filter by Sort by">Sort</button><button id="date" aria-label="Filter by Date posted">Date</button><main>' +
      Array.from({ length: 12 }, (_, i) => card(i)).join("") +
      "</main>";
    for (const [id, values] of [
      ["sort", ["Top Match", "Latest"]],
      ["date", ["Past 24 hours", "Past week", "Past month"]],
    ] as const) {
      const button = w.document.getElementById(id);
      button.onclick = () => {
        const menu = w.document.createElement("div");
        let selected = "";
        menu.innerHTML =
          values.map((v) => `<label>${v}</label>`).join("") +
          "<button>Show results</button>";
        menu.querySelectorAll("label").forEach(
          (e: any) =>
            (e.onclick = () => {
              selected = e.textContent;
            }),
        );
        menu.querySelector("button").onclick = () => {
          button.setAttribute("aria-label", "Filter by " + selected);
          // Same-document source transition, exactly the regression class.
          const url = new URL(w.location.href);
          url.searchParams.set(id, selected);
          w.history.replaceState({}, "", url.href);
          tab.url = url.href;
          menu.remove();
          if (interactDuringFilter)
            for (const listener of clicks)
              listener({ isTrusted: true, target: button });
        };
        w.document.body.append(menu);
      };
    }
  }
  Object.defineProperty(w.document, "scrollingElement", {
    get: () => w.document.documentElement,
  });
  w.document.documentElement.scrollBy = () => {
    scrolls++;
  };
  let receive: any, popup: any;
  const messages: any[] = [];
  const chrome: any = {
    storage: { local: area(local), session: area(session) },
    tabs: {
      get: async () => ({ ...tab }),
      update: async (_id: number, opts: any) => {
        Object.assign(tab, opts);
        if (opts.url) {
          dom.reconfigure({ url: opts.url });
          if (opts.url.includes("/search/")) searchPage();
        }
        return { ...tab };
      },
      reload: async () => searchPage(),
    },
    scripting: {
      executeScript: async (opts: any) => {
        if (
          opts.target.documentIds &&
          !opts.target.documentIds.includes(documentId)
        )
          throw Error("No document");
        if (opts.files) {
          for (const file of opts.files)
            w.eval(await fs.readFile("dist/extension/" + file, "utf8"));
          return [{ documentId, result: undefined }];
        }
        if (opts.func.name === "pageFetch")
          return [
            {
              documentId,
              result: {
                data:
                  opts.args[0].path === "/me"
                    ? { data: { miniProfile: { entityUrn: account } } }
                    : { data: { elements: [] }, included: apiEntities },
              },
            },
          ];
        const fn = w.eval("(" + opts.func.toString() + ")");
        const result = await fn(...JSON.parse(JSON.stringify(opts.args ?? [])));
        return [
          {
            documentId,
            result:
              result === undefined
                ? undefined
                : JSON.parse(JSON.stringify(result)),
          },
        ];
      },
    },
    runtime: {
      id: "extension",
      getURL: (s: string) => "chrome-extension://extension/" + s,
      getManifest: () => ({ version: VERSION }),
      onMessage: {
        addListener: (f: any) => {
          popup = f;
        },
      },
      connectNative: () => ({
        onMessage: {
          addListener: (f: any) => {
            receive = f;
          },
        },
        onDisconnect: { addListener() {} },
        postMessage: (m: any) => messages.push(m),
      }),
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
  };
  vm.runInNewContext(
    await fs.readFile("dist/extension/background.js", "utf8"),
    {
      chrome,
      console,
      crypto,
      TextEncoder,
      URL,
      URLSearchParams,
      setTimeout: fastTimeout,
      clearTimeout,
    },
  );
  await new Promise((resolve) =>
    popup(
      { action: "status" },
      { id: "extension", url: chrome.runtime.getURL("popup.html") },
      resolve,
    ),
  );
  return {
    w,
    session,
    setApiEntities: (value: any[]) => {
      apiEntities = value;
    },
    tab,
    mount(url: string, html: string) {
      dom.reconfigure({ url });
      tab.url = url;
      w.document.body.innerHTML = html;
      documentId = crypto.randomUUID();
    },
    scrolls: () => scrolls,
    interruptFilter: () => {
      interactDuringFilter = true;
    },
    userClick: () => {
      for (const listener of clicks)
        listener({
          isTrusted: true,
          target: w.document.querySelector("button"),
        });
    },
    changeDocument: () => {
      documentId = "document-2";
    },
    async request(op: string, args: any = {}) {
      const id = crypto.randomUUID();
      await receive({
        id,
        op,
        args: { account_urn: account, ...args },
        protocol: PROTOCOL,
        hostVersion: VERSION,
        deadline: Date.now() + 60000,
      });
      return messages.find((m) => m.id === id);
    },
  };
}
it.each(["share", "ugcPost"])(
  "uses the built bundle for resolve → get → comments/reactions pagination on %s",
  async (kind) => {
    const h = await harness(),
      url = `https://www.linkedin.com/posts/example_topic-${kind}-123-test/`;
    const comment = (id: number) =>
      `<div componentkey="replaceableComment_urn:li:comment:(${kind}:123,${id})"><a href="/in/author-${id}/"><p>Author ${id}</p></a><button aria-label="View more options for Author ${id}’s comment."></button><p data-testid="expandable-text-box">Useful question ${id}</p></div>`;
    h.mount(
      url,
      `<main><div componentkey="pagedCommentsContainer"><div role="listitem"><button aria-label="Open control menu for post by Author"></button><p data-testid="expandable-text-box">Relevant text</p><a href="${url}">Send</a><a id="reactions" href="${url}">3 reactions</a></div>${comment(1)}${comment(2)}</div></main>`,
    );
    h.w.document.getElementById("reactions").onclick = (event: any) => {
      event.preventDefault();
      const dialog = h.w.document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML =
        '<h2>Reactions</h2><div data-testid="lazy-column">' +
        [1, 2, 3]
          .map(
            (id) =>
              `<a href="https://www.linkedin.com/in/reactor-${id}/"><p>Reactor ${id}</p><p>Engineer</p></a>`,
          )
          .join("") +
        '</div><button aria-label="Dismiss">Close</button>';
      dialog.querySelector("button").onclick = () => dialog.remove();
      h.w.document.body.append(dialog);
    };
    const resolved = await h.request("post_resolve", { url });
    expect(resolved.error).toBeUndefined();
    const post_urn = resolved.result.entityUrn;
    expect((await h.request("post_get", { post_urn })).result.text).toBe(
      "Relevant text",
    );
    for (const operation of ["comments_list", "reactions_list"]) {
      const args = { post_urn, limit: 1 };
      const first = await h.request(operation, args);
      expect(first.error).toBeUndefined();
      expect(first.result.items).toHaveLength(1);
      const second = await h.request(operation, {
        ...args,
        cursor: first.result.next_cursor,
      });
      expect(second.error).toBeUndefined();
      expect(second.result.items).toHaveLength(1);
      expect(second.result.items[0].id).not.toBe(first.result.items[0].id);
      expect(
        (
          await h.request(operation, {
            ...args,
            cursor: first.result.next_cursor,
          })
        ).result,
      ).toEqual(second.result);
    }
  },
);
it.each(
  ["relevance", "latest"].flatMap((sort) =>
    ["any", "week", "month"].map((date_posted) => ({ sort, date_posted })),
  ),
)(
  "paginates and replays the actual built search adapter: $sort/$date_posted",
  async ({ sort, date_posted }) => {
    const h = await harness(),
      args = { query: '"LinkedIn MCP"', sort, date_posted, limit: 3 };
    const first = await h.request("posts_search", args);
    expect(first.error).toBeUndefined();
    expect(first.result.items).toHaveLength(3);
    const second = await h.request("posts_search", {
      ...args,
      cursor: first.result.next_cursor,
    });
    expect(second.error).toBeUndefined();
    const before = h.scrolls();
    const replay = await h.request("posts_search", {
      ...args,
      cursor: first.result.next_cursor,
    });
    expect(replay.result).toEqual(second.result);
    expect(h.scrolls()).toBe(before);
    const api = await h.request("invitations_list", {
      direction: "sent",
      limit: 1,
    });
    expect(api.error).toBeUndefined();
    const third = await h.request("posts_search", {
      ...args,
      cursor: second.result.next_cursor,
    });
    expect(third.error).toBeUndefined();
    const posts = [
      ...first.result.items,
      ...second.result.items,
      ...third.result.items,
    ];
    expect(posts).toHaveLength(9);
    expect(new Set(posts.map((p: any) => p.entityUrn)).size).toBe(9);
  },
);

it("does not bind a cursor over user interaction during filter preparation", async () => {
  const h = await harness();
  h.interruptFilter();
  const r = await h.request("posts_search", {
    query: "fixture",
    sort: "latest",
    date_posted: "week",
    limit: 3,
  });
  // Existing dispatch guard aborts the in-progress operation before cursor binding.
  expect(r.error).toMatchObject({ code: "cancelled" });
  expect(h.w.__liBridgeTraversal.invalidated).toBe("user_interaction");
  expect(r.result?.next_cursor).toBeUndefined();
});

it("preserves known profile references when messaging supplies only text-object names", async () => {
  const h = await harness(),
    urn = "urn:li:fsd_profile:peer";
  h.session["identity:" + urn] = {
    urn,
    name: "Old Name",
    profile_url: "https://www.linkedin.com/in/example/",
    public_identifier: "example",
  };
  h.setApiEntities([
    {
      entityUrn: urn,
      firstName: { text: "Álex" },
      lastName: { text: "Example" },
    },
  ]);
  expect(
    (await h.request("invitations_list", { direction: "sent", limit: 1 }))
      .error,
  ).toBeUndefined();
  expect(h.session["identity:" + urn]).toMatchObject({
    name: "Álex Example",
    profile_url: "https://www.linkedin.com/in/example/",
    public_identifier: "example",
  });
});
