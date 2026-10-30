import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { composerOperation } from "../src/extension/composer.js";
import { scheduleTime } from "../src/core/post-planning.js";
import { Engine } from "../src/core/engine.js";
import { Fault, parse } from "../src/core/contracts.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const account = "urn:li:fsd_profile:me";
const args = {
  account_urn: account,
  text: "Disposable QA draft",
  verified_actor: { name: "Tester" },
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function ui(initial = "", staleAfterSave = false) {
  let stale = false;
  const dom = new JSDOM('<button id="start">Start a post</button>', {
    url: "https://www.linkedin.com/feed/",
  });
  const w = dom.window;
  for (const [k, v] of Object.entries({
    window: w,
    document: w.document,
    location: w.location,
    HTMLInputElement: w.HTMLInputElement,
    InputEvent: w.InputEvent,
    Event: w.Event,
  }))
    vi.stubGlobal(k, v);
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", {
    get() {
      return this.parentElement;
    },
  });
  let saved = initial,
    published = 0,
    saves = 0;
  const doc = w.document;
  doc.execCommand = vi.fn((_command, _ui, value) => {
    const node = w.getSelection()?.getRangeAt(0).commonAncestorContainer;
    if (!node) return false;
    node.textContent = value ?? "";
    return true;
  });
  function open() {
    const d = doc.createElement("dialog");
    d.open = true;
    d.innerHTML =
      '<div aria-label="Tester"></div><div contenteditable="true" role="textbox"></div><button>Post</button><button aria-label="Dismiss">Close</button>';
    d.querySelector("[contenteditable]")!.textContent = stale ? "" : saved;
    stale = false;
    d.querySelector("button")!.addEventListener("click", () => published++);
    d.querySelector('[aria-label="Dismiss"]')!.addEventListener("click", () => {
      const value = d.querySelector("[contenteditable]")!.textContent!;
      if (!value) {
        d.remove();
        return;
      }
      const c = doc.createElement("dialog");
      c.open = true;
      c.innerHTML =
        "<h2>Save this post as a draft?</h2><button>Save as draft</button>";
      c.querySelector("button")!.addEventListener("click", () => {
        saved = value;
        saves++;
        if (staleAfterSave && saves === 1) stale = true;
        doc.querySelector("#start")!.innerHTML =
          '<div aria-label="Start a post">Draft: saved text</div>';
        const alert = doc.createElement("div");
        alert.setAttribute("role", "alert");
        alert.textContent = "Draft successfully saved.";
        doc.body.append(alert);
        c.remove();
        d.remove();
      });
      doc.body.append(c);
    });
    doc.body.append(d);
  }
  doc.querySelector("#start")!.addEventListener("click", open);
  return {
    doc,
    open,
    saved: () => saved,
    published: () => published,
    saves: () => saves,
  };
}
it("saves and reopens a native draft, never activating Post", async () => {
  const f = ui();
  const r = await composerOperation("post_draft_create", args, {});
  expect(r).toMatchObject({
    verified: true,
    outcome: "draft_saved",
    text_hash: hash(args.text),
  });
  expect(f.saved()).toBe(args.text);
  expect(f.published()).toBe(0);
  expect(f.saves()).toBe(2);
});
it("preserves an existing draft without any save or publish", async () => {
  const f = ui("My existing draft");
  expect(await composerOperation("post_draft_create", args, {})).toMatchObject({
    bridge_error: "existing_draft_conflict",
    dispatch_state: "not_dispatched",
  });
  expect(f.saved()).toBe("My existing draft");
  expect(f.saves()).toBe(0);
  expect(f.published()).toBe(0);
});
it("refuses a different composer actor and duplicate controls", async () => {
  const f = ui();
  expect(
    await composerOperation(
      "post_draft_create",
      { ...args, verified_actor: { name: "Other" } },
      {},
    ),
  ).toMatchObject({ bridge_error: "composer_actor_mismatch" });
  f.doc.querySelector("dialog")!.innerHTML +=
    '<button aria-label="Dismiss">Close</button>';
  expect(await composerOperation("post_draft_create", args, {})).toMatchObject({
    bridge_error: "composer_control_ambiguous",
    dispatch_state: "not_dispatched",
  });
  expect(f.saves()).toBe(0);
  expect(f.published()).toBe(0);
});
it("reconciles a draft by content without saving or publishing", async () => {
  const f = ui(args.text);
  expect(
    await composerOperation(
      "post_draft_create",
      { ...args, reconcile: true, text_hash: hash(args.text) },
      {},
    ),
  ).toMatchObject({ verified: true, outcome: "draft_saved" });
  expect(f.saves()).toBe(0);
  expect(f.published()).toBe(0);
});
it("rejects old direct posting and timezone-free schedule inputs", () => {
  expect(() => parse("post_create", args)).toThrow();
  expect(() =>
    parse("post_schedule", {
      account_urn: account,
      text: "Test",
      idempotency_key: "schedule-key",
      scheduled_at: "2026-11-06T12:00:00",
    }),
  ).toThrow();
});
it("validates future minute precision and preserves explicit DST offsets", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  expect(scheduleTime("2026-10-25T02:30:00+02:00", now)).toBe(
    "2026-10-25T00:30:00.000Z",
  );
  expect(scheduleTime("2026-10-25T02:30:00+01:00", now)).toBe(
    "2026-10-25T01:30:00.000Z",
  );
  for (const s of [
    "invalid",
    "2026-10-24T12:09:00Z",
    "2026-10-25T12:00:01Z",
    "2027-02-01T12:00:00Z",
  ])
    expect(() => scheduleTime(s, now)).toThrow("invalid_schedule_time");
});
function engineFixture() {
  const data: Record<string, any> = {};
  let dispatches = 0;
  let confirmed = false;
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
    account: async () => account,
    now: () => Date.parse("2026-10-30T12:00:00Z"),
    uuid: () => "origin",
    hash: async (s: string) => hash(s),
    fetch: async () => ({ data: { miniProfile: { entityUrn: account } } }),
    identity: async () => ({ name: "Tester" }),
    dom: async (_op: string, a: any) => {
      if (a.reconcile)
        return {
          verified: confirmed,
          outcome: "scheduled",
          scheduled_item: confirmed
            ? { text_hash: a.text_hash, scheduled_at: a.scheduled_at }
            : undefined,
        };
      dispatches++;
      throw new Fault("verification_lost", "failed", {
        dispatch_state: "dispatched",
      });
    },
  };
  return {
    dependencies,
    data,
    dispatches: () => dispatches,
    confirm: () => {
      confirmed = true;
    },
  };
}
it("never redispatches an uncertain schedule across restart and reconciles the same key", async () => {
  const f = engineFixture();
  const input = {
    account_urn: account,
    text: "QA",
    scheduled_at: "2026-11-06T12:00:00Z",
    idempotency_key: "qa-schedule-key",
  };
  expect(
    (await new Engine(f.dependencies).run("post_schedule", input)).status,
  ).toBe("unknown_outcome");
  expect(
    (await new Engine(f.dependencies).run("post_schedule", input)).status,
  ).toBe("unknown_outcome");
  f.confirm();
  const r = await new Engine(f.dependencies).run("post_schedule", input);
  expect(r).toMatchObject({
    status: "confirmed",
    outcome: "scheduled",
    replayed: true,
  });
  expect(r.scheduled_ref).toMatch(/^[a-f0-9]{64}$/);
  expect(f.dispatches()).toBe(1);
  await expect(
    new Engine(f.dependencies).run("post_schedule", {
      ...input,
      text: "Changed",
    }),
  ).rejects.toThrow("idempotency_conflict");
});
it("rejects invalid times and foreign scheduled references before dispatch", async () => {
  const f = engineFixture();
  const e = new Engine(f.dependencies);
  await expect(
    e.run("post_schedule", {
      account_urn: account,
      text: "QA",
      scheduled_at: "2026-10-30T12:05:00Z",
      idempotency_key: "invalid-time",
    }),
  ).rejects.toThrow("invalid_schedule_time");
  await expect(
    e.run("scheduled_post_cancel", {
      account_urn: account,
      scheduled_ref: "a".repeat(64),
      idempotency_key: "foreign-ref",
    }),
  ).rejects.toThrow("scheduled_reference_unknown");
  expect(f.dispatches()).toBe(0);
});
it("plans only after exact time confirmation and verifies the scheduled entry", async () => {
  const f = ui();
  f.open();
  const wanted = new Date(
    Math.ceil((Date.now() + 7 * 86400000) / 60000) * 60000,
  );
  const timeText = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(wanted);
  const stamp =
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(wanted) +
    ", " +
    timeText;
  let scheduled = 0;
  const configure = (d: Element) => {
    const a = f.doc.createElement("a");
    a.href = "#";
    a.textContent = "Scheduled";
    d.append(a);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const text = d.querySelector("[contenteditable]")!.textContent!;
      d.innerHTML =
        '<input placeholder="mm/dd/yyyy"><input type="text"><p></p><button>Confirm</button><a href="#">Scheduled (' +
        scheduled +
        ")</a>";
      d.querySelectorAll("input")[1].addEventListener("input", () => {
        d.querySelector("p")!.textContent = "Posting at " + stamp;
      });
      d.querySelector("a")!.addEventListener("click", (e) => {
        e.preventDefault();
        d.innerHTML =
          '<div data-sdui-screen="com.linkedin.sdui.flagshipnav.sharing.ShareSchedulePostList"><a>Scheduled (' +
          scheduled +
          ')</a><div id="ScheduledPostRowSlot_urn:li:share:123_gen6"><p>Posting ' +
          new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          }).format(wanted) +
          " at " +
          timeText +
          '</p><div role="listitem"><h2>Feed post</h2><p></p></div></div></div>';
        d.querySelector('[role="listitem"] p')!.textContent = args.text;
      });
      d.querySelector("button")!.addEventListener("click", () => {
        d.innerHTML =
          '<div aria-label="Tester"></div><div contenteditable="true"></div><p>Posting at ' +
          stamp +
          "</p><button>Schedule</button><button>Post</button>";
        d.querySelector("[contenteditable]")!.textContent = text;
        d.querySelector("button")!.addEventListener("click", () => {
          scheduled++;
          const alert = f.doc.createElement("div");
          alert.setAttribute("role", "alert");
          alert.textContent = "Post scheduled.";
          f.doc.body.append(alert);
          d.remove();
        });
        d.querySelectorAll("button")[1].addEventListener("click", () => {
          throw Error("Immediate publication attempted");
        });
      });
    });
  };
  configure(f.doc.querySelector("dialog")!);
  f.doc
    .querySelector("#start")!
    .addEventListener("click", () => configure(f.doc.querySelector("dialog")!));
  const result = await composerOperation(
    "post_schedule",
    { ...args, scheduled_at: wanted.toISOString() },
    {},
  );
  expect(result).toMatchObject({ verified: false, outcome: "scheduled" });
  expect(scheduled).toBe(1);
  expect(f.published()).toBe(0);
});
it("does not mistake an open unsaved composer for a persisted draft", async () => {
  const f = ui(args.text);
  f.open();
  expect(
    await composerOperation(
      "post_draft_create",
      { ...args, reconcile: true, text_hash: hash(args.text) },
      {},
    ),
  ).toMatchObject({
    bridge_error: "draft_reconciliation_requires_closed_composer",
  });
  expect(f.saves()).toBe(0);
});
it("cancels only an exact native row via its newly opened menu, never Post now", async () => {
  const f = ui();
  let deleted = 0,
    published = 0;
  const d = f.doc.createElement("dialog");
  d.open = true;
  const render = () => {
    d.innerHTML =
      '<button aria-label="Dismiss">Close</button><div data-sdui-screen="com.linkedin.sdui.flagshipnav.sharing.ShareSchedulePostList"><a>Scheduled (' +
      (deleted ? 0 : 1) +
      ")</a>" +
      (!deleted
        ? '<div id="ScheduledPostRowSlot_urn:li:share:123_gen6"><p>Posting Fri, Nov 6, 2026 at 3:57 AM</p><div role="button"><svg aria-label="More options"></svg></div><div role="listitem"><h2>Feed post</h2><p>QA</p></div></div>'
        : "") +
      "</div>";
    d.querySelector("button")!.addEventListener("click", () => d.remove());
    if (!deleted)
      d.querySelector('[role="button"]')!.addEventListener("click", () => {
        const menu = f.doc.createElement("div");
        menu.setAttribute("role", "menu");
        menu.innerHTML =
          '<div role="menuitem">Post now</div><div role="menuitem">Delete post</div>';
        f.doc.body.append(menu);
        menu.children[0].addEventListener("click", () => published++);
        menu.children[1].addEventListener("click", () => {
          menu.remove();
          const confirm = f.doc.createElement("dialog");
          confirm.open = true;
          confirm.innerHTML =
            "<h2>Delete this post?</h2><button>Delete Post</button>";
          f.doc.body.append(confirm);
          confirm.querySelector("button")!.addEventListener("click", () => {
            deleted++;
            confirm.remove();
            render();
          });
        });
      });
  };
  render();
  f.doc.body.append(d);
  // A fresh manager is reached via the normal composer/timing navigation.
  f.doc.querySelector("#start")!.addEventListener("click", () => {
    const composer = f.doc.querySelector("dialog")!;
    const link = f.doc.createElement("a");
    link.href = "#";
    link.textContent = "Scheduled";
    composer.append(link);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      composer.innerHTML =
        '<input placeholder="mm/dd/yyyy"><a href="#">Scheduled (0)</a>';
      composer.querySelector("a")!.addEventListener("click", (e) => {
        e.preventDefault();
        composer.remove();
        render();
        f.doc.body.append(d);
      });
    });
  });
  const target = {
    text_hash: hash("QA"),
    scheduled_at: new Date("Nov 6, 2026 3:57 AM").toISOString(),
    native_id: "urn:li:share:123",
  };
  const result = await composerOperation(
    "scheduled_post_cancel",
    { ...args, verified_target: target },
    {},
  );
  expect(result).toMatchObject({
    verified: false,
    outcome: "schedule_cancelled",
  });
  expect(deleted).toBe(1);
  expect(published).toBe(0);
});

it("reopens a stale empty SDUI editor without overwriting the persisted draft", async () => {
  const f = ui("", true);
  const result = await composerOperation("post_draft_create", args, {});
  expect(result).toMatchObject({ verified: true, outcome: "draft_saved" });
  expect(f.saved()).toBe(args.text);
  expect(f.saves()).toBe(2);
  expect(f.published()).toBe(0);
});
it("requires fresh native schedule evidence after dispatch instead of trusting cached UI success", async () => {
  const f = engineFixture();
  const item = {
    text_hash: hash("QA"),
    scheduled_at: "2026-11-06T12:00:00.000Z",
    native_id: "urn:li:share:123",
  };
  let exists = false;
  const calls: string[] = [];
  const deps = {
    ...f.dependencies,
    dom: async (op: string) => {
      calls.push(op);
      if (op === "post_schedule") {
        exists = true;
        return { verified: false, outcome: "scheduled" };
      }
      if (op === "scheduled_post_cancel") {
        exists = false;
        return { verified: false, outcome: "schedule_cancelled" };
      }
      return { complete: true, items: exists ? [item] : [] };
    },
  };
  const e = new Engine(deps);
  const scheduled = await e.run("post_schedule", {
    account_urn: account,
    text: "QA",
    scheduled_at: item.scheduled_at,
    idempotency_key: "fresh-schedule",
  });
  expect(scheduled).toMatchObject({
    status: "confirmed",
    outcome: "scheduled",
  });
  expect(calls).toEqual(["post_schedule", "scheduled_posts_list"]);
  const cancelled = await e.run("scheduled_post_cancel", {
    account_urn: account,
    scheduled_ref: scheduled.scheduled_ref,
    idempotency_key: "fresh-cancel",
  });
  expect(cancelled).toMatchObject({
    status: "confirmed",
    outcome: "schedule_cancelled",
  });
  expect(calls.slice(-2)).toEqual([
    "scheduled_post_cancel",
    "scheduled_posts_list",
  ]);
});
