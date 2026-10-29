import { z } from "zod";
import { schemas, writes, type Operation } from "./contracts.js";

const row = (shape: z.ZodRawShape) => z.object(shape).passthrough();
const person = row({
  entityUrn: z.string().nullable().optional(),
  profile_url: z.string().nullable().optional(),
  name: z.string().optional(),
  headline: z.string().nullable().optional(),
});
const conversation = row({
  entityUrn: z.string(),
  title: z.string().nullable().optional(),
});
const message = row({
  entityUrn: z.string(),
  deliveredAt: z.number().optional(),
});
const post = row({
  entityUrn: z.string().nullable(),
  text: z.string(),
  url: z.string().nullable(),
});
const comment = row({
  id: z.string(),
  text: z.string().optional(),
  parent_id: z.string().nullable(),
});
const reaction = row({
  id: z.string(),
  profile_url: z.string(),
  name: z.string(),
});
export const pageInfoSchema = z.object({
  returned_count: z.number().int().nonnegative(),
  requested_limit: z.number().int().positive(),
  continuation: z.enum(["available", "exhausted", "blocked"]),
  coverage: z.enum(["complete_for_scope", "partial", "unknown"]),
  consistency: z.literal("live_traversal"),
  source: z.enum([
    "server_cursor",
    "timestamp",
    "offset",
    "local_scan",
    "dom_session",
  ]),
  order: z.string(),
  reason: z.string().nullable(),
  observed_at: z.string(),
  cursor_expires_at: z.string().nullable(),
});
const list = (item: z.ZodType) =>
  row({
    items: z.array(item),
    next_cursor: z.string().nullable(),
    partial: z.boolean(),
    page_info: pageInfoSchema,
  });
const mutation = row({
  status: z.enum([
    "approval_required",
    "approved",
    "rejected",
    "expired",
    "pending",
    "unknown_outcome",
    "failed_before_dispatch",
    "confirmed",
    "not_found",
  ]),
  receipt_id: z.string().optional(),
});
const definitions = {
  health: {
    adapter: "local",
    output: row({
      connected: z.boolean(),
      capabilities: z.array(z.record(z.string(), z.unknown())),
    }),
  },
  operation_get: { adapter: "local", output: mutation },
  conversations_list: {
    adapter: "api",
    source: "server_cursor",
    order: "source_order",
    output: list(conversation),
  },
  conversations_search: {
    adapter: "api",
    source: "local_scan",
    order: "source_order",
    output: list(conversation),
  },
  conversations_get: { adapter: "api", output: row({ conversation }) },
  messages_list: {
    adapter: "api",
    source: "timestamp",
    order: "source_timestamp_order",
    output: list(message),
  },
  people_search: {
    adapter: "api",
    source: "offset",
    order: "linkedin_ranked",
    output: list(person),
  },
  people_search_filters: {
    adapter: "api",
    output: row({
      options: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.enum(["location", "company"]),
        }),
      ),
      partial: z.boolean(),
    }),
  },
  profile_get: { adapter: "api", output: row({ profile: person }) },
  invitations_list: {
    adapter: "api",
    source: "offset",
    order: "source_order",
    output: list(
      row({
        entityUrn: z.string(),
        direction: z.enum(["received", "sent"]),
        profile: person,
      }),
    ),
  },
  feed_list: {
    adapter: "dom",
    source: "dom_session",
    order: "linkedin_feed_order",
    output: list(post),
  },
  post_resolve: {
    adapter: "dom",
    output: row({ entityUrn: z.string().nullable() }),
  },
  post_get: { adapter: "dom", output: post },
  comments_list: {
    adapter: "dom",
    source: "dom_session",
    order: "visible_ui_order",
    output: list(comment),
  },
  reactions_list: {
    adapter: "dom",
    source: "dom_session",
    order: "visible_ui_order",
    output: list(reaction),
  },
  message_send: { adapter: "api", output: mutation },
  conversation_update: { adapter: "api", output: mutation },
  invitation_send: { adapter: "api", output: mutation },
  conversation_delete: { adapter: "dom", output: mutation },
  invitation_respond: { adapter: "dom", output: mutation },
  invitation_withdraw: { adapter: "dom", output: mutation },
  post_create: { adapter: "dom", output: mutation },
  post_like: { adapter: "dom", output: mutation },
  post_comment: { adapter: "dom", output: mutation },
} satisfies Record<
  Operation,
  {
    adapter: "local" | "api" | "dom";
    source?: string;
    order?: string;
    output: z.ZodObject<any>;
  }
>;
export const acceptedWrites: ReadonlySet<Operation> = new Set([
  "message_send",
  "conversation_update",
]);
const testWrites: Operation[] =
  process.env.BRIDGE_CHANNEL === "development"
    ? JSON.parse(process.env.BRIDGE_TEST_WRITES ?? "[]")
    : [];
export const enabledWrites: ReadonlySet<Operation> = new Set([
  ...acceptedWrites,
  ...testWrites,
]);
export const capabilities = Object.fromEntries(
  Object.keys(schemas).map((name) => {
    const op = name as Operation;
    return [
      op,
      {
        ...definitions[op],
        enabled: !writes.has(op) || enabledWrites.has(op),
        required: true,
      },
    ];
  }),
) as Record<
  Operation,
  {
    adapter: "local" | "api" | "dom";
    source?: string;
    order?: string;
    output: z.ZodObject<any>;
    enabled: boolean;
    required: boolean;
  }
>;
const buildAcceptance: { revision?: string; passed?: string[] } = JSON.parse(
  process.env.BRIDGE_ACCEPTANCE ?? "{}",
);
export function capabilityStatus(connected: boolean) {
  return Object.entries(capabilities).map(([name, c]) => ({
    name,
    implemented: true,
    acceptance_test_only: testWrites.includes(name as Operation),
    accepted: buildAcceptance.passed?.includes(name) ?? false,
    acceptance: buildAcceptance.passed?.includes(name)
      ? "current_build_live_acceptance"
      : "current_build_live_acceptance_pending",
    acceptance_revision: buildAcceptance.revision ?? null,
    enabled: c.enabled,
    available: c.enabled && (connected || c.adapter === "local"),
    source: c.source ?? c.adapter,
    side_effects: writes.has(name as Operation)
      ? ["external_mutation"]
      : c.adapter === "dom"
        ? ["work_tab_navigation_or_scrolling"]
        : name === "profile_get"
          ? ["possible_profile_visit"]
          : [],
  }));
}
