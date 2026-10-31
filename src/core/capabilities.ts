import { z } from "zod";
import { schemas, writes, type Operation } from "./contracts.js";

const row = (shape: z.ZodRawShape) => z.object(shape).passthrough();
const relationshipEvidence = z.array(
  z.object({ source: z.string(), value: z.string() }).strict(),
);
const invitationScan = z
  .object({
    pages: z.number().int().min(0).max(3),
    checked_count: z.number().int().min(0).max(60),
    complete: z.boolean(),
    matched: z.boolean(),
    stop_reason: z.enum([
      "match_found",
      "source_exhausted",
      "page_limit",
      "source_incomplete",
      "source_unavailable",
    ]),
    error_code: z.string().optional(),
  })
  .strict();
const person = row({
  entityUrn: z.string().nullable().optional(),
  profile_url: z.string().nullable().optional(),
  name: z.string().optional(),
  headline: z.string().nullable().optional(),
});
const reference = z
  .object({
    entityUrn: z.string().nullable(),
    name: z.string(),
    public_identifier: z.string().nullable(),
    profile_url: z.string().nullable(),
    identity_status: z.enum(["resolved", "unresolved"]),
  })
  .strict();
const excerpt = z
  .object({
    text: z.string(),
    text_truncated: z.boolean(),
    total_chars: z.number(),
  })
  .strict();
const windowFields = {
  text_revision: z.string(),
  text_offset: z.number(),
  total_chars: z.number(),
  next_text_offset: z.number().nullable(),
  text_complete: z.boolean(),
};
const conversation = z
  .object({
    entityUrn: z.string(),
    title: z.string().nullable(),
    participants: z.array(reference),
    last_activity_at: z.number().nullable(),
    preview: excerpt,
    read: z.boolean().nullable(),
    category: z.string().nullable(),
  })
  .strict();
const message = z
  .object({
    entityUrn: z.string(),
    deliveredAt: z.number().nullable(),
    sender: reference,
    text: z.string(),
    text_truncated: z.boolean(),
    total_chars: z.number(),
    timestamp_status: z.enum(["known", "unknown"]),
    attachments: z.array(
      z
        .object({
          name: z.string().nullable(),
          media_type: z.string().nullable(),
          size_bytes: z.number().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const post = z
  .object({
    entityUrn: z.string().nullable(),
    scan_key: z.string().nullable(),
    text: z.string(),
    text_truncated: z.boolean(),
    total_chars: z.number(),
    source_text_truncated: z.boolean(),
    source: z.string(),
    full_text: z.union([
      z
        .object({ operation: z.literal("post_get"), post_urn: z.string() })
        .strict(),
      z
        .object({
          operation: z.literal("post_resolve"),
          scan_key: z.string().nullable(),
        })
        .strict(),
    ]),
    author: z.string(),
    author_identity: reference,
    original_author: reference.nullable(),
    published_at: z.string().nullable(),
    visible_time: z.string().nullable(),
    date_precision: z.enum(["timestamp", "relative", "unknown"]),
    post_kind: z.enum(["original", "repost", "unknown"]),
    url: z.string().nullable(),
    identity_status: z.enum(["resolved", "unresolved"]),
  })
  .strict();
const section = z
  .object({
    status: z.enum(["available", "not_present", "unavailable"]),
    text: z.string().nullable().optional(),
  })
  .strict();
const profile = z
  .object({
    entityUrn: z.string().nullable(),
    name: z.string(),
    headline: z.string().nullable(),
    profile_url: z.string(),
    public_identifier: z.string(),
    location: z.string().nullable(),
    sections: z
      .object({
        basic: section.optional(),
        about: section.optional(),
        current_positions: section.optional(),
        location: section.optional(),
      })
      .strict(),
  })
  .strict();
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
  message_get: {
    adapter: "api",
    output: z
      .object({
        message: message.extend(windowFields),
        conversation_urn: z.string(),
      })
      .strict(),
  },
  conversations_find: {
    adapter: "api",
    source: "local_scan",
    order: "source_order",
    output: list(conversation),
  },
  posts_search: {
    adapter: "dom",
    source: "dom_session",
    order: "linkedin_search_order",
    output: list(post),
  },
  profile_posts_list: {
    adapter: "dom",
    source: "dom_session",
    order: "profile_activity_order",
    output: list(post),
  },
  relationship_get: {
    adapter: "dom",
    output: z
      .object({
        profile_urn: z.string(),
        status: z.enum([
          "connected",
          "outgoing_pending",
          "incoming_pending",
          "not_connected",
          "unknown",
        ]),
        messaging: z.enum(["allowed", "not_allowed", "unknown"]),
        observed_at: z.string(),
        evidence: relationshipEvidence,
        connection_degree: z.enum(["1", "2", "3", "unknown"]),
        messaging_evidence: relationshipEvidence,
        invitation_scan: z
          .object({ received: invitationScan, sent: invitationScan })
          .strict(),
        action_scan: z
          .object({ reason: z.string(), menu_opened: z.boolean() })
          .strict(),
        reason: z.string(),
      })
      .strict(),
  },
  messages_list: {
    adapter: "api",
    source: "timestamp",
    order: "newest_first",
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
  profile_get: { adapter: "dom", output: z.object({ profile }).strict() },
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
    output: post,
  },
  post_get: {
    adapter: "dom",
    output: post.extend({ ...windowFields, reason: z.string().optional() }),
  },
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
  post_draft_create: { adapter: "dom", output: mutation },
  post_schedule: { adapter: "dom", output: mutation },
  scheduled_post_cancel: { adapter: "dom", output: mutation },
  scheduled_posts_list: {
    adapter: "dom",
    output: row({
      items: z.array(
        row({
          scheduled_ref: z.string(),
          text: z.string(),
          scheduled_at: z.string(),
        }),
      ),
      complete: z.boolean(),
    }),
  },
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
export const capabilities = Object.fromEntries(
  Object.keys(schemas).map((name) => {
    const op = name as Operation;
    return [
      op,
      {
        ...definitions[op],
        enabled: true,
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
const buildAcceptance: { fingerprint?: string; passed?: string[] } = JSON.parse(
  process.env.BRIDGE_ACCEPTANCE ?? "{}",
);
export function capabilityStatus(connected: boolean) {
  return Object.entries(capabilities).map(([name, c]) => ({
    name,
    implemented: true,
    accepted: buildAcceptance.passed?.includes(name) ?? false,
    acceptance: buildAcceptance.passed?.includes(name)
      ? "current_build_live_acceptance"
      : "current_build_live_acceptance_pending",
    acceptance_revision: null,
    acceptance_fingerprint: buildAcceptance.fingerprint ?? null,
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
