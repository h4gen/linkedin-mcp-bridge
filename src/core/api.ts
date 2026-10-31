import { newestFirst, exactPeer } from "./read-models.js";
import { Args, Fault, Operation } from "./contracts.js";
import { collection, normalize, restli } from "./normalize.js";
export type Request = {
  surface?: "guest_typeahead";
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
  if (op === "message_get") {
    let cursor: Args = state.before ? { before: state.before } : {};
    for (let n = 0; n < 3; n++) {
      const page = await readApi(
        "messages_list",
        { ...a, limit: 50 },
        cursor,
        fetch,
      );
      const row = page.items.find((m: Args) => m.entityUrn === a.message_urn);
      if (row) return { message: row, conversation_urn: a.conversation_urn };
      if (!page.next)
        throw new Fault(
          page.partial ? "message_lookup_incomplete" : "message_not_found",
        );
      cursor = page.next;
    }
    throw new Fault("message_lookup_incomplete");
  }
  if (op === "conversations_find") {
    let index = state.category_index ?? 0;
    let source = state.source ?? {};
    const seen = new Set<string>(state.seen ?? []);
    const buffered = [...(state.buffered ?? [])];
    let scanned = 0;
    const checked = new Set<string>();
    for (
      let n = 0;
      n < 3 && index < a.categories.length && buffered.length < a.limit;
      n++
    ) {
      const category = a.categories[index];
      checked.add(category);
      const page = await readApi(
        "conversations_list",
        { account_urn: a.account_urn, category, limit: 20 },
        source,
        fetch,
      );
      scanned += page.scanned;
      for (const row of page.items)
        if (
          !seen.has(row.entityUrn) &&
          exactPeer(row, a.account_urn, a.profile_urn)
        ) {
          seen.add(row.entityUrn);
          buffered.push({ ...row, category });
        }
      if (!page.next) {
        index++;
        source = {};
      } else {
        if (page.next.nextCursor === source.nextCursor)
          throw new Fault("pagination_stalled");
        source = page.next;
      }
    }
    const remaining = buffered.slice(a.limit),
      more = index < a.categories.length || remaining.length > 0;
    return {
      items: buffered.slice(0, a.limit),
      scanned,
      checked_categories: [...checked],
      partial: more,
      completeness: more ? "more_available" : "source_exhausted",
      next: more
        ? {
            category_index: index,
            source,
            seen: [...seen],
            buffered: remaining,
          }
        : undefined,
    };
  }

  if (op === "messages_list" && (state.exhausted || state.buffered?.length)) {
    const items = (state.buffered ?? []).slice(0, a.limit);
    const remaining = (state.buffered ?? []).slice(a.limit);
    return {
      items,
      partial: remaining.length > 0 || !state.exhausted || !!state.blocked,
      next:
        remaining.length || (!state.exhausted && !state.blocked)
          ? { ...state, buffered: remaining }
          : undefined,
      completeness: state.blocked
        ? "timestamp_boundary_unresolved"
        : remaining.length || !state.exhausted
          ? "more_available"
          : "source_exhausted",
    };
  }
  if (op === "conversations_search") {
    const items: Args[] = [];
    let next = state;
    let scanned = 0;
    let more = !state.exhausted && !!state.nextCursor;
    const seen = new Set<string>(state.seen ?? []);
    for (
      let i = 0;
      i < a.scan_pages &&
      !state.exhausted &&
      (state.buffered?.length ?? 0) + items.length < a.limit;
      i++
    ) {
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
          conversationSearchText(item)
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
      partial: more || buffered.length > a.limit,
      completeness:
        more || buffered.length > a.limit
          ? "more_available"
          : "source_exhausted",
      search_scope: "participants_title_preview_not_full_message_history",
      next:
        more || buffered.length > a.limit
          ? {
              ...next,
              exhausted: !more,
              buffered: buffered.slice(a.limit),
              seen: [...seen],
            }
          : undefined,
    };
  }
  if (op === "people_search_filters") {
    const kind = a.kind === "company" ? "COMPANY" : "GEO";
    const results = await fetch({
      surface: "guest_typeahead",
      path:
        "/jobs-guest/api/typeaheadHits?" +
        new URLSearchParams({ typeaheadType: kind, query: a.query }),
    });
    if (
      !Array.isArray(results) ||
      results.some(
        (x) =>
          typeof x?.id !== "string" ||
          !/^\d+$/.test(x.id) ||
          typeof x.displayName !== "string",
      )
    )
      throw new Fault("filter_lookup_shape_changed");
    return {
      options: results
        .slice(0, 10)
        .map((x) => ({ id: x.id, label: x.displayName, kind: a.kind })),
      partial: results.length >= 10,
      source: "linkedin_public_typeahead",
    };
  }
  if (op === "conversations_get")
    return { conversation: await getConversation(a, fetch) };
  if (op === "profile_get") {
    let identifier: string | undefined;
    try {
      identifier = a.public_identifier
        ? decodeURIComponent(a.public_identifier)
        : undefined;
      if (identifier && !/^[\p{L}\p{M}\p{N}_-]{1,150}$/u.test(identifier))
        throw new Fault("invalid_profile_identifier");
    } catch {
      throw new Fault("invalid_profile_identifier");
    }
    const rawProfile = await fetch({
      path:
        "/identity/dash/profiles?" +
        new URLSearchParams({
          q: "memberIdentity",
          memberIdentity: identifier ?? a.profile_urn?.split(":").at(-1),
          decorationId:
            "com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19",
        }),
    });
    const normalized = normalize(rawProfile);
    const matchesProfile = (x: Args) =>
      identifier
        ? x.publicIdentifier === identifier
        : x.entityUrn?.replace("fs_miniProfile", "fsd_profile") ===
          a.profile_urn;
    const matches = normalized.entities.filter(matchesProfile);
    const candidates = matches.length
      ? matches
      : collection(rawProfile).items.filter(matchesProfile);
    if (candidates.length !== 1) throw new Fault("profile_not_unique");
    const p = candidates[0];
    return {
      profile: {
        entityUrn: p.entityUrn ?? null,
        name: [p.firstName, p.lastName].filter(Boolean).join(" "),
        headline: p.headline ?? p.occupation ?? null,
        profile_url:
          "https://www.linkedin.com/in/" +
          encodeURIComponent(p.publicIdentifier) +
          "/",
        public_identifier: p.publicIdentifier,
        location:
          p.geoLocation?.geo?.defaultLocalizedName ?? p.locationName ?? null,
      },
    };
  }
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
  const c = collection(raw, op);
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
    const sourceStart = c.paging.start ?? state.start ?? 0;
    const sourceCount = c.paging.count ?? a.limit;
    const total = c.paging.total;
    const nextStart = sourceStart + sourceCount;
    const more =
      typeof total === "number" ? nextStart < total : c.items.length > 0;
    if (more && (sourceCount <= 0 || nextStart <= (state.start ?? -1)))
      throw new Fault("pagination_stalled");
    return {
      items: unique,
      partial: more,
      completeness: more ? "more_available" : "source_exhausted",
      next: more ? { start: nextStart, seen: [...seen] } : undefined,
      scanned: rows.length,
    };
  }

  let next: Args | undefined;
  if (op.startsWith("conversations_")) {
    if (c.metadata.nextCursor) next = { nextCursor: c.metadata.nextCursor };
  } else if (op === "messages_list") {
    const seen = new Set<string>(state.seen ?? []);
    const fresh = items.filter((x) => {
      if (typeof x.entityUrn !== "string" || seen.has(x.entityUrn))
        return false;
      seen.add(x.entityUrn);
      return true;
    });
    const available = newestFirst([...(state.buffered ?? []), ...fresh]);
    items = available.slice(0, a.limit);
    fresh.forEach((x) => seen.add(x.entityUrn));
    const times = c.items
      .map((x) => x.deliveredAt)
      .filter((x) => typeof x === "number");
    const before = times.length ? Math.min(...times) + 1 : undefined;
    const missingTime = c.items.some((x) => typeof x.deliveredAt !== "number");
    const more = c.items.length >= 50;
    const stalled =
      missingTime ||
      (more && (before === undefined || before >= (state.before ?? Infinity)));
    if (available.length > a.limit || (more && !stalled))
      next = {
        before,
        buffered: available.slice(a.limit),
        seen: [...seen],
        exhausted: !more,
        blocked: stalled,
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
      c.paging.total < (state.start ?? 0) + items.length ||
      (state.start ?? 0) + items.length < c.paging.total)
  )
    next = { start: (state.start ?? 0) + items.length };
  if (op === "invitations_list")
    items = items.map((x) => {
      const invitation = x.invitation ?? x;
      const member =
        a.direction === "sent"
          ? (invitation.toMember ?? invitation.invitee?.miniProfile)
          : invitation.fromMember;
      if (!invitation.entityUrn || !member)
        throw new Fault("invitation_shape_changed");
      return {
        entityUrn: invitation.entityUrn,
        direction: a.direction,
        sent_at: invitation.sentTime ?? null,
        message:
          typeof invitation.message === "string" ? invitation.message : null,
        profile: {
          entityUrn: member.dashEntityUrn ?? member.entityUrn ?? null,
          name: [member.firstName, member.lastName].filter(Boolean).join(" "),
          headline: member.occupation ?? null,
          profile_url: member.publicIdentifier
            ? "https://www.linkedin.com/in/" + member.publicIdentifier + "/"
            : null,
        },
      };
    });
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
export function receipt(raw: any, operation?: Operation): string | undefined {
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
      ) {
        const expected =
          operation === "message_send"
            ? /^urn:li:msg_message:/
            : operation === "invitation_send"
              ? /^urn:li:(fsd_invitation|fs_invitation):/
              : operation
                ? /$^/
                : /^urn:li:/;
        if (expected.test(v)) found ??= v;
      } else scan(v, depth + 1);
    }
  };
  scan(values);
  return found;
}

// Deliberately select user-visible fields, never arbitrary serialized identifiers.
export function conversationSearchText(item: Args): string {
  const visibleText = (value: unknown): string =>
    typeof value === "string"
      ? value
      : value &&
          typeof value === "object" &&
          "text" in value &&
          typeof value.text === "string"
        ? value.text
        : "";
  const participants = item.conversationParticipants ?? item.participants ?? [];
  const names = (
    Array.isArray(participants) ? participants : (participants.elements ?? [])
  ).map((p: Args) => {
    const m = p.participantType?.member ?? p.member ?? p;
    return [m.firstName, m.lastName, m.name].map(visibleText).join(" ");
  });
  const previews = [
    item.preview,
    item.lastMessage?.body?.text,
    ...(item.messages?.elements ?? []).map((m: Args) => m.body?.text),
  ];
  return [item.title, ...names, ...previews].map(visibleText).join("\n");
}

export async function getConversation(
  a: Args,
  fetch: Fetcher,
  check = () => {},
  options: { mailboxOnly?: boolean; fields?: string[] } = {},
): Promise<Args> {
  check();
  if (!options.mailboxOnly) {
    const raw = await fetch(
      graph("messages", {
        deliveredAt: Date.now(),
        conversationUrn: a.conversation_urn,
        countBefore: 1,
        countAfter: 0,
      }),
    );
    const direct = normalize(raw).entities.find(
      (x: Args) =>
        x.entityUrn === a.conversation_urn &&
        (x.conversationParticipants || x.participants) &&
        (options.fields ?? []).every((key) => key in x),
    );
    if (direct) return direct;
  }
  for (const category of ["INBOX", "ARCHIVE", "SPAM"]) {
    let state: Args = {};
    const visited = new Set<string>();
    for (;;) {
      check();
      const page = await readApi(
        "conversations_list",
        { account_urn: a.account_urn, category, limit: 20 },
        state,
        fetch,
      );
      const found = page.items.find(
        (x: Args) => x.entityUrn === a.conversation_urn,
      );
      if (found) return found;
      if (!page.next) break;
      const key = JSON.stringify(page.next);
      if (visited.has(key)) throw new Fault("pagination_stalled");
      visited.add(key);
      state = page.next;
    }
  }
  throw new Fault("conversation_not_verified");
}

export async function reconcileMessage(
  row: Args,
  fetch: Fetcher,
  check: () => void,
): Promise<Args | undefined> {
  async function* candidates(): AsyncGenerator<string> {
    if (
      row.conversation_urn ||
      row.target?.startsWith("urn:li:msg_conversation:")
    ) {
      yield row.conversation_urn ?? row.target;
      return;
    }
    if (!row.target?.startsWith("urn:li:fsd_profile:")) return;
    for (const category of ["INBOX", "ARCHIVE", "SPAM"]) {
      let state: Args = {};
      const visited = new Set<string>();
      for (;;) {
        check();
        const page = await readApi(
          "conversations_list",
          { account_urn: row.account_urn, category, limit: 20 },
          state,
          fetch,
        );
        for (const thread of page.items) {
          if (exactPeer(thread, row.account_urn, row.target))
            yield thread.entityUrn;
        }
        if (!page.next) break;
        const key = JSON.stringify(page.next);
        if (visited.has(key)) throw new Fault("pagination_stalled");
        visited.add(key);
        state = page.next;
      }
    }
  }
  const checked = new Set<string>();
  for await (const conversation of candidates()) {
    if (checked.has(conversation)) continue;
    checked.add(conversation);
    let before = Date.now();
    for (;;) {
      check();
      const raw = await fetch(
        graph("messages", {
          deliveredAt: before,
          conversationUrn: conversation,
          countBefore: 50,
          countAfter: 0,
        }),
      );
      const match = (raw.included ?? []).find(
        (x: Args) =>
          x.originToken === row.origin_token &&
          /^urn:li:msg_message:/.test(x.entityUrn ?? ""),
      );
      if (match)
        return { receipt_id: match.entityUrn, conversation_urn: conversation };
      const page = collection(raw, "messages_list");
      const times = page.items
        .map((x) => x.deliveredAt)
        .filter((x) => typeof x === "number");
      const next = times.length ? Math.min(...times) + 1 : undefined;
      if (page.items.length < 50 || !next || next < row.created_at - 60000)
        break;
      if (next >= before) throw new Fault("timestamp_boundary_unresolved");
      before = next;
    }
  }
  return undefined; // Absence is never evidence that dispatch failed.
}

export async function findInvitation(
  a: Args,
  direction: "received" | "sent",
  fetch: Fetcher,
  check: () => void,
): Promise<Args | undefined> {
  let state: Args = {};
  const visited = new Set<string>();
  for (;;) {
    check();
    const page = await readApi(
      "invitations_list",
      { account_urn: a.account_urn, direction, limit: 20 },
      state,
      fetch,
    );
    const found = page.items.find(
      (x: Args) => x.entityUrn === a.invitation_urn,
    );
    if (found) return found;
    if (!page.next) return undefined;
    const key = JSON.stringify(page.next);
    if (visited.has(key)) throw new Fault("pagination_stalled");
    visited.add(key);
    state = page.next;
  }
}

// Bounded mailbox proof, resumable across receipt reads after a deletion.
// Absence is confirmed only after all categories are exhausted.
export async function reconcileDeletion(
  row: Args,
  fetch: Fetcher,
  check: () => void,
): Promise<boolean> {
  const categories = ["INBOX", "ARCHIVE", "SPAM"];
  const scan = row.deletion_scan ?? { category: 0, state: {}, visited: [] };
  for (
    let pageIndex = 0;
    pageIndex < 8 && scan.category < categories.length;
    pageIndex++
  ) {
    check();
    const page = await readApi(
      "conversations_list",
      {
        account_urn: row.account_urn,
        category: categories[scan.category],
        limit: 20,
      },
      scan.state,
      fetch,
    );
    if (page.items.some((x: Args) => x.entityUrn === row.target)) {
      delete row.deletion_scan;
      row.reconciliation = "conversation_still_present";
      return false;
    }
    if (page.next) {
      const key = JSON.stringify(page.next);
      if (scan.visited.includes(key)) throw new Fault("pagination_stalled");
      scan.visited.push(key);
      scan.state = page.next;
    } else {
      scan.category++;
      scan.state = {};
      scan.visited = [];
    }
  }
  row.deletion_scan = scan;
  row.reconciliation =
    scan.category === categories.length
      ? "absent_from_all_mailboxes"
      : "mailbox_scan_in_progress";
  return scan.category === categories.length;
}
