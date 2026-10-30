import { it, expect, vi } from "vitest";
import { readApi, receipt } from "../src/core/api.js";
import { collection } from "../src/core/normalize.js";
import { cursorEvictions } from "../src/core/cursor-budget.js";
import { errorDetails, retryAt } from "../src/core/errors.js";
import { capabilities } from "../src/core/capabilities.js";
import { schemas } from "../src/core/contracts.js";

it("continues a short extracted people page when source paging reports more", async () => {
  const r = await readApi(
    "people_search",
    { query: "founder", limit: 3 },
    {},
    async () => ({
      data: {
        elements: [
          {
            items: [
              {
                entityResult: {
                  navigationUrl: "https://www.linkedin.com/in/one/",
                  title: { text: "One" },
                },
              },
            ],
          },
        ],
        paging: { start: 0, count: 3, total: 100 },
      },
    }),
  );
  expect(r.next.start).toBe(3);
  expect(r.partial).toBe(true);
});
it("does not match conversation identifiers outside the declared search fields", async () => {
  const r = await readApi(
    "conversations_search",
    { query: "hidden-id", limit: 3, scan_pages: 1 },
    {},
    async () => ({
      data: {
        elements: [
          {
            entityUrn: "urn:li:msg_conversation:hidden-id",
            title: "Unrelated",
            preview: "Nothing matching",
          },
        ],
      },
    }),
  );
  expect(r.items).toEqual([]);
});
it("matches participant names and preview but ignores metadata", async () => {
  const base = { query: "Ada", limit: 3, scan_pages: 1 };
  const r = await readApi("conversations_search", base, {}, async () => ({
    data: {
      elements: [
        {
          entityUrn: "1",
          participants: [
            { member: { firstName: "Ada", lastName: "Lovelace" } },
          ],
        },
        { entityUrn: "2", metadata: { secret: "Ada" } },
        { entityUrn: "3", preview: "Hello Ada" },
      ],
    },
  }));
  expect(r.items.map((x: any) => x.entityUrn)).toEqual(["1", "3"]);
});
it("drains history overflow before making another backend request", async () => {
  const fetch = vi.fn(async () => ({
    data: {
      elements: Array.from({ length: 50 }, (_, i) => ({
        entityUrn: `urn:${i}`,
        deliveredAt: 100 - i,
      })),
    },
  }));
  const a = { limit: 2, conversation_urn: "urn:li:msg_conversation:1" };
  let r = await readApi("messages_list", a, {}, fetch);
  for (let i = 0; i < 24; i++)
    r = await readApi("messages_list", a, r.next, fetch);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(r.next).toBeDefined();
});
it("rejects an unrelated collection instead of silently using its elements", () => {
  expect(() =>
    collection({ data: { unrelated: { elements: [] } } }, "people_search"),
  ).toThrow("no recognized collection");
});
it("rejects ambiguous recognized collections", () => {
  expect(() =>
    collection(
      {
        data: {
          messengerConversations: { elements: [] },
          messengerConversationsBySyncToken: { elements: [] },
        },
      },
      "conversations_list",
    ),
  ).toThrow("ambiguous_collection");
});
it("accepts only operation-specific receipt kinds", () => {
  const raw = { data: { entityUrn: "urn:li:activity:123" } };
  expect(receipt(raw, "message_send")).toBeUndefined();
  expect(receipt(raw, "post_schedule")).toBeUndefined();
});
it("evicts old cursor pages within a shared byte budget, not receipts", () => {
  const all = {
    "cursor:a": { expires: 1, data: "a".repeat(100) },
    "cursor:b": { expires: 2, data: "b".repeat(100) },
    journal: { important: true },
  };
  expect(
    cursorEvictions(all, "cursor:c", { data: "c".repeat(100) }, 300),
  ).toEqual(["cursor:a"]);
  expect(() =>
    cursorEvictions({}, "cursor:c", { data: "a".repeat(1000) }, 100),
  ).toThrow("cursor_page_too_large");
});
it("classifies read timeout separately from ambiguous writes and parses HTTP-date cooldowns", () => {
  expect(errorDetails("timeout").recovery).toBe("retry_read");
  expect(errorDetails("timeout_unknown_outcome")).toMatchObject({
    recovery: "inspect_receipt",
    retry_safe: false,
  });
  const now = Date.parse("2026-10-29T00:00:00Z");
  expect(retryAt("Thu, 29 Oct 2026 01:00:00 GMT", now)).toBe(now + 3600000);
});
it("every tool has a single registered output contract and jobs are absent", () => {
  expect(Object.keys(capabilities).sort()).toEqual(Object.keys(schemas).sort());
  expect(Object.keys(schemas).some((k) => k.startsWith("extraction_"))).toBe(
    false,
  );
  for (const c of Object.values(capabilities)) expect(c.output).toBeDefined();
  for (const c of Object.values(capabilities)) expect(c.enabled).toBe(true);
});

it("strips invitation shared secrets and returns only the typed invitation view", async () => {
  const r = await readApi(
    "invitations_list",
    { direction: "received", limit: 1 },
    {},
    async () => ({
      data: {
        elements: [
          {
            invitation: {
              entityUrn: "urn:li:fs_invitation:123",
              sharedSecret: "must-not-leave-browser",
              fromMember: {
                dashEntityUrn: "urn:li:fsd_profile:person",
                firstName: "Ada",
                lastName: "L",
                publicIdentifier: "ada",
              },
            },
          },
        ],
        paging: { total: 1 },
      },
    }),
  );
  expect(JSON.stringify(r)).not.toContain("sharedSecret");
  expect(JSON.stringify(r)).not.toContain("must-not-leave-browser");
  expect(r.items[0]).toMatchObject({
    entityUrn: "urn:li:fs_invitation:123",
    profile: { name: "Ada L", profile_url: "https://www.linkedin.com/in/ada/" },
  });
});

it("does not truncate normalized arrays silently", async () => {
  const { normalize } = await import("../src/core/normalize.js");
  const input = Array.from({ length: 120 }, (_, i) => ({ id: i }));
  expect(normalize({ data: { elements: input } }).data.elements).toHaveLength(
    120,
  );
});

it("resolves a sent receipt on an older message page", async () => {
  const { reconcileMessage } = await import("../src/core/api.js");
  let calls = 0;
  const fetch = vi.fn(async () =>
    ++calls === 1
      ? {
          data: {
            elements: Array.from({ length: 50 }, (_, i) => ({
              entityUrn: `urn:li:msg_message:${i}`,
              deliveredAt: 1000 - i,
            })),
          },
        }
      : {
          data: { elements: [] },
          included: [
            { entityUrn: "urn:li:msg_message:found", originToken: "token" },
          ],
        },
  );
  const r = await reconcileMessage(
    {
      target: "urn:li:msg_conversation:1",
      origin_token: "token",
      created_at: 900,
    },
    fetch,
    () => {},
  );
  expect(r).toEqual({
    receipt_id: "urn:li:msg_message:found",
    conversation_urn: "urn:li:msg_conversation:1",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("requires fresh state fields rather than trusting a partial conversation entity", async () => {
  const { getConversation } = await import("../src/core/api.js");
  const fetch = vi.fn(async (r: any) =>
    r.path.includes("messengerMessages.")
      ? {
          data: { elements: [] },
          included: [
            { entityUrn: "urn:li:msg_conversation:1", participants: [] },
          ],
        }
      : {
          data: {
            elements: [{ entityUrn: "urn:li:msg_conversation:1", read: true }],
          },
        },
  );
  const r = await getConversation(
    {
      account_urn: "urn:li:fsd_profile:me",
      conversation_urn: "urn:li:msg_conversation:1",
    },
    fetch,
    () => {},
    { fields: ["read"] },
  );
  expect(r.read).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
