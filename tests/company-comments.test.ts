import { afterEach, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { Engine } from "../src/core/engine.js";
import { commentHash } from "../src/core/comment-proof.js";
import { fixtureActors, installActorPicker } from "./comment-actors-fixture.js";
import { Fault } from "../src/core/contracts.js";
const windows: JSDOM[] = [];
afterEach(() => windows.splice(0).forEach((w) => w.window.close()));
const post = "urn:li:activity:123";
const parent = "urn:li:comment:(activity:123,1234567890123456789)";
const account = "urn:li:fsd_profile:me";
async function setup(reply = false, actors = fixtureActors) {
  const page = new JSDOM(
    `<div data-urn="${post}"><button>Comment</button>${reply ? `<article class="comments-comment-entity" data-id="${parent}"><a href="/in/other">Other</a><div role="button"><button>Reply</button></div>` : ""}<div contenteditable="true" role="textbox"></div><button id="submit">Post</button>${reply ? "</article>" : ""}</div>`,
    { url: "https://www.linkedin.com/feed/", runScripts: "outside-only" },
  );
  windows.push(page);
  const w = page.window as any;
  w.Element.prototype.getClientRects = () => [{}];
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w.crypto, "subtle", { value: crypto.subtle });
  w.setTimeout = (fn: any) => setTimeout(fn, 1);
  const picker = installActorPicker(w, undefined, actors)!;
  // LinkedIn emits popstate while opening the comment editor on the same post.
  w.document.querySelector("[data-urn] > button").onclick = () =>
    w.dispatchEvent(new w.PopStateEvent("popstate"));
  await w.eval(await readFile("dist/extension/page-adapters.js", "utf8"));
  let sends = 0;
  let hide = false;
  let last: Element | undefined;
  w.document.querySelector("#submit").onclick = () => {
    sends++;
    const e = w.document.createElement("article");
    e.className = "comments-comment-entity";
    e.setAttribute(
      "data-id",
      `urn:li:comment:(activity:123,${BigInt(Date.now()) << 22n})`,
    );
    const author = actors.find(
      (a) => a.avatar === picker.trigger.querySelector("img")!.src,
    )!;
    e.innerHTML = `<a href="${author.profile_url}">${author.name}</a><div class="comments-comment-entity__content">Useful response</div>`;
    last = e;
    if (!hide)
      w.document.querySelector(reply ? "article" : "[data-urn]").append(e);
  };
  const run = async (op: any, args: any) => {
    const token = crypto.randomUUID();
    await w.__liBridgeAdapters("session_begin", { token }, {});
    const result = await w.__liBridgeAdapters(
      op,
      {
        ...args,
        execution_session: token,
        execution_deadline: Date.now() + 30000,
      },
      {},
    );
    if (result.bridge_error)
      throw new Fault(result.bridge_error, result.bridge_error, {
        dispatch_state: result.dispatch_state,
      });
    return result;
  };
  const data: Record<string, any> = {};
  const deps = {
    store: {
      get: async (k: string) => data[k],
      set: async (k: string, v: any) => {
        data[k] = structuredClone(v);
      },
      remove: async (k: string) => {
        delete data[k];
      },
    },
    fetch: async () => ({ data: { miniProfile: { entityUrn: account } } }),
    dom: run,
    account: async () => account,
    identity: async () => fixtureActors[0],
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    hash: commentHash,
  };
  return {
    w,
    picker,
    run,
    data,
    engine: new Engine(deps),
    restart: () => new Engine(deps),
    sends: () => sends,
    hide: () => {
      hide = true;
    },
    reveal: () =>
      w.document.querySelector(reply ? "article" : "[data-urn]").append(last),
  };
}
async function company(h: Awaited<ReturnType<typeof setup>>, reply = false) {
  const listing = await h.engine.run("comment_actors_list", {
    account_urn: account,
    post_urn: post,
    ...(reply ? { parent_comment_id: parent } : {}),
  });
  expect(listing.complete).toBe(true);
  expect(h.sends()).toBe(0);
  expect(h.picker.trigger.querySelector("img")!.src).toBe(
    fixtureActors[0].avatar,
  );
  return listing.items.find((a: any) => a.type === "company").actor_ref;
}
const args = {
  account_urn: account,
  post_urn: post,
  text: "Useful response",
  idempotency_key: "company-comment-1",
};
it.each([false, true])(
  "publishes as the chosen company through built adapters; reply=%s",
  async (reply) => {
    const h = await setup(reply);
    const ref = await company(h, reply);
    const input = {
      ...args,
      actor_ref: ref,
      ...(reply ? { parent_comment_id: parent } : {}),
    };
    const receipt = await h.engine.run("post_comment", input);
    expect(h.w.__liBridgeOwnedInput).toBeUndefined();
    expect(receipt).toMatchObject({
      status: "confirmed",
      actor: { type: "company", profile_url: fixtureActors[1].profile_url },
      attempt_count: 1,
    });
    if (reply) expect(receipt.parent_relation).toBe("known");
    expect(await h.engine.run("post_comment", input)).toMatchObject({
      receipt_id: receipt.receipt_id,
    });
    expect(h.sends()).toBe(1);
    await expect(
      h.engine.run("post_comment", { ...input, actor_ref: undefined }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    // Omitted actor is an explicit personal selection, despite the preceding company write.
    expect(
      await h.engine.run("post_comment", {
        ...args,
        idempotency_key: "personal-next-1",
        ...(reply ? { parent_comment_id: parent } : {}),
      }),
    ).toMatchObject({ status: "confirmed", actor: { type: "person" } });
    expect(h.sends()).toBe(2);
  },
);
it("still cancels on native input after the synchronous actor selection", async () => {
  const h = await setup();
  const ref = await company(h);
  const other = h.w.document.createElement("input");
  other.type = "checkbox";
  h.w.document.body.append(other);
  h.w.document.addEventListener("input", (event: Event) => {
    if ((event.target as HTMLInputElement).type === "radio")
      setTimeout(() => other.click(), 0);
  });
  await expect(
    h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).rejects.toMatchObject({ code: "cancelled" });
  expect(h.w.__liBridgeOwnedInput).toBeUndefined();
  expect(h.sends()).toBe(0);
});
it.each(["/feed/?other=1", "/in/other"])(
  "still cancels on an actual comment route change to %s",
  async (url) => {
    const h = await setup();
    const ref = await company(h);
    h.w.document.querySelector("[data-urn] > button").onclick = () => {
      h.w.history.replaceState({}, "", url);
      h.w.dispatchEvent(new h.w.PopStateEvent("popstate"));
    };
    expect(
      await h.engine.run("post_comment", { ...args, actor_ref: ref }),
    ).toMatchObject({ status: "failed_before_dispatch", error: "cancelled" });
    expect(h.sends()).toBe(0);
  },
);
it("recovers a company receipt after restart without opening the picker or submitting again", async () => {
  const h = await setup();
  const ref = await company(h);
  h.hide();
  expect(
    await h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).toMatchObject({ status: "unknown_outcome" });
  h.reveal();
  h.picker.trigger.remove();
  delete h.data["publishing-actors"]; // Receipts must not depend on a discovery cache.
  expect(
    await h.restart().run("operation_get", {
      account_urn: account,
      idempotency_key: args.idempotency_key,
    }),
  ).toMatchObject({
    status: "confirmed",
    attempt_count: 1,
    actor: { type: "company" },
  });
  expect(h.sends()).toBe(1);
});
it("distinguishes identically named companies by observed URLs and avatars", async () => {
  const actors = [
    ...fixtureActors,
    {
      ...fixtureActors[1],
      profile_url: "https://www.linkedin.com/company/other",
      avatar: fixtureActors[1].avatar + "-other",
    },
  ];
  const h = await setup(false, actors);
  const listing = await h.engine.run("comment_actors_list", {
    account_urn: account,
    post_urn: post,
  });
  expect(listing.items).toHaveLength(3);
  expect(new Set(listing.items.map((a: any) => a.actor_ref)).size).toBe(3);
  const chosen = listing.items.find(
    (a: any) => a.profile_url === actors[2].profile_url,
  );
  expect(
    await h.engine.run("post_comment", {
      ...args,
      actor_ref: chosen.actor_ref,
    }),
  ).toMatchObject({
    status: "confirmed",
    actor: { profile_url: actors[2].profile_url },
  });
});
it("omits unresolved or ambiguous actor identities without selecting anything", async () => {
  const h = await setup();
  const cloned = h.picker.links
    .querySelectorAll("a")[1]
    .cloneNode(true) as HTMLAnchorElement;
  cloned.href = "https://www.linkedin.com/company/duplicate";
  h.picker.links.append(cloned);
  const result = await h.engine.run("comment_actors_list", {
    account_urn: account,
    post_urn: post,
  });
  expect(result.complete).toBe(false);
  expect(result.items).toHaveLength(1);
  expect(h.sends()).toBe(0);
});
it("refuses missing parents and unknown or cross-account actor references", async () => {
  const h = await setup();
  const ref = await company(h);
  await expect(
    h.engine.run("comment_actors_list", {
      account_urn: account,
      post_urn: post,
      parent_comment_id: parent,
    }),
  ).rejects.toMatchObject({ code: "parent_comment_not_unique" });
  h.data["publishing-actors"][ref].account_urn = "urn:li:fsd_profile:other";
  await expect(
    h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).rejects.toMatchObject({ code: "actor_reference_unknown" });
  expect(h.sends()).toBe(0);
});
it("stops before dispatch if the actor changes during text entry", async () => {
  const h = await setup();
  const ref = await company(h);
  h.w.document
    .querySelector("[contenteditable]")
    .addEventListener("input", () => h.picker.setActive(0));
  expect(
    await h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).toMatchObject({
    status: "failed_before_dispatch",
    error: "comment_actor_changed",
  });
  expect(h.sends()).toBe(0);
});
it("fails closed if the actor switch disappears after discovery", async () => {
  const h = await setup();
  const ref = await company(h);
  h.picker.trigger.remove();
  await expect(
    h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).rejects.toMatchObject({ code: "comment_actor_switch_unavailable" });
  expect(h.sends()).toBe(0);
});
it("keeps personal reaction behavior after a company comment", async () => {
  const h = await setup();
  const ref = await company(h);
  expect(
    await h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).toMatchObject({ status: "confirmed" });
  const button = h.w.document.createElement("button");
  button.setAttribute("aria-label", "Reaction button state: no reaction");
  let author = "";
  button.onclick = () => {
    author = h.picker.trigger.querySelector("img")!.src;
    button.setAttribute("aria-label", "Reaction button state: Like");
  };
  h.w.document.querySelector("[data-urn]").append(button);
  expect(
    await h.engine.run("post_like", {
      account_urn: account,
      post_urn: post,
      idempotency_key: "personal-like-next",
    }),
  ).toMatchObject({ status: "confirmed" });
  expect(author).toBe(fixtureActors[0].avatar);
});
it("reads company authors without mistaking mentions or nested replies for authors", async () => {
  const h = await setup();
  const root = h.w.document.querySelector("[data-urn]");
  const row = h.w.document.createElement("div");
  row.setAttribute("componentkey", "replaceableComment_" + parent);
  row.innerHTML =
    '<a href="/company/example"><p>Example Company</p></a><button aria-label="View more options for Example Company’s comment."></button><div data-testid="expandable-text-box">Useful response <a href="/company/mentioned">Mention</a></div>';
  root.append(row);
  const result = await h.run("comments_list", {
    account_urn: account,
    post_urn: post,
    limit: 10,
  });
  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "replaceableComment_" + parent,
        author: expect.objectContaining({
          type: "company",
          profile_url: "https://www.linkedin.com/company/example",
        }),
      }),
    ]),
  );
});
it("rejects an expired actor reference without interacting with the picker", async () => {
  const h = await setup();
  const ref = await company(h);
  h.data["publishing-actors"][ref].expires = 0;
  await expect(
    h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).rejects.toMatchObject({ code: "actor_reference_unknown" });
  expect(h.sends()).toBe(0);
});
it("rejects a company no longer offered by the native picker", async () => {
  const h = await setup();
  const ref = await company(h);
  h.picker.trigger.addEventListener("click", () => {
    const radio = h.w.document.querySelector(
      'input[aria-label="Select Example Company"]',
    );
    radio.closest("[componentkey]").remove();
  });
  await expect(
    h.engine.run("post_comment", { ...args, actor_ref: ref }),
  ).rejects.toMatchObject({ code: "comment_actor_unavailable" });
  expect(h.sends()).toBe(0);
});

it("waits for delayed native picker contents without clicking the switch twice", async () => {
  const h = await setup();
  let opens = 0;
  let ticks = 0;
  let restore: (() => void) | undefined;
  h.w.setTimeout = (fn: () => void) =>
    setTimeout(() => {
      if (++ticks === 3) restore?.();
      fn();
    }, 1);
  h.picker.trigger.addEventListener("click", () => {
    opens++;
    const group = h.w.document.querySelector('[role="radiogroup"]');
    const rows = [...group.children];
    group.replaceChildren();
    restore = () => group.append(...rows);
  });
  const listing = await h.engine.run("comment_actors_list", {
    account_urn: account,
    post_urn: post,
  });
  expect(listing.items).toHaveLength(2);
  expect(listing.complete).toBe(true);
  expect(opens).toBe(1);
  expect(h.sends()).toBe(0);
  expect(h.w.document.querySelector("dialog")).toBeNull();
});

it("resolves the personal author across observed 100px and 200px avatar renditions", async () => {
  const avatar =
    "https://media.licdn.com/dms/image/v2/memberPhoto/profile-displayphoto-scale_100_100/rendition100/0/1758571373941";
  const h = await setup(false, [
    { ...fixtureActors[0], avatar },
    fixtureActors[1],
  ]);
  h.picker.links.querySelector("img")!.src = avatar.replace(
    "100_100/rendition100",
    "200_200/rendition200",
  );
  const listing = await h.engine.run("comment_actors_list", {
    account_urn: account,
    post_urn: post,
  });
  expect(listing.complete).toBe(true);
  expect(listing.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "person",
        profile_url: fixtureActors[0].profile_url,
      }),
    ]),
  );
  expect(h.sends()).toBe(0);
});

it("keeps distinct avatar assets and uploads separate when normalizing renditions", async () => {
  const { actorImage } = await import("../src/extension/comment-actors.js");
  const source =
    "https://media.licdn.com/dms/image/v2/memberPhoto/profile-displayphoto-scale_100_100/rendition100/0/1758571373941";
  expect(actorImage(source)).toBe(
    actorImage(source.replace("100_100/rendition100", "200_200/rendition200")),
  );
  expect(actorImage(source)).not.toBe(
    actorImage(source.replace("memberPhoto", "otherPhoto")),
  );
  expect(actorImage(source)).not.toBe(
    actorImage(source.replace("1758571373941", "1758571373942")),
  );
  expect(actorImage(source)).not.toBe(
    actorImage(
      source.replace("profile-displayphoto", "profile-displaybackgroundimage"),
    ),
  );
});
