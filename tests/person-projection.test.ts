import { expect, it } from "vitest";
import { Engine } from "../src/core/engine.js";
import {
  personRef,
  conversationView,
  messageView,
} from "../src/core/read-models.js";
it("uses one person projection through all five public messaging primitives", async () => {
  const account = "urn:li:fsd_profile:me",
    peer = "urn:li:fsd_profile:peer",
    conversation_urn = "urn:li:msg_conversation:example";
  const person = {
    hostIdentityUrn: peer,
    participantType: {
      member: {
        firstName: { text: "Álex" },
        lastName: { text: "Example" },
        profileUrl: "https://www.linkedin.com/in/alex-example/",
      },
    },
  };
  const conversation = {
    entityUrn: conversation_urn,
    participants: [{ hostIdentityUrn: account }, person],
  };
  const message = {
    entityUrn: "urn:li:msg_message:example",
    sender: person,
    deliveredAt: 100,
    body: { text: "A useful reply" },
  };
  const data = new Map<string, any>();
  const engine = new Engine({
    store: {
      get: async (k) => data.get(k),
      set: async (k, v) => {
        data.set(k, v);
      },
      remove: async (k) => {
        data.delete(k);
      },
    },
    fetch: async (r) =>
      r.path === "/me"
        ? { data: { miniProfile: { entityUrn: account } } }
        : r.path.includes("messengerMessages")
          ? { data: { elements: [message] }, included: [conversation] }
          : { data: { elements: [conversation] } },
    dom: async () => {
      throw Error("No DOM navigation for messaging reads");
    },
    account: async () => account,
    now: () => 1000,
    uuid: () => crypto.randomUUID(),
    hash: async (x) => x,
  });
  const refs = [];
  for (const op of [
    "conversations_list",
    "conversations_find",
    "conversations_get",
    "messages_list",
    "message_get",
  ]) {
    const args =
      op === "conversations_list"
        ? { limit: 20 }
        : op === "conversations_find"
          ? { profile_urn: peer }
          : op === "message_get"
            ? { conversation_urn, message_urn: message.entityUrn }
            : { conversation_urn };
    const result = await engine.run(op, { account_urn: account, ...args });
    expect(JSON.stringify(result)).not.toContain("[object Object]");
    refs.push(
      op === "message_get"
        ? result.message.sender
        : op === "messages_list"
          ? result.items[0].sender
          : (op === "conversations_get"
              ? result.conversation
              : result.items[0]
            ).participants.find((p: any) => p.entityUrn === peer),
    );
  }
  for (const ref of refs) expect(ref).toEqual(personRef(person));
});
it.each([
  [
    { firstName: { text: "Alex" }, lastName: { text: "Example" } },
    "Alex Example",
  ],
  [{ firstName: "Alex", lastName: { text: "Example" } }, "Alex Example"],
  [{ firstName: { text: "  Álex " }, lastName: { text: "  李  " } }, "Álex 李"],
  [{ firstName: { text: "" }, lastName: { text: "Example" } }, "Example"],
  [{ firstName: { text: "Alex" } }, "Alex"],
  [
    { name: { text: " Explicit Name " }, firstName: { text: "Wrong" } },
    "Explicit Name",
  ],
  [{ firstName: {}, lastName: { text: "" } }, ""],
])("normalizes compact participant and sender names: %j", (member, name) => {
  const raw = {
    hostIdentityUrn: "urn:li:fsd_profile:example",
    participantType: { member },
  };
  const person = personRef(raw);
  expect(person.name).toBe(name);
  expect(person.identity_status).toBe("resolved");
  expect(
    conversationView({ entityUrn: "c", participants: [raw] }).participants,
  ).toEqual([person]);
  expect(messageView({ entityUrn: "m", sender: raw }).sender).toEqual(person);
  expect(JSON.stringify(person)).not.toContain("[object Object]");
});
it.each(["profileUrl", "profile_url"])(
  "accepts the observed %s field without guessing a slug",
  (field) => {
    expect(
      personRef({
        [field]: "https://www.linkedin.com/in/álex-example/",
        firstName: "Someone",
      }),
    ).toMatchObject({
      public_identifier: "álex-example",
      profile_url: "https://www.linkedin.com/in/%C3%A1lex-example/",
    });
    expect(
      personRef({
        [field]: "https://foreign.invalid/in/example/",
        firstName: "Someone",
      }).public_identifier,
    ).toBeNull();
  },
);
