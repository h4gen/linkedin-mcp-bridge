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
  reactions: "voyagerSocialDashReactions.759f60600a6108d4110bc8b8f6ecd507",
  people: "voyagerSearchDashClusters.e438ab99259203e9c1cd3f358e217282",
};
export function graph(kind: keyof typeof queries, variables: Args): Request {
  return {
    path: `/${kind === "people" || kind === "reactions" ? "graphql" : "voyagerMessagingGraphQL/graphql"}?queryId=${queries[kind]}&variables=${restli(variables)}`,
  };
}
export async function readApi(
  op: Operation,
  a: Args,
  state: Args,
  fetch: Fetcher,
): Promise<Args> {
  let raw: any;
  if (op === "messages_list" && state.exhausted) {
    const items = (state.buffered ?? []).slice(0, a.limit);
    const remaining = (state.buffered ?? []).slice(a.limit);
    return {
      items,
      partial: remaining.length > 0,
      next: remaining.length ? { ...state, buffered: remaining } : undefined,
      completeness: remaining.length ? "more_available" : "source_exhausted",
    };
  }
  if (op === "conversations_search") {
    const items: Args[] = [];
    let next = state;
    let scanned = 0;
    let more = false;
    const seen = new Set<string>(state.seen ?? []);
    for (let i = 0; i < a.scan_pages && !state.exhausted; i++) {
      const page = await readApi(
        "conversations_list",
        { ...a, limit: 20 },
        next,
        fetch,
      );
      scanned += page.scanned;
      for (const item of page.items) {
        if (
          !seen.has(item.entityUrn) &&
          JSON.stringify(item)
            .toLocaleLowerCase()
            .includes(a.query.toLocaleLowerCase())
        ) {
          items.push(item);
          seen.add(item.entityUrn);
        }
      }
      more = !!page.next;
      if (!more) break;
      if (page.next.nextCursor === next.nextCursor)
        throw new Fault("pagination_stalled");
      next = page.next;
      if (items.length >= a.limit) break;
    }
    const buffered = [...(state.buffered ?? []), ...items];
    return {
      items: buffered.slice(0, a.limit),
      scanned,
      partial: more,
      search_scope: "participants_title_preview_not_full_message_history",
      next:
        more || buffered.length > a.limit
          ? {
              ...next,
              exhausted: !more,
              buffered: buffered.slice(a.limit),
              seen: [...seen].slice(-5000),
            }
          : undefined,
    };
  }
  if (op === "people_search_filters") {
    const raw = await fetch(
      graph("people", {
        start: 0,
        count: 1,
        origin: "GLOBAL_SEARCH_HEADER",
        query: {
          keywords: a.query,
          flagshipSearchIntent: "SEARCH_SRP",
          queryParameters: [{ key: "resultType", value: ["PEOPLE"] }],
          includeFiltersInResponse: true,
        },
      }),
    );
    const n = normalize(raw);
    const options: Args[] = [];
    const walk = (x: any, depth = 0) => {
      if (!x || typeof x !== "object" || depth > 15) return;
      if (
        typeof x.value === "string" &&
        /^\d+$/.test(x.value) &&
        (x.displayValue || x.label || x.text)
      )
        options.push({
          id: x.value,
          label: x.displayValue ?? x.label ?? x.text,
        });
      for (const v of Object.values(x)) walk(v, depth + 1);
    };
    walk(n);
    if (!options.length)
      throw new Fault(
        "filter_lookup_unavailable",
        "LinkedIn did not expose location/company filter values. Supply verified numeric filter IDs; do not guess them.",
      );
    return {
      options,
      connection_degrees: ["1", "2", "3"],
      partial: true,
      reason: "only_filters_exposed_by_linkedin_response",
    };
  }

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
  if (op === "conversations_list")
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
        countBefore: 50,
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
          queryParameters: [
            { key: "resultType", value: ["PEOPLE"] },
            ...(a.filters?.connection_degrees?.length
              ? [
                  {
                    key: "network",
                    value: a.filters.connection_degrees.map(
                      (d: string) => ({ "1": "F", "2": "S", "3": "O" })[d],
                    ),
                  },
                ]
              : []),
            ...(a.filters?.location_ids?.length
              ? [{ key: "geoUrn", value: a.filters.location_ids }]
              : []),
            ...(a.filters?.company_ids?.length
              ? [{ key: "currentCompany", value: a.filters.company_ids }]
              : []),
          ],
          includeFiltersInResponse: false,
        },
      }),
    );
  else if (op === "reactions_list")
    raw = await fetch(
      graph("reactions", {
        threadUrn: a.post_urn,
        count: a.limit,
        start: state.start ?? 0,
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
  if (op === "people_search") {
    const rows: Args[] = [];
    const walk = (x: any, depth = 0) => {
      if (!x || typeof x !== "object" || depth > 12) return;
      if (
        typeof x.navigationUrl === "string" &&
        /linkedin\.com\/in\//.test(x.navigationUrl) &&
        x.title?.text
      ) {
        rows.push(x);
        return;
      }
      for (const v of Object.values(x)) walk(v, depth + 1);
    };
    walk(c.items);
    const seen = new Set<string>(state.seen ?? []);
    const extracted = rows.map((x) => ({
      entityUrn: x.entityUrn?.match(/urn:li:fsd_profile:[\w-]+/)?.[0] ?? null,
      profile_url: x.navigationUrl.split("?")[0],
      name: x.title.text,
      headline: x.primarySubtitle?.text ?? null,
      location: x.secondarySubtitle?.text ?? null,
      connection_degree: x.badgeText?.text ?? null,
    }));
    const unique = extracted.filter((x) => {
      const key = x.entityUrn ?? x.profile_url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (c.items.length && !rows.length) throw new Fault("people_shape_changed");
    const more = rows.length >= a.limit;
    return {
      items: unique,
      partial: more,
      completeness: more ? "more_available" : "source_exhausted",
      next: more
        ? { start: (state.start ?? 0) + a.limit, seen: [...seen].slice(-5000) }
        : undefined,
      scanned: rows.length,
    };
  }

  let next: Args | undefined;
  if (op.startsWith("conversations_")) {
    if (c.metadata.nextCursor) next = { nextCursor: c.metadata.nextCursor };
  } else if (op === "messages_list") {
    const seen = new Set<string>(state.seen ?? []);
    const fresh = items.filter(
      (x) => typeof x.entityUrn === "string" && !seen.has(x.entityUrn),
    );
    const available = [...(state.buffered ?? []), ...fresh];
    items = available.slice(0, a.limit);
    fresh.forEach((x) => seen.add(x.entityUrn));
    const times = c.items
      .map((x) => x.deliveredAt)
      .filter((x) => typeof x === "number");
    const before = times.length ? Math.min(...times) + 1 : undefined;
    const more = c.items.length >= 50;
    const stalled =
      more && before !== undefined && before >= (state.before ?? Infinity);
    if (available.length > a.limit || (more && !stalled))
      next = {
        before,
        buffered: available.slice(a.limit),
        seen: [...seen].slice(-5000),
        exhausted: !more,
      };
    return {
      items,
      next,
      partial: !!next || stalled,
      completeness: stalled
        ? "timestamp_boundary_unresolved"
        : next
          ? "more_available"
          : "source_exhausted",
      scanned: c.items.length,
    };
  } else if (
    items.length >= a.limit &&
    (c.paging.total === undefined ||
      (state.start ?? 0) + items.length < c.paging.total)
  )
    next = { start: (state.start ?? 0) + items.length };
  if (op === "reactions_list") {
    const seen = new Set<string>(state.seen ?? []);
    items = items
      .map((x) => {
        const l = x.reactorLockup ?? {};
        const p = x.actor?.miniProfile ?? x.actor ?? {};
        return {
          id: x.entityUrn ?? x.actorUrn ?? l.navigationUrl,
          profile_urn: x.actorUrn ?? p.entityUrn ?? null,
          profile_url:
            l.navigationUrl ??
            (p.publicIdentifier
              ? "https://www.linkedin.com/in/" + p.publicIdentifier + "/"
              : null),
          name:
            l.title?.text ??
            l.title ??
            [p.firstName, p.lastName].filter(Boolean).join(" "),
          headline: l.subtitle?.text ?? l.subtitle ?? p.occupation ?? null,
          connection_degree: l.label?.text ?? l.label ?? null,
          reaction_type: x.reactionType ?? null,
          created_at: x.createdAt ?? null,
        };
      })
      .filter((x) => {
        if (!x.id || seen.has(x.id)) return false;
        seen.add(x.id);
        return true;
      });
    if (c.items.length && !items.length && !state.seen?.length)
      throw new Fault("reaction_shape_changed");
    if (next) next.seen = [...seen].slice(-5000);
  }
  if (a.unread_only)
    items = items.filter((x) => x.read === false || x.unreadCount > 0);
  return {
    items,
    next,
    scanned: c.items.length,
    partial: !!next,
    completeness: next ? "more_available" : "source_exhausted",
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
