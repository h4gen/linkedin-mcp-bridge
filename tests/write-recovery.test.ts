import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { domOperation } from "../src/extension/dom.js";
import { Engine } from "../src/core/engine.js";
import { Fault, parse } from "../src/core/contracts.js";
function page(
  html: string,
  url = "https://www.linkedin.com/mynetwork/invitation-manager/received/",
) {
  const dom = new JSDOM(html, { url });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
  }))
    vi.stubGlobal(key, value);
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.style.display === "none" ? null : this.parentElement;
    },
  });
  return dom.window.document;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const invitation = {
  entityUrn: "urn:li:fs_relInvitation:123",
  profile: {
    entityUrn: "urn:li:fsd_profile:friend",
    profile_url: "https://www.linkedin.com/in/friend/",
    name: "Friend",
  },
};
const args = {
  invitation_urn: invitation.entityUrn,
  verified_target: invitation,
  action: "accept",
};
it.each([
  ["button", "Accept Friend’s invitation", "Accept", "accept"],
  ["button", "Ignore an invitation to connect from Friend", "Ignore", "ignore"],
  ["a", "Withdraw invitation sent to Friend", "Withdraw", "withdraw"],
])(
  "executes scoped %s with extended label %s",
  async (tag, label, text, action) => {
    vi.useFakeTimers();
    const doc = page(
      `<main><div><a href="/in/other/">Other</a><button>Accept</button></div><div><a href="/in/friend/">Friend</a><div><${tag} ${tag === "a" ? 'href="/mynetwork/invitation-manager/sent/"' : ""} aria-label="${label}">${text}</${tag}></div></div></main>`,
    );
    let hits = 0;
    doc
      .querySelector(`[aria-label="${label}"]`)!
      .addEventListener("click", (e) => {
        e.preventDefault();
        hits++;
      });
    const op =
      action === "withdraw" ? "invitation_withdraw" : "invitation_respond";
    const pre = await domOperation(
      op,
      { ...args, action, preflight: true },
      {},
    );
    expect(pre).toMatchObject({
      preflight: true,
      legacy_no_dispatch_proof: true,
    });
    expect(hits).toBe(0);
    const result = domOperation(op, { ...args, action }, {});
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ dispatch_state: "dispatched" });
    expect(hits).toBe(1);
  },
);
it("fails before dispatch for duplicate controls and ignores disabled controls", async () => {
  const doc = page(
    '<div><a href="/in/friend/">Friend</a><button>Accept</button><button>Accept</button></div>',
  );
  let hits = 0;
  doc.addEventListener("click", () => hits++);
  expect(await domOperation("invitation_respond", args, {})).toMatchObject({
    bridge_error: "ui_control_ambiguous_or_missing",
    dispatch_state: "not_dispatched",
  });
  doc.querySelectorAll("button")[1].setAttribute("aria-disabled", "true");
  expect(
    await domOperation("invitation_respond", { ...args, preflight: true }, {}),
  ).toMatchObject({ preflight: true });
  expect(hits).toBe(0);
});
it("never selects a different invitation or hidden target", async () => {
  vi.useFakeTimers();
  page(
    '<div><a href="/in/other/">Other</a><button>Accept</button></div><div><a style="display:none" href="/in/friend/">Friend</a><button>Accept</button></div>',
  );
  const r = domOperation("invitation_respond", args, {});
  await vi.runAllTimersAsync();
  expect(await r).toMatchObject({
    bridge_error: "invitation_target_not_unique",
    dispatch_state: "not_dispatched",
  });
});
it("waits for the exact thread and uses its owned menu and newly opened dialog", async () => {
  vi.useFakeTimers();
  const doc = page(
    '<div><button>Open the options list in your conversation with Other</button></div><div role="dialog"><button>Delete</button></div>',
    "https://www.linkedin.com/messaging/thread/thread123/",
  );
  let deleted = 0,
    foreign = 0;
  doc
    .querySelector("[role=dialog] button")!
    .addEventListener("click", () => foreign++);
  setTimeout(() => {
    const pane = doc.createElement("section");
    pane.className = "msg-thread";
    pane.innerHTML =
      '<div id="thread-detail-jump-target"><div class="artdeco-dropdown"><button id="trigger" aria-controls="owned" aria-label="Open the options list in your conversation with Friend">...</button><div role="menu" id="owned" style="display:none"><div role="menuitem">Delete conversation</div></div></div></div>';
    doc.body.append(pane);
    doc.querySelector("#trigger")!.addEventListener("click", () => {
      (doc.querySelector("#owned") as HTMLElement).style.display = "block";
    });
    doc.querySelector("[role=menuitem]")!.addEventListener("click", () => {
      const d = doc.createElement("div");
      d.setAttribute("role", "dialog");
      d.innerHTML = "<button>Delete</button>";
      d.querySelector("button")!.addEventListener("click", () => deleted++);
      doc.body.append(d);
    });
  }, 500);
  const r = domOperation(
    "conversation_delete",
    {
      conversation_urn:
        "urn:li:msg_conversation:(urn:li:fsd_profile:me,thread123)",
    },
    {},
  );
  await vi.runAllTimersAsync();
  expect(await r).toMatchObject({ dispatch_state: "dispatched" });
  expect(deleted).toBe(1);
  expect(foreign).toBe(0);
});
it("reports a post-click failure as dispatched and cancels changed sessions before clicking", async () => {
  const doc = page(
    '<div><a href="/in/friend/">Friend</a><button>Accept</button></div>',
  );
  (doc.querySelector("button") as HTMLElement).click = () => {
    throw Error("post_click_failure");
  };
  expect(await domOperation("invitation_respond", args, {})).toMatchObject({
    bridge_error: "post_click_failure",
    dispatch_state: "dispatched",
  });
  expect(
    await domOperation(
      "invitation_respond",
      { ...args, execution_session: "old" },
      {},
    ),
  ).toMatchObject({
    bridge_error: "cancelled",
    dispatch_state: "not_dispatched",
  });
});
function engineFixture() {
  const data: Record<string, any> = {};
  let present = true;
  let failure: string | undefined;
  let legacyProof = true;
  let mutations = 0;
  const input = {
    account_urn: "urn:li:fsd_profile:me",
    invitation_urn: invitation.entityUrn,
    action: "accept",
    idempotency_key: "same-key-recovery",
  };
  const dependencies = {
    store: {
      get: async (k: string) => structuredClone(data[k]),
      set: async (k: string, v: any) => {
        data[k] = structuredClone(v);
      },
      remove: async (k: string) => {
        delete data[k];
      },
    },
    account: async () => input.account_urn,
    now: () => 1000,
    uuid: () => "origin",
    hash: async (s: string) => s,
    fetch: async (r: any) =>
      r.path === "/me"
        ? { data: { miniProfile: { entityUrn: input.account_urn } } }
        : {
            data: {
              elements: present
                ? [
                    {
                      invitation: {
                        entityUrn: invitation.entityUrn,
                        fromMember: {
                          dashEntityUrn: invitation.profile.entityUrn,
                          firstName: "Friend",
                          publicIdentifier: "friend",
                        },
                      },
                    },
                  ]
                : [],
              paging: { total: present ? 1 : 0 },
            },
          },
    dom: async (_op: string, a: any) => {
      if (a.preflight)
        return {
          preflight: true,
          dispatch_state: "not_dispatched",
          legacy_no_dispatch_proof: legacyProof,
        };
      if (failure)
        throw new Fault("ui_control_ambiguous_or_missing", "failed", {
          dispatch_state: failure,
        });
      mutations++;
      present = false;
      return { verified: true, dispatch_state: "dispatched" };
    },
  };
  const engine = new Engine(dependencies);
  const seed = () => {
    data.journal = {
      [input.account_urn + ":" + input.idempotency_key]: {
        operation: "invitation_respond",
        fingerprint: JSON.stringify([
          "invitation_respond",
          { ...parse("invitation_respond", input), idempotency_key: undefined },
        ]),
        created_at: 1000,
        status: "unknown_outcome",
        error: "ui_control_ambiguous_or_missing",
        target: input.invitation_urn,
        origin_token: "old-origin",
      },
    };
  };
  return {
    engine,
    input,
    data,
    seed,
    dependencies,
    fail: (s?: string) => {
      failure = s;
    },
    proof: (v: boolean) => {
      legacyProof = v;
    },
    mutations: () => mutations,
  };
}
it("recovers a proven legacy pre-click failure using the original key exactly once", async () => {
  const f = engineFixture();
  f.seed();
  const r = await f.engine.run("invitation_respond", f.input);
  expect(r.status).toBe("confirmed");
  expect(r.attempt_count).toBe(2);
  expect(r.origin_token).toBe("old-origin");
  expect(r.previous_attempts[0].recovery).toContain("legacy");
  expect(
    (await new Engine(f.dependencies).run("invitation_respond", f.input))
      .replayed,
  ).toBe(true);
  expect(f.mutations()).toBe(1);
});
it("does not retry legacy failures without proof or with a changed payload", async () => {
  const f = engineFixture();
  f.seed();
  f.proof(false);
  expect((await f.engine.run("invitation_respond", f.input)).status).toBe(
    "unknown_outcome",
  );
  expect(f.mutations()).toBe(0);
  await expect(
    f.engine.run("invitation_respond", { ...f.input, action: "ignore" }),
  ).rejects.toThrow("idempotency_conflict");
});
it("retries failed-before-dispatch with the same key, serializing concurrent calls", async () => {
  const f = engineFixture();
  f.fail("not_dispatched");
  expect((await f.engine.run("invitation_respond", f.input)).status).toBe(
    "failed_before_dispatch",
  );
  f.fail();
  const results = await Promise.all([
    f.engine.run("invitation_respond", f.input),
    f.engine.run("invitation_respond", f.input),
  ]);
  expect(results.map((x) => x.status)).toEqual(["confirmed", "confirmed"]);
  expect(results[1].replayed).toBe(true);
  expect(f.mutations()).toBe(1);
});
it.each(["dispatched", "unknown"])(
  "never retries acknowledged %s or lost transport outcomes",
  async (state) => {
    const f = engineFixture();
    f.fail(state);
    expect((await f.engine.run("invitation_respond", f.input)).status).toBe(
      "unknown_outcome",
    );
    f.fail();
    expect((await f.engine.run("invitation_respond", f.input)).replayed).toBe(
      true,
    );
    expect(f.mutations()).toBe(0);
  },
);
