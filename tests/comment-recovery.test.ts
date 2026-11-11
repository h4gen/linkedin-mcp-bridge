import { installActorPicker } from "./comment-actors-fixture.js";
import { it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { domOperation } from "../src/extension/dom.js";
import { commentHash } from "../src/core/comment-proof.js";
const start = Date.parse("2026-11-03T11:04:10Z");
const id = (t: number) =>
  `replaceableComment_urn:li:comment:(activity:123,${BigInt(t) << 22n})`;
const text = "Hello\n\nhttps://example.com/long-link";
function page() {
  const dom = new JSDOM(
    '<div data-urn="urn:li:activity:123"><button>Comment</button><div contenteditable="true" role="textbox"></div><button>Post</button></div>',
    { url: "https://www.linkedin.com/feed/" },
  );
  for (const key of [
    "window",
    "document",
    "location",
    "HTMLTextAreaElement",
    "HTMLInputElement",
    "InputEvent",
  ])
    vi.stubGlobal(
      key,
      key === "window" ? dom.window : (dom.window as any)[key],
    );
  dom.window.Element.prototype.getClientRects = () => [{}] as any;
  vi.useFakeTimers();
  vi.setSystemTime(start);
  installActorPicker(dom.window);
  return dom;
}
function add(
  t: number,
  body = "Hello https://example.com/long-link",
  author = "me",
) {
  const e = document.createElement("article");
  e.className = "comments-comment-entity";
  e.setAttribute("data-id", id(t));
  e.innerHTML = `<a href="/in/${author}/">Author</a><div class="comments-comment-entity__content">${body}</div>`;
  document.querySelector("[data-urn]")!.append(e);
  return e;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("confirms a new comment despite collapsed blank lines without a second send", async () => {
  page();
  vi.useRealTimers();
  let sends = 0;
  document.querySelectorAll("button")[1].addEventListener("click", () => {
    sends++;
    setTimeout(() => add(Date.now()), 1200);
  });
  const result = domOperation(
    "post_comment",
    {
      post_urn: "urn:li:activity:123",
      text,
      verified_actor: { profile_url: "https://www.linkedin.com/in/me/" },
    },
    {},
  );
  expect(await result).toMatchObject({ verified: true });
  expect(sends).toBe(1);
});
it("reconciles read-only using stored proof and rejects an older identical comment", async () => {
  page();
  add(start - 10000);
  const click = vi.spyOn(document.querySelectorAll("button")[1], "click");
  const proof = {
    post_urn: "urn:li:activity:123",
    actor_url: "https://www.linkedin.com/in/me/",
    text_hash: await commentHash(text),
    before_ids: [],
    observed_at: start,
  };
  const run = () =>
    domOperation(
      "post_comment",
      { post_urn: proof.post_urn, reconcile: true, comment_proof: proof },
      {},
    );
  let pending = run();
  await vi.runAllTimersAsync();
  expect((await pending).verified).toBe(false);
  expect(click).not.toHaveBeenCalled();
  const fresh = add(start + 1000);
  pending = run();
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({
    verified: true,
    receipt_id: commentId(fresh),
  });
  expect(click).not.toHaveBeenCalled();
});
function commentId(e: Element) {
  return e.getAttribute("data-id");
}

it("uses the observed destination of shortened links and ignores mentions as author proof", async () => {
  page();
  const { commentBody, commentActor } = await import(
    "../src/extension/comment-proof.js"
  );
  const e = add(
    start,
    'Hello <a href="https://example.com/long-link">https://example.com/…</a>',
  );
  expect(commentBody(e)).toBe("Hello https://example.com/long-link");
  e.querySelector("a")!.remove();
  e.querySelector("div")!.insertAdjacentHTML(
    "beforeend",
    '<a href="/in/me/">Me</a>',
  );
  expect(commentActor(e, "https://www.linkedin.com/in/me/")).toBe(false);
});
it("does not confirm two fresh matches or the wrong author", async () => {
  page();
  const proof = {
    post_urn: "urn:li:activity:123",
    actor_url: "https://www.linkedin.com/in/me/",
    text_hash: await commentHash(text),
    before_ids: [],
    observed_at: start,
  };
  add(start, "Hello https://example.com/long-link", "other");
  let p = domOperation(
    "post_comment",
    { post_urn: proof.post_urn, reconcile: true, comment_proof: proof },
    {},
  );
  await vi.runAllTimersAsync();
  expect((await p).verified).toBe(false);
  add(start + 1);
  add(start + 2);
  p = domOperation(
    "post_comment",
    { post_urn: proof.post_urn, reconcile: true, comment_proof: proof },
    {},
  );
  await vi.runAllTimersAsync();
  expect(await p).toMatchObject({
    verified: false,
    reconciliation: "comment_confirmation_ambiguous",
  });
});
it("persists pre-dispatch evidence and resolves once across engine restart without replaying a write", async () => {
  const { Engine } = await import("../src/core/engine.js");
  const data: Record<string, any> = {};
  const account = "urn:li:fsd_profile:me";
  const store = {
    get: async (k: string) => data[k],
    set: async (k: string, v: any) => {
      data[k] = structuredClone(v);
    },
    remove: async (k: string) => {
      delete data[k];
    },
  };
  const proof = {
    post_urn: "urn:li:activity:123",
    actor_url: "https://www.linkedin.com/in/me/",
    text_hash: await commentHash(text),
    before_ids: [],
    observed_at: start,
  };
  let sent = 0,
    visible = false;
  const dom = vi.fn(async (_op: any, a: any) => {
    if (a.preflight) return { comment_proof: proof };
    if (a.reconcile)
      return {
        verified: visible,
        receipt_id: visible ? id(start + 1000) : undefined,
        post_urn: proof.post_urn,
      };
    expect(Object.values(data.journal)[0]).toMatchObject({
      comment_proof: proof,
      status: "pending",
    });
    sent++;
    return { verified: false };
  });
  const deps = {
    store,
    dom,
    fetch: async () => ({ data: { miniProfile: { entityUrn: account } } }),
    account: async () => account,
    now: () => start + 10000,
    uuid: () => "origin",
    hash: commentHash,
    identity: async () => ({ name: "Me", profile_url: proof.actor_url }),
  };
  const args = {
    account_urn: account,
    post_urn: proof.post_urn,
    text,
    idempotency_key: "one-comment",
  };
  let engine = new Engine(deps);
  expect(await engine.run("post_comment", args)).toMatchObject({
    status: "unknown_outcome",
    attempt_count: 1,
  });
  expect(await engine.run("post_comment", args)).toMatchObject({
    status: "unknown_outcome",
    replayed: true,
  });
  expect(sent).toBe(1);
  visible = true;
  engine = new Engine(deps);
  expect(
    await engine.run("operation_get", {
      account_urn: account,
      idempotency_key: args.idempotency_key,
    }),
  ).toMatchObject({ status: "confirmed", receipt_id: id(start + 1000) });
  expect((Object.values(data.journal)[0] as any).status).toBe("confirmed");
  expect(await engine.run("post_comment", args)).toMatchObject({
    status: "confirmed",
    replayed: true,
  });
  expect(sent).toBe(1);
  await expect(
    engine.run("post_comment", { ...args, text: "changed" }),
  ).rejects.toThrow("idempotency_conflict");
  expect(JSON.stringify(data)).not.toContain("Hello");
});

it("waits for a comment arriving after the previous verification window", async () => {
  page();
  vi.useRealTimers();
  let sends = 0;
  document.querySelectorAll("button")[1].addEventListener("click", () => {
    sends++;
    setTimeout(() => add(Date.now()), 7200);
  });
  expect(
    await domOperation(
      "post_comment",
      {
        post_urn: "urn:li:activity:123",
        text,
        verified_actor: { profile_url: "https://www.linkedin.com/in/me/" },
      },
      {},
    ),
  ).toMatchObject({ verified: true });
  expect(sends).toBe(1);
}, 15000);

it("expands only a fresh own comment body before read-only reconciliation", async () => {
  page();
  const proof = {
    post_urn: "urn:li:activity:123",
    actor_url: "https://www.linkedin.com/in/me/",
    text_hash: await commentHash(text),
    before_ids: [],
    observed_at: start,
  };
  const row = add(
    start,
    'Hello <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fexample.com%2Flong-link">https://example.com/long-link</a><button aria-hidden="true" data-testid="expandable-text-button">… more</button>',
  );
  row.querySelector("div")!.setAttribute("data-testid", "expandable-text-box");
  // The observed SDUI button disappears when the body is expanded. A link preview
  // outside the body must not contribute text to the receipt hash.
  row.insertAdjacentHTML(
    "beforeend",
    '<a href="https://example.com/long-link">Example preview title</a>',
  );
  const older = add(
    start - 10000,
    '<span data-testid="expandable-text-box">Hello<button data-testid="expandable-text-button">… more</button></span>',
  );
  const other = add(
    start,
    '<span data-testid="expandable-text-box">Hello<button data-testid="expandable-text-button">… more</button></span>',
    "other",
  );
  const olderClick = vi.spyOn(older.querySelector("button")!, "click");
  const otherClick = vi.spyOn(other.querySelector("button")!, "click");
  const expand = vi.fn(() => row.querySelector("button")!.remove());
  row.querySelector("button")!.addEventListener("click", expand);
  const submit = vi.spyOn(
    document.querySelectorAll("[data-urn] > button")[1] as HTMLElement,
    "click",
  );
  const result = domOperation(
    "post_comment",
    { post_urn: proof.post_urn, reconcile: true, comment_proof: proof },
    {},
  );
  await vi.runAllTimersAsync();
  expect(await result).toMatchObject({ verified: true, receipt_id: id(start) });
  expect(expand).toHaveBeenCalledTimes(1);
  expect(olderClick).not.toHaveBeenCalled();
  expect(otherClick).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it("reports disabled post comments before dispatch", async () => {
  page();
  document.querySelector("button")!.disabled = true;
  const submit = vi.spyOn(document.querySelectorAll("button")[1], "click");
  await expect(
    domOperation(
      "post_comment",
      { post_urn: "urn:li:activity:123", text, preflight: true },
      {},
    ),
  ).resolves.toMatchObject({
    bridge_error: "post_comments_disabled",
    dispatch_state: "not_dispatched",
  });
  expect(submit).not.toHaveBeenCalled();
});

it.each([false, true])(
  "finds a hidden fresh comment with sort menu already open: %s, without sending",
  async (alreadyOpen) => {
    page();
    const proof = {
      post_urn: "urn:li:activity:123",
      actor_url: "https://www.linkedin.com/in/me/",
      text_hash: await commentHash(text),
      observed_at: start,
      before_ids: [],
    };
    const root = document.querySelector("[data-urn]")!;
    const sort = document.createElement("button");
    sort.textContent = "Most relevant";
    root.append(sort);
    sort.setAttribute("aria-expanded", "false");
    sort.onclick = () => {
      if (sort.getAttribute("aria-expanded") === "true") {
        document.querySelector('[role="menu"]')?.remove();
        sort.setAttribute("aria-expanded", "false");
        return;
      }
      sort.setAttribute("aria-expanded", "true");
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML =
        '<div role="menuitem"><p>Most recent</p><p>See all comments, the most recent comments are first</p></div>';
      menu.querySelector<HTMLElement>('[role="menuitem"]')!.onclick = () => {
        sort.textContent = "Most recent";
        sort.setAttribute("aria-expanded", "false");
        menu.remove();
        add(start);
      };
      document.body.append(menu);
    };
    if (alreadyOpen) sort.click();
    const submit = vi.spyOn(
      document.querySelectorAll("[data-urn] > button")[1] as HTMLElement,
      "click",
    );
    const result = domOperation(
      "post_comment",
      { post_urn: proof.post_urn, reconcile: true, comment_proof: proof },
      {},
    );
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({
      verified: true,
      receipt_id: id(start),
    });
    expect(submit).not.toHaveBeenCalled();
  },
);
