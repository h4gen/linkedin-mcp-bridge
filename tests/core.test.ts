import { describe, it, expect, vi } from "vitest";
import { Engine, Store } from "../src/core/engine.js";
import { parse, schemas } from "../src/core/contracts.js";
import { collection, restli, self } from "../src/core/normalize.js";
import { mutation, readApi } from "../src/core/api.js";
import {
  NativeMessageDecoder,
  encodeNativeMessage,
} from "../src/native/framing.js";
import { manifest } from "../src/installer.js";
const account = "urn:li:fsd_profile:me";
const recipient = "urn:li:fsd_profile:friend";
const me = {
  data: { "*miniProfile": "urn:li:fs_miniProfile:me" },
  included: [{ entityUrn: "urn:li:fs_miniProfile:me" }],
};
function fixture() {
  const data: Record<string, any> = {};
  const store: Store = {
    get: async (k) => data[k],
    set: async (k, v) => {
      data[k] = structuredClone(v);
    },
    remove: async (k) => {
      delete data[k];
    },
  };
  const fetch = vi.fn(
    async (r: any): Promise<any> =>
      r.path === "/me" ? me : { data: { elements: [], metadata: {} } },
  );
  let now = 1000;
  let uuid = 0;
  const dom = vi.fn(async () => ({ verified: false }));
  const engine = new Engine({
    store,
    fetch,
    dom,
    account: async () => account,
    now: () => now,
    uuid: () => String(++uuid),
    hash: async (x) => x,
  });
  return {
    data,
    store,
    fetch,
    dom,
    engine,
    time: (n: number) => {
      now = n;
    },
  };
}
const send = {
  account_urn: account,
  recipient_urn: recipient,
  expected_participant_urns: [recipient],
  text: "Hello",
  idempotency_key: "unique-key-1",
};
describe("contracts", () => {
  it("rejects arbitrary tools and extra transport fields", () => {
    expect(() => parse("fetch", {})).toThrow();
    expect(() => parse("health", { url: "https://example.com" })).toThrow();
  });
  it("requires exactly one message destination and exact expected recipients", () => {
    expect(() =>
      parse("message_send", {
        ...send,
        conversation_urn: "urn:li:msg_conversation:x",
      }),
    ).toThrow();
    expect(() =>
      parse("message_send", { ...send, recipient_urn: undefined }),
    ).toThrow();
  });
  it("caps pages and validates all tool schemas", () => {
    expect(Object.keys(schemas)).toHaveLength(24);
    expect(() =>
      parse("messages_list", {
        account_urn: account,
        conversation_urn: "urn:li:msg_conversation:x",
        limit: 100,
      }),
    ).toThrow();
  });
  it("encodes nested Rest.li values without syntax injection", () => {
    expect(restli({ x: "a),evil:(1", list: ["urn:li:x:a"] })).toBe(
      "(x:a%29%2Cevil%3A%281,list:List(urn%3Ali%3Ax%3Aa))",
    );
  });
});
describe("normalization", () => {
  it("resolves normalized collection and participant references", () => {
    const c = collection({
      data: { data: { messages: { "*elements": ["urn:m"] } } },
      included: [
        { entityUrn: "urn:m", body: { text: "Hi" }, "*sender": "urn:p" },
        { entityUrn: "urn:p", name: "Friend" },
      ],
    });
    expect(c.items[0].sender.name).toBe("Friend");
  });
  it("does not interpret a broken response as empty results", () => {
    expect(() => collection({ data: { error: "changed" } })).toThrow(
      "no recognized collection",
    );
    expect(collection({ data: { elements: [] } }).items).toEqual([]);
  });
  it("only resolves the explicitly referenced own profile", () => {
    expect(self(me)).toBe(account);
    expect(() =>
      self({ included: [{ entityUrn: "urn:li:fs_miniProfile:wrong" }] }),
    ).toThrow();
  });
});
describe("mutation journal", () => {
  it("persists before dispatch and never resends an ambiguous write", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (r) => {
      if (r.path === "/me") return me;
      expect(Object.values(f.data.journal)[0]).toMatchObject({
        status: "pending",
      });
      throw Error("socket disconnected");
    });
    const first = await f.engine.run("message_send", send);
    expect(first.status).toBe("unknown_outcome");
    const calls = f.fetch.mock.calls.length;
    expect((await f.engine.run("message_send", send)).replayed).toBe(true);
    expect(f.fetch.mock.calls.length).toBe(calls + 1);
  });
  it("rejects a reused key with a different payload", async () => {
    const f = fixture();
    await f.engine.run("message_send", send);
    await expect(
      f.engine.run("message_send", { ...send, text: "Different" }),
    ).rejects.toThrow("idempotency_conflict");
  });
  it("rejects account and recipient mismatch before mutation", async () => {
    const f = fixture();
    await expect(
      f.engine.run("message_send", {
        ...send,
        account_urn: "urn:li:fsd_profile:other",
      }),
    ).rejects.toThrow("account_mismatch");
    await expect(
      f.engine.run("message_send", {
        ...send,
        expected_participant_urns: ["urn:li:fsd_profile:other"],
      }),
    ).rejects.toThrow("recipient_mismatch");
    expect(f.fetch.mock.calls.every(([r]) => r.path === "/me")).toBe(true);
  });
  it("reports a receipt and stores no message text", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (r) =>
      r.path === "/me" ? me : { data: { entityUrn: "urn:li:msg_message:123" } },
    );
    expect((await f.engine.run("message_send", send)).status).toBe("confirmed"); // hash mock stores payload; production SHA256 does not
    const row = Object.values(f.data.journal)[0] as any;
    expect(row.text).toBeUndefined();
    expect(row.receipt_id).toBe("urn:li:msg_message:123");
  });
  it("retains pending state across engine restart without dispatch", async () => {
    const f = fixture();
    await f.engine.run("message_send", send);
    const row = Object.values(f.data.journal)[0] as any;
    row.status = "pending";
    expect((await f.engine.run("message_send", send)).status).toBe(
      "unknown_outcome",
    );
  });
  it("expires receipts after seven days", async () => {
    const f = fixture();
    await f.engine.run("message_send", send);
    f.time(8 * 86400000);
    expect(
      (
        await f.engine.run("operation_get", {
          account_urn: account,
          idempotency_key: send.idempotency_key,
        })
      ).status,
    ).toBe("not_found");
  });
  it("never starts expired work", async () => {
    const f = fixture();
    await expect(f.engine.run("message_send", send, 1)).rejects.toThrow(
      "deadline_exceeded",
    );
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
describe("pagination", () => {
  it("binds cursors to account, operation and filters", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (r) =>
      r.path === "/me"
        ? me
        : { data: { elements: [], metadata: { nextCursor: "remote" } } },
    );
    const first = await f.engine.run("conversations_list", {
      account_urn: account,
    });
    await expect(
      f.engine.run("conversations_list", {
        account_urn: account,
        category: "ARCHIVE",
        cursor: first.next_cursor,
      }),
    ).rejects.toThrow("invalid_cursor");
    const next = await f.engine.run("conversations_list", {
      account_urn: account,
      cursor: first.next_cursor,
    });
    expect(next.next_cursor).toBeDefined();
  });
  it("does not use a DOM fallback or mark read on history reads", async () => {
    const f = fixture();
    await f.engine.run("messages_list", {
      account_urn: account,
      conversation_urn: "urn:li:msg_conversation:1",
    });
    expect(f.dom).not.toHaveBeenCalled();
    expect(f.fetch.mock.calls.every(([r]) => !r.method)).toBe(true);
  });
});
describe("transport and installer", () => {
  it("handles fragmented native messages and UTF8", () => {
    const bytes = encodeNativeMessage({ text: "Grüße 👋" });
    const d = new NativeMessageDecoder();
    expect(d.push(bytes.subarray(0, 2))).toEqual([]);
    expect(d.push(bytes.subarray(2, 8))).toEqual([]);
    expect(d.push(bytes.subarray(8))).toEqual([{ text: "Grüße 👋" }]);
  });
  it("rejects oversized native frames", () => {
    const d = new NativeMessageDecoder();
    const b = Buffer.alloc(4);
    b.writeUInt32LE(100 * 1024 * 1024);
    expect(() => d.push(b)).toThrow();
    expect(() =>
      encodeNativeMessage({ text: "x".repeat(1024 * 1024) }),
    ).toThrow();
  });
  it("uses a separate host and exact extension origin", () => {
    expect(manifest("a".repeat(32), "/test").name).toBe(
      "com.hagen.linkedin_mcp_bridge",
    );
    expect(manifest("a".repeat(32), "/test").allowed_origins).toEqual([
      "chrome-extension://" + "a".repeat(32) + "/",
    ]);
    expect(() => manifest("*", "/test")).toThrow();
  });
  it("creates typed message request without caller supplied paths", () => {
    const request = mutation("message_send", send, "origin");
    expect(request?.path).toBe(
      "/voyagerMessagingDashMessengerMessages?action=createMessage",
    );
    expect((request?.body as any).hostRecipientUrns).toEqual([recipient]);
  });
});

it("serializes concurrent duplicate sends and honors queued cancellation", async () => {
  const f = fixture();
  let sends = 0;
  f.fetch.mockImplementation(async (r) => {
    if (r.path === "/me") return me;
    sends++;
    await new Promise((r) => setTimeout(r, 5));
    return { data: { entityUrn: "urn:li:msg_message:123" } };
  });
  const [first, second] = await Promise.all([
    f.engine.run("message_send", send),
    f.engine.run("message_send", send),
  ]);
  expect(sends).toBe(1);
  expect(first.status).toBe("confirmed");
  expect(second.replayed).toBe(true);
  await expect(
    f.engine.run(
      "message_send",
      { ...send, idempotency_key: "cancelled-key" },
      10000,
      () => true,
    ),
  ).rejects.toThrow("cancelled");
  expect(sends).toBe(1);
});
it("confirms read-state mutation only after a matching postcondition", async () => {
  const f = fixture();
  f.fetch.mockImplementation(async (r) =>
    r.path === "/me"
      ? me
      : r.method
        ? {}
        : {
            data: {
              elements: [
                { entityUrn: "urn:li:msg_conversation:1", read: true },
              ],
            },
          },
  );
  const result = await f.engine.run("conversation_update", {
    account_urn: account,
    conversation_urn: "urn:li:msg_conversation:1",
    action: "read",
    idempotency_key: "read-key-123",
  });
  expect(result.status).toBe("confirmed");
  expect(f.fetch.mock.calls.filter(([r]) => r.method)).toHaveLength(1);
});

it("caps live inbox backend pages to 20 while retaining the remote cursor", async () => {
  const fetch = vi.fn(async (_r: any) => ({
    data: { elements: [], metadata: { nextCursor: "next" } },
  }));
  const page = await readApi(
    "conversations_list",
    { account_urn: account, category: "INBOX", limit: 50 },
    {},
    fetch,
  );
  expect(fetch.mock.calls[0][0].path).toContain("count:20");
  expect(page.next).toEqual({ nextCursor: "next" });
});

it("encodes LinkedIn message trackingId as sixteen bytes, not the UUID spelling", () => {
  const r = mutation(
    "message_send",
    send,
    "00112233-4455-4677-8899-aabbccddeeff",
  );
  expect((r?.body as any).trackingId.length).toBe(16);
  expect((r?.body as any).message.originToken).toBe(
    "00112233-4455-4677-8899-aabbccddeeff",
  );
});
