import { it, expect } from "vitest";
import {
  conversationView,
  messageView,
  newestFirst,
  textWindow,
  exactPeer,
  personRef,
} from "../src/core/read-models.js";
import { readApi } from "../src/core/api.js";
import { parse, schemas } from "../src/core/contracts.js";
it("projects twenty bloated conversations below 32 KiB without raw profile images", () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({
    entityUrn: `urn:li:msg_conversation:${i}`,
    preview: "x".repeat(5000),
    participants: [
      {
        member: {
          entityUrn: "urn:li:fsd_profile:peer",
          firstName: "Test",
          lastName: "Person",
          profilePicture: { raw: "x".repeat(10000) },
        },
      },
    ],
    internalType: "secret-source",
  }));
  const projected = raw.map((r) => conversationView(r, "INBOX"));
  expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(32768);
  expect(JSON.stringify(projected)).not.toContain("profilePicture");
  expect(projected.every((r) => r.preview.text_truncated)).toBe(true);
});
it("projects Unicode text without splitting surrogate pairs", () => {
  const result = messageView({
    entityUrn: "m",
    body: { text: "🙂".repeat(1001) },
  });
  expect(Array.from(result.text)).toHaveLength(1000);
  expect(result.text_truncated).toBe(true);
});
it("sorts mixed source orders identically with deterministic ties", () => {
  const rows = [
    { entityUrn: "b", deliveredAt: 2 },
    { entityUrn: "c", deliveredAt: 1 },
    { entityUrn: "a", deliveredAt: 2 },
  ];
  expect(newestFirst(rows).map((r) => r.entityUrn)).toEqual(["a", "b", "c"]);
  expect(newestFirst([...rows].reverse())).toEqual(newestFirst(rows));
});
it("binds text windows to a revision and rejects changed text", async () => {
  const hash = async (s: string) => s;
  const first = await textWindow("🙂abc", { max_chars: 2 }, hash);
  expect(first.text).toBe("🙂a");
  expect(first.next_text_offset).toBe(2);
  expect(
    (
      await textWindow(
        "🙂abc",
        { text_offset: 2, text_revision: first.text_revision },
        hash,
      )
    ).text,
  ).toBe("bc");
  await expect(
    textWindow("other", { text_revision: first.text_revision }, hash),
  ).rejects.toMatchObject({ code: "text_revision_changed" });
});
it("matches exact peers, never same names or groups", () => {
  const row = (ids: string[]) => ({
    participants: ids.map((entityUrn) => ({
      member: { entityUrn, firstName: "Same" },
    })),
  });
  const own = "urn:li:fsd_profile:me",
    peer = "urn:li:fsd_profile:peer";
  expect(exactPeer(row([own, peer]), own, peer)).toBe(true);
  expect(exactPeer(row([own, "urn:li:fsd_profile:other"]), own, peer)).toBe(
    false,
  );
  expect(
    exactPeer(row([own, peer, "urn:li:fsd_profile:other"]), own, peer),
  ).toBe(false);
});
it("keeps exact conversation lookup bounded and resumable", async () => {
  let count = 0;
  const page = await readApi(
    "conversations_find",
    {
      account_urn: "urn:li:fsd_profile:me",
      profile_urn: "urn:li:fsd_profile:peer",
      categories: ["INBOX", "ARCHIVE"],
      limit: 20,
    },
    {},
    async () => {
      count++;
      return {
        data: { elements: [], metadata: { nextCursor: "page" + count } },
      };
    },
  );
  expect(count).toBe(3);
  expect(page.partial).toBe(true);
  expect(page.next).toBeTruthy();
  expect(page.items).toEqual([]);
});
it("requires exactly one profile or post reference", () => {
  const account_urn = "urn:li:fsd_profile:me";
  expect(() => parse("profile_get", { account_urn })).toThrow(
    "choose_profile_identity",
  );
  expect(() =>
    parse("post_resolve", {
      account_urn,
      scan_key: "a",
      url: "https://www.linkedin.com/posts/a",
    }),
  ).toThrow("choose_post_reference");
});
it("exposes the explicit expected 32 primitive contracts", () => {
  expect(Object.keys(schemas).sort()).toEqual(
    [
      "health",
      "conversations_list",
      "conversations_search",
      "conversations_find",
      "conversations_get",
      "messages_list",
      "message_get",
      "message_send",
      "conversation_update",
      "conversation_delete",
      "profile_get",
      "people_search",
      "people_search_filters",
      "profile_posts_list",
      "relationship_get",
      "invitations_list",
      "invitation_send",
      "invitation_respond",
      "invitation_withdraw",
      "feed_list",
      "posts_search",
      "post_resolve",
      "post_get",
      "post_draft_create",
      "post_schedule",
      "scheduled_posts_list",
      "scheduled_post_cancel",
      "post_like",
      "post_comment",
      "comments_list",
      "reactions_list",
      "operation_get",
    ].sort(),
  );
});

it("requires the previous revision for continuation windows", async () => {
  await expect(
    textWindow("abcdef", { text_offset: 2 }, async (x) => x),
  ).rejects.toThrow("text_revision_required");
});
it("deduplicates overlapping pages and drains mixed-order message buffers", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    entityUrn: `m${i}`,
    deliveredAt: 100 - i,
  }));
  const fetch = async () => ({ data: { elements: [...rows].reverse() } });
  let p = await readApi("messages_list", { limit: 7 }, {}, fetch);
  const ids = p.items.map((r: any) => r.entityUrn);
  while (p.next?.buffered.length) {
    p = await readApi("messages_list", { limit: 7 }, p.next, fetch);
    ids.push(...p.items.map((r: any) => r.entityUrn));
  }
  expect(ids).toEqual(rows.map((r) => r.entityUrn));
  const stalled = await readApi("messages_list", { limit: 7 }, p.next, fetch);
  expect(stalled.items).toEqual([]);
  expect(stalled).toMatchObject({
    partial: true,
    completeness: "timestamp_boundary_unresolved",
  });
  expect(stalled.next).toBeUndefined();
});
it("does not claim temporal completeness for missing timestamps or unresolved ties", async () => {
  for (const deliveredAt of [undefined, 100]) {
    const fetch = async () => ({
      data: {
        elements: Array.from({ length: 50 }, (_, i) => ({
          entityUrn: `m${i}`,
          deliveredAt,
        })),
      },
    });
    const first = await readApi("messages_list", { limit: 50 }, {}, fetch);
    const last = first.next
      ? await readApi("messages_list", { limit: 50 }, first.next, fetch)
      : first;
    expect(last.partial).toBe(true);
    expect(last.next).toBeUndefined();
  }
});
it("message lookup stays scoped and distinguishes incomplete lookup from absence", async () => {
  const args = {
    conversation_urn: "urn:li:msg_conversation:a",
    message_urn: "missing",
  };
  await expect(
    readApi("message_get", args, {}, async () => ({ data: { elements: [] } })),
  ).rejects.toThrow("message_not_found");
  await expect(
    readApi("message_get", args, {}, async () => ({
      data: { elements: [{ entityUrn: "other" }] },
    })),
  ).rejects.toThrow("message_lookup_incomplete");
});
it("public message and conversation schemas reject source drift", async () => {
  const { capabilities } = await import("../src/core/capabilities.js");
  const projected = messageView({
    entityUrn: "m",
    body: { text: "hello" },
    $type: "internal",
  });
  const good = {
    message: {
      ...projected,
      ...(await textWindow("hello", {}, async (x) => x)),
    },
    conversation_urn: "c",
  };
  expect(capabilities.message_get.output.safeParse(good).success).toBe(true);
  expect(
    capabilities.message_get.output.safeParse({
      ...good,
      message: { ...good.message, $type: "leak" },
    }).success,
  ).toBe(false);
});

it("keeps international profile identifiers directly usable across post and profile readers", async () => {
  const { postView } = await import("../src/core/read-models.js");
  const post = postView({
    author: "Example",
    author_profile_url: "https://www.linkedin.com/in/test-m%C3%BCller/",
  });
  const input = parse("profile_get", {
    account_urn: "urn:li:fsd_profile:me",
    public_identifier: post.author_identity.public_identifier,
  });
  const r = await readApi("profile_get", input, {}, async (request) => {
    expect(
      new URLSearchParams(request.path.split("?")[1]).get("memberIdentity"),
    ).toBe("test-müller");
    return {
      data: {
        elements: [
          {
            entityUrn: "urn:li:fsd_profile:x",
            publicIdentifier: "test-müller",
            firstName: "Example",
          },
        ],
      },
    };
  });
  expect(r.profile.profile_url).toBe(
    "https://www.linkedin.com/in/test-m%C3%BCller/",
  );
});

it("does not expose malformed encoded identifiers as usable profile references", async () => {
  for (const publicIdentifier of [
    "bad%encoding",
    "path%2Fother",
    "name%3Fquery",
    "x".repeat(151),
  ]) {
    expect(personRef({ publicIdentifier }).identity_status).toBe("unresolved");
    await expect(
      readApi(
        "profile_get",
        { public_identifier: publicIdentifier },
        {},
        async () => {
          throw new Error("must not fetch");
        },
      ),
    ).rejects.toThrow("invalid_profile_identifier");
  }
});
