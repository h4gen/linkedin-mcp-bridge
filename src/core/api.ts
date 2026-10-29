import { Args, Fault, Operation } from "./contracts.js";
import { collection, normalize, restli } from "./normalize.js";
export type Request = {
  path: string;
  method?: "POST" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};
export type Fetcher = (r: Request) => Promise<any>;
// Source protocol captures are documented in docs/protocol.md. Hashes are versioned,
// not interchangeable merely because they share a GraphQL operation prefix.
export const queries = {
  conversations: "messengerConversations.9501074288a12f3ae9e3c7ea243bccbf",
  messages: "messengerMessages.d8ea76885a52fd5dc5c317078ab7c977",
  people: "voyagerSearchDashClusters.e438ab99259203e9c1cd3f358e217282",
};
export function graph(kind: keyof typeof queries, variables: Args): Request {
  return {
    path: `/${kind === "people" ? "graphql" : "voyagerMessagingGraphQL/graphql"}?queryId=${queries[kind]}&variables=${restli(variables)}`,
  };
}
export async function readApi(
  op: Operation,
  a: Args,
  state: Args,
  fetch: Fetcher,
): Promise<Args> {
  let raw: any;
  if (op === "profile_get")
    return normalize(
      await fetch({
        path:
          "/identity/dash/profiles?" +
          new URLSearchParams({
            q: "memberIdentity",
            memberIdentity: a.public_identifier,
            decorationId:
              "com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19",
          }),
      }),
    );
  if (op === "conversations_list" || op === "conversations_search")
    raw = await fetch(
      graph("conversations", {
        query: {
          predicateUnions: [
            { conversationCategoryPredicate: { category: a.category } },
          ],
        },
        count: Math.min(a.limit, 20),
        mailboxUrn: a.account_urn,
        ...(state.nextCursor ? { nextCursor: state.nextCursor } : {}),
      }),
    );
  else if (op === "messages_list")
    raw = await fetch(
      graph("messages", {
        deliveredAt: state.before ?? Date.now(),
        conversationUrn: a.conversation_urn,
        countBefore: a.limit,
        countAfter: 0,
      }),
    );
  else if (op === "people_search")
    raw = await fetch(
      graph("people", {
        start: state.start ?? 0,
        count: a.limit,
        origin: "GLOBAL_SEARCH_HEADER",
        query: {
          keywords: a.query,
          flagshipSearchIntent: "SEARCH_SRP",
          queryParameters: [{ key: "resultType", value: ["PEOPLE"] }],
          includeFiltersInResponse: false,
        },
      }),
    );
  else if (op === "invitations_list")
    raw = await fetch({
      path:
        (a.direction === "sent"
          ? "/relationships/sentInvitationViewsV2?"
          : "/relationships/invitationViews?") +
        new URLSearchParams({
          q: a.direction === "sent" ? "invitationType" : "receivedInvitation",
          invitationType: "CONNECTION",
          start: String(state.start ?? 0),
          count: String(a.limit),
        }),
    });
  else throw new Fault("not_api_operation");
  const c = collection(raw);
  let items = c.items;
  let next: Args | undefined;
  if (op.startsWith("conversations_")) {
    if (c.metadata.nextCursor) next = { nextCursor: c.metadata.nextCursor };
  } else if (op === "messages_list") {
    const times = items
      .map((x) => x.deliveredAt)
      .filter((x) => typeof x === "number");
    if (items.length >= a.limit && times.length) {
      const before = Math.min(...times);
      if (before < (state.before ?? Infinity)) next = { before };
    }
  } else if (
    items.length >= a.limit &&
    (c.paging.total === undefined ||
      (state.start ?? 0) + items.length < c.paging.total)
  )
    next = { start: (state.start ?? 0) + items.length };
  if (a.unread_only)
    items = items.filter((x) => x.read === false || x.unreadCount > 0);
  if (op === "conversations_search")
    items = items.filter((x) =>
      JSON.stringify(x)
        .toLocaleLowerCase()
        .includes(a.query.toLocaleLowerCase()),
    );
  return {
    items,
    next,
    scanned: c.items.length,
    partial: false,
    ...(op === "conversations_search"
      ? { search_scope: "current_page_participants_title_preview" }
      : {}),
  };
}
export function mutation(
  op: Operation,
  a: Args,
  originToken: string,
): Request | undefined {
  const conversations = "/voyagerMessagingDashMessengerConversations";
  if (op === "message_send")
    return {
      path: "/voyagerMessagingDashMessengerMessages?action=createMessage",
      method: "POST",
      body: {
        message: {
          body: { attributes: [], text: a.text },
          renderContentUnions: [],
          originToken,
          ...(a.conversation_urn
            ? { conversationUrn: a.conversation_urn }
            : {}),
        },
        mailboxUrn: a.account_urn,
        trackingId: String.fromCharCode(
          ...(originToken.replaceAll("-", "").match(/.{2}/g) ?? []).map(
            (byte) => parseInt(byte, 16),
          ),
        ),
        dedupeByClientGeneratedToken: false,
        ...(a.recipient_urn ? { hostRecipientUrns: [a.recipient_urn] } : {}),
      },
    };
  if (op === "conversation_update") {
    if (a.action === "archive" || a.action === "unarchive")
      return {
        path:
          conversations +
          "?action=" +
          (a.action === "archive" ? "addCategory" : "removeCategory"),
        method: "POST",
        body: { conversationUrns: [a.conversation_urn], category: "ARCHIVE" },
      };
    return {
      path: conversations + "?ids=" + restli([a.conversation_urn]),
      method: "POST",
      headers: { "x-restli-method": "BATCH_PARTIAL_UPDATE" },
      body: {
        entities: {
          [a.conversation_urn]: {
            patch: { $set: { read: a.action === "read" } },
          },
        },
      },
    };
  }
  if (op === "invitation_send")
    return {
      path: "/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2",
      method: "POST",
      body: {
        invitee: { inviteeUnion: { memberProfile: a.profile_urn } },
        ...(a.note ? { customMessage: a.note } : {}),
      },
    };
  return undefined;
}
export function receipt(raw: any): string | undefined {
  const values = normalize(raw ?? {});
  let found: string | undefined;
  const scan = (x: any, depth = 0) => {
    if (!x || typeof x !== "object" || depth > 7) return;
    for (const [k, v] of Object.entries(x)) {
      if (
        typeof v === "string" &&
        /^(entityUrn|messageUrn|invitation|invitationUrn|updateUrn)$/.test(k) &&
        /^urn:li:(msg_message|fsd_invitation|fs_invitation|activity|share|ugcPost):/.test(
          v,
        )
      )
        found ??= v;
      else scan(v, depth + 1);
    }
  };
  scan(values);
  return found;
}
