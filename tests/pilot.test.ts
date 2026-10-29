import { describe, it, expect, vi } from "vitest";
import { Approvals, ACCEPTED_WRITES } from "../src/core/approvals.js";
import { Engine, Store } from "../src/core/engine.js";
import { readApi } from "../src/core/api.js";
import { parse } from "../src/core/contracts.js";
function storage() {
  const data: Record<string, any> = {};
  const store: Store = {
    get: async (k) => structuredClone(data[k]),
    set: async (k, v) => {
      data[k] = structuredClone(v);
    },
    remove: async (k) => {
      delete data[k];
    },
  };
  return { data, store };
}
const account = "urn:li:fsd_profile:me";
const send = {
  account_urn: account,
  recipient_urn: "urn:li:fsd_profile:friend",
  expected_participant_urns: ["urn:li:fsd_profile:friend"],
  text: "Grüße 👋",
  idempotency_key: "approval-test",
};
describe("extension-owned approvals", () => {
  it("does not send before approval; binds content; rejects external decisions", async () => {
    const { store } = storage();
    const approvals = new Approvals(
      store,
      () => 1,
      () => "review-id",
    );
    const fetch = vi.fn(async (r: any) =>
      r.path === "/me"
        ? { data: { miniProfile: { entityUrn: account } } }
        : { data: { entityUrn: "urn:li:msg_message:1" } },
    );
    const engine = new Engine({
      store,
      fetch,
      dom: vi.fn(),
      account: async () => account,
      now: () => 1,
      uuid: () => "00112233-4455-4677-8899-aabbccddeeff",
      hash: async (s) => s,
      authorize: (...args) => approvals.request(...args),
      allowedWrites: ACCEPTED_WRITES,
    });
    const pending = await engine.run("message_send", send);
    expect(pending.status).toBe("approval_required");
    expect(fetch.mock.calls.some(([r]) => r.method)).toBe(false);
    await expect(
      engine.run("message_send", { ...send, text: "changed" }),
    ).rejects.toThrow("idempotency_conflict");
    expect(() => parse("approval_decide", {})).toThrow();
    await expect(
      approvals.decide(account + ":" + send.idempotency_key, "wrong", true),
    ).rejects.toThrow();
    await approvals.decide(
      account + ":" + send.idempotency_key,
      pending.operation_id,
      true,
    );
    expect((await engine.run("message_send", send)).status).toBe("confirmed");
    expect((await engine.run("message_send", send)).replayed).toBe(true);
    expect(fetch.mock.calls.filter(([r]) => r.method)).toHaveLength(1);
  });
  it("expires drafts and deletes rejected content", async () => {
    const { store, data } = storage();
    let now = 1;
    const approvals = new Approvals(
      store,
      () => now,
      () => "id",
    );
    await approvals.request("message_send", send, "hash", "key");
    await approvals.decide("key", "id", false);
    expect(data["approval:key"].args).toBeUndefined();
    await expect(
      approvals.request("message_send", send, "hash", "key"),
    ).rejects.toThrow("approval_rejected");
    now += 1800001;
    await expect(
      approvals.request("message_send", send, "hash", "key"),
    ).rejects.toThrow("approval_expired");
  });
});
describe("GTM and inbox pages", () => {
  it("passes only typed filters and rejects arbitrary facets", async () => {
    const a = parse("people_search", {
      account_urn: account,
      query: "founder",
      filters: {
        connection_degrees: ["2"],
        company_ids: ["123"],
        location_ids: ["456"],
      },
    });
    const fetch = vi.fn(async (_r: any) => ({ data: { elements: [] } }));
    await readApi("people_search", a, {}, fetch);
    expect(fetch.mock.calls[0][0].path).toContain("key:network,value:List(S)");
    expect(fetch.mock.calls[0][0].path).toContain("key:geoUrn,value:List(456)");
    expect(() =>
      parse("people_search", { ...a, filters: { url: "evil" } }),
    ).toThrow();
  });
  it("searches successive pages without silently discarding overflow results", async () => {
    let count = 0;
    const fetch = vi.fn(async () => ({
      data: {
        elements: Array.from({ length: 3 }, (_, i) => ({
          entityUrn: `urn:${count}:${i}`,
          name: "needle",
        })),
        metadata: ++count < 2 ? { nextCursor: "next" } : {},
      },
    }));
    const a = {
      account_urn: account,
      category: "INBOX",
      query: "needle",
      limit: 2,
      scan_pages: 3,
    };
    const first = await readApi("conversations_search", a, {}, fetch);
    const second = await readApi("conversations_search", a, first.next, fetch);
    const third = await readApi("conversations_search", a, second.next, fetch);
    expect([...first.items, ...second.items, ...third.items]).toHaveLength(6);
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(
          (x) => x.entityUrn,
        ),
      ).size,
    ).toBe(6);
    expect(third.next).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("buffers a short history page and never refetches exhausted history", async () => {
    const fetch = vi.fn(async () => ({
      data: {
        elements: [
          { entityUrn: "urn:a", deliveredAt: 2 },
          { entityUrn: "urn:b", deliveredAt: 1 },
        ],
      },
    }));
    const a = { limit: 1, conversation_urn: "urn:li:msg_conversation:x" };
    const first = await readApi("messages_list", a, {}, fetch);
    const second = await readApi("messages_list", a, first.next, fetch);
    expect(first.items[0].entityUrn).toBe("urn:a");
    expect(second.items[0].entityUrn).toBe("urn:b");
    expect(second.next).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("flattens people search clusters before computing pagination", async () => {
  const row = {
    entityUrn:
      "urn:li:fsd_entityResultViewModel:(urn:li:fsd_profile:one,SEARCH_SRP,DEFAULT)",
    navigationUrl: "https://www.linkedin.com/in/person?tracking=x",
    title: { text: "Person" },
    badgeText: { text: "• 1st" },
  };
  const result = await readApi(
    "people_search",
    { query: "founder", limit: 1 },
    {},
    async () => ({
      data: { elements: [{ items: [{ item: { entityResult: row } }] }] },
    }),
  );
  expect(result.items[0]).toMatchObject({
    entityUrn: "urn:li:fsd_profile:one",
    name: "Person",
    profile_url: "https://www.linkedin.com/in/person",
  });
  expect(result.next.start).toBe(1);
});

it("keeps already collected extraction results when cancelled", async () => {
  const { Extractions } = await import("../src/core/extractions.js");
  const { store } = storage();
  let resume: () => void = () => {};
  const blocked = new Promise<void>((r) => (resume = r));
  let calls = 0;
  const jobs = new Extractions(
    store,
    async () => {
      calls++;
      if (calls === 2) await blocked;
      return {
        items: [{ id: String(calls) }],
        next_cursor: "next",
        partial: true,
      };
    },
    async () => account,
    () => "11111111-1111-4111-8111-111111111111",
  );
  const job = await jobs.handle("extraction_start", {
    account_urn: account,
    kind: "comments",
    post_urn: "urn:li:activity:1",
    max_items: 100,
  });
  await vi.waitFor(() => expect(calls).toBe(2));
  await jobs.handle("extraction_cancel", {
    account_urn: account,
    operation_id: job.operation_id,
  });
  resume();
  const result = await jobs.handle("extraction_get", {
    account_urn: account,
    operation_id: job.operation_id,
  });
  expect(result.status).toBe("cancelled");
  expect(result.items).toEqual([{ id: "1" }]);
});

it("verifies recipients from an exact conversation entity without scanning the inbox", async () => {
  const { store } = storage();
  const thread = "urn:li:msg_conversation:archived";
  const fetch = vi.fn(async (r: any) =>
    r.path === "/me"
      ? { data: { miniProfile: { entityUrn: account } } }
      : r.method
        ? { data: { entityUrn: "urn:li:msg_message:sent" } }
        : {
            data: { elements: [] },
            included: [
              {
                entityUrn: thread,
                conversationParticipants: [
                  { hostIdentityUrn: send.recipient_urn },
                  { hostIdentityUrn: account },
                ],
              },
            ],
          },
  );
  const engine = new Engine({
    store,
    fetch,
    dom: vi.fn(),
    account: async () => account,
    now: () => 1000,
    uuid: () => "00112233-4455-4677-8899-aabbccddeeff",
    hash: async (s) => s,
  });
  const result = await engine.run("message_send", {
    ...send,
    recipient_urn: undefined,
    conversation_urn: thread,
  });
  expect(result.status).toBe("confirmed");
  expect(
    fetch.mock.calls.some(([r]) => r.path.includes("messengerConversations.")),
  ).toBe(false);
});

it("resolves typed company/location IDs from the public lookup and rejects shape drift", async () => {
  const fetch = vi.fn(async (_r: any) => [
    { id: "123", displayName: "Berlin, Germany", type: "GEO" },
  ]);
  const result = await readApi(
    "people_search_filters",
    { kind: "location", query: "Berlin" },
    {},
    fetch,
  );
  expect(result.options).toEqual([
    { id: "123", label: "Berlin, Germany", kind: "location" },
  ]);
  expect(fetch.mock.calls[0][0]).toMatchObject({ surface: "guest_typeahead" });
  await expect(
    readApi(
      "people_search_filters",
      { kind: "company", query: "Acme" },
      {},
      async () => ({ unexpected: [] }),
    ),
  ).rejects.toThrow("filter_lookup_shape_changed");
});

it("replays cursor pages without traversing the DOM again and separates continuation from coverage", async () => {
  const { store } = storage();
  let clock = 1000;
  let id = 0;
  const dom = vi.fn(async () => ({
    items: [{ id: String(id) }],
    partial: true,
    reason: "linkedin_may_rank_or_hide_comments",
    next: { seen: [String(id)] },
  }));
  const engine = new Engine({
    store,
    dom,
    fetch: async () => ({ data: { miniProfile: { entityUrn: account } } }),
    account: async () => account,
    now: () => clock,
    uuid: () => `cursor-${++id}`,
    hash: async (s) => s,
  });
  const args = { account_urn: account, post_urn: "urn:li:share:123", limit: 3 };
  const first = await engine.run("comments_list", args);
  const nextArgs = { ...args, cursor: first.next_cursor };
  const second = await engine.run("comments_list", nextArgs);
  expect(await engine.run("comments_list", nextArgs)).toEqual(second);
  expect(dom).toHaveBeenCalledTimes(2);
  expect(second.page_info).toMatchObject({
    coverage: "partial",
    continuation: "available",
    returned_count: 1,
  });
  await expect(
    engine.run("comments_list", { ...nextArgs, post_urn: "urn:li:share:456" }),
  ).rejects.toThrow("invalid_cursor");
  clock += 1800001;
  await expect(engine.run("comments_list", nextArgs)).rejects.toThrow(
    "invalid_cursor",
  );
});

it("does not equate a missing cursor with complete comment coverage", async () => {
  const { store } = storage();
  const engine = new Engine({
    store,
    dom: async () => ({
      items: [],
      partial: true,
      reason: "bounded_visible_results",
    }),
    fetch: async () => ({ data: { miniProfile: { entityUrn: account } } }),
    account: async () => account,
    now: () => 1000,
    uuid: () => "cursor",
    hash: async (s) => s,
  });
  const result = await engine.run("comments_list", {
    account_urn: account,
    post_urn: "urn:li:share:123",
    limit: 3,
  });
  expect(result.next_cursor).toBeNull();
  expect(result.page_info).toMatchObject({
    coverage: "partial",
    continuation: "unavailable",
    cursor_expires_at: null,
  });
});
