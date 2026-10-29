import { z } from "zod";
const urn = z.string().regex(/^urn:li:[A-Za-z_]+:[^\s]{1,500}$/);
const account = {
  account_urn: z.string().regex(/^urn:li:fsd_profile:[\w-]+$/),
};
const page = {
  ...account,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
};
const write = { ...account, idempotency_key: z.string().min(8).max(128) };
const conversation = { conversation_urn: urn };
const post = {
  post_urn: z.string().regex(/^urn:li:(activity|ugcPost|share):\d+$/),
};
const filters = z
  .object({
    connection_degrees: z
      .array(z.enum(["1", "2", "3"]))
      .max(3)
      .optional(),
    location_ids: z
      .array(z.string().regex(/^\d{1,20}$/))
      .max(10)
      .optional(),
    company_ids: z
      .array(z.string().regex(/^\d{1,20}$/))
      .max(10)
      .optional(),
  })
  .strict()
  .optional();
const text = z.string().trim().min(1).max(3000);
export const schemas = {
  health: z.object({}).strict(),
  conversations_list: z
    .object({
      ...page,
      category: z.enum(["INBOX", "ARCHIVE", "SPAM"]).default("INBOX"),
      unread_only: z.boolean().default(false),
    })
    .strict(),
  conversations_search: z
    .object({
      ...page,
      query: z.string().trim().min(1).max(200),
      scan_pages: z.number().int().min(1).max(10).default(3),
      category: z.enum(["INBOX", "ARCHIVE", "SPAM"]).default("INBOX"),
    })
    .strict(),
  messages_list: z.object({ ...page, ...conversation }).strict(),
  message_send: z
    .object({
      ...write,
      conversation_urn: urn.optional(),
      recipient_urn: z
        .string()
        .regex(/^urn:li:fsd_profile:[\w-]+$/)
        .optional(),
      expected_participant_urns: z.array(urn).min(1).max(50),
      text,
    })
    .strict(),
  conversation_update: z
    .object({
      ...write,
      ...conversation,
      action: z.enum(["read", "unread", "archive", "unarchive"]),
    })
    .strict(),
  conversation_delete: z.object({ ...write, ...conversation }).strict(),
  profile_get: z
    .object({
      ...account,
      public_identifier: z.string().regex(/^[\w%\-]{1,150}$/),
    })
    .strict(),
  people_search: z
    .object({ ...page, query: z.string().trim().min(1).max(200), filters })
    .strict(),
  people_search_filters: z
    .object({ ...account, query: z.string().trim().min(1).max(200) })
    .strict(),
  extraction_start: z
    .object({
      ...account,
      ...post,
      kind: z.enum(["comments", "reactions"]),
      max_items: z.number().int().min(1).max(500).default(100),
    })
    .strict(),
  extraction_get: z
    .object({
      ...account,
      operation_id: z.string().uuid(),
      offset: z.number().int().min(0).max(500).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  extraction_cancel: z
    .object({ ...account, operation_id: z.string().uuid() })
    .strict(),
  reactions_list: z.object({ ...page, ...post }).strict(),
  invitations_list: z
    .object({
      ...page,
      direction: z.enum(["received", "sent"]).default("received"),
    })
    .strict(),
  invitation_send: z
    .object({
      ...write,
      profile_urn: z.string().regex(/^urn:li:fsd_profile:[\w-]+$/),
      note: z.string().max(200).optional(),
    })
    .strict(),
  invitation_respond: z
    .object({
      ...write,
      invitation_urn: urn,
      action: z.enum(["accept", "ignore"]),
    })
    .strict(),
  invitation_withdraw: z.object({ ...write, invitation_urn: urn }).strict(),
  feed_list: z.object({ ...page }).strict(),
  post_get: z.object({ ...account, ...post }).strict(),
  post_create: z.object({ ...write, text }).strict(),
  post_like: z
    .object({ ...write, ...post, liked: z.boolean().default(true) })
    .strict(),
  post_comment: z.object({ ...write, ...post, text }).strict(),
  comments_list: z.object({ ...page, ...post }).strict(),
  operation_get: z
    .object({ ...account, idempotency_key: z.string().min(8).max(128) })
    .strict(),
};
export type Operation = keyof typeof schemas;
export const writes = new Set<Operation>([
  "message_send",
  "conversation_update",
  "conversation_delete",
  "invitation_send",
  "invitation_respond",
  "invitation_withdraw",
  "post_create",
  "post_like",
  "post_comment",
]);
export type Args = Record<string, any>;
export class Fault extends Error {
  constructor(
    public code: string,
    message = code,
  ) {
    super(message);
  }
}
export function parse(op: string, args: unknown): Args {
  if (!Object.hasOwn(schemas, op)) throw new Fault("unknown_operation");
  const a = schemas[op as Operation].parse(args);
  if (
    op === "message_send" &&
    Number(!!(a as Args).conversation_urn) +
      Number(!!(a as Args).recipient_urn) !==
      1
  )
    throw new Fault("choose_conversation_or_recipient");
  return a;
}
export const descriptions: Partial<Record<Operation, string>> = {
  health: "Connection, account and capability status. Read this first.",
  conversations_search:
    "Search bounded inbox pages by participant/title/preview. Continue cursor for older pages; not a full server-side search.",
  messages_list:
    "Read message history without marking it read. Cursor-bound pagination.",
  message_send:
    "Send plain text to an existing conversation or one recipient. Must be explicitly requested by the user. Supply exact expected participant URNs, excluding yourself. Never retry an unknown outcome with a new key.",
  conversation_delete:
    "Delete this conversation from your own inbox; not a recall for recipients. Requires explicit user intent.",
  operation_get:
    "Read persisted mutation receipt. Unknown outcomes must be checked in LinkedIn before any new send.",
  profile_get:
    "Read profile details; LinkedIn may count this as a profile visit.",
};
