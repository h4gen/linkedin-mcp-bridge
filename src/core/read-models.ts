import { profileReference } from "./profile-identity.js";
import { Fault, type Args } from "./contracts.js";
export const asText = (v: any): string =>
  typeof v === "string" ? v : typeof v?.text === "string" ? v.text : "";
export function excerpt(value: string, maximum: number) {
  const chars = Array.from(value);
  return {
    text: chars.slice(0, maximum).join(""),
    text_truncated: chars.length > maximum,
    total_chars: chars.length,
  };
}
export async function textWindow(
  text: string,
  args: Args,
  hash: (s: string) => Promise<string>,
) {
  const revision = await hash(text);
  if (args.text_revision && args.text_revision !== revision)
    throw new Fault("text_revision_changed");
  const chars = Array.from(text),
    offset = args.text_offset ?? 0,
    size = args.max_chars ?? 4000;
  if (offset > 0 && !args.text_revision)
    throw new Fault("text_revision_required");
  if (offset > chars.length) throw new Fault("text_offset_out_of_range");
  const end = Math.min(chars.length, offset + size);
  return {
    text: chars.slice(offset, end).join(""),
    text_revision: revision,
    text_offset: offset,
    total_chars: chars.length,
    next_text_offset: end < chars.length ? end : null,
    text_complete: end === chars.length,
    text_truncated: end < chars.length,
  };
}
export function personRef(p: Args): Args {
  p = p && typeof p === "object" ? p : {};
  const member = p.participantType?.member ?? p.member ?? p;
  const ref = profileReference(p);
  return {
    entityUrn: ref.entityUrn,
    name:
      asText(member.name).trim() ||
      [member.firstName, member.lastName]
        .map((value) => asText(value).trim())
        .filter(Boolean)
        .join(" "),
    public_identifier: ref.public_identifier,
    profile_url: ref.profile_url,
    identity_status: ref.identity_status,
  };
}
export function participantRefs(row: Args): Args[] {
  const source = row.conversationParticipants ?? row.participants ?? [];
  return (Array.isArray(source) ? source : (source.elements ?? [])).map(
    personRef,
  );
}
export function exactPeer(row: Args, own: string, peer: string) {
  const others = participantRefs(row).filter((p) => p.entityUrn !== own);
  return others.length === 1 && others[0].entityUrn === peer;
}
export function messageText(row: Args) {
  return asText(row.body?.text ?? row.body ?? row.text);
}
export function messageView(row: Args): Args {
  const sender = row.sender ?? row.from ?? {};
  return {
    entityUrn: row.entityUrn,
    deliveredAt: typeof row.deliveredAt === "number" ? row.deliveredAt : null,
    sender: personRef(sender),
    ...excerpt(messageText(row), 1000),
    attachments: (Array.isArray(row.attachments) ? row.attachments : []).map(
      (a: Args) => ({
        name: asText(a.name ?? a.fileName) || null,
        media_type: a.mediaType ?? a.mimeType ?? null,
        size_bytes: typeof a.size === "number" ? a.size : null,
      }),
    ),
    timestamp_status: typeof row.deliveredAt === "number" ? "known" : "unknown",
  };
}
export function conversationView(row: Args, category?: string): Args {
  const preview = asText(
    row.preview ??
      row.lastMessage?.body?.text ??
      row.messages?.elements?.[0]?.body?.text,
  );
  return {
    entityUrn: row.entityUrn,
    title: asText(row.title) || null,
    participants: participantRefs(row),
    last_activity_at:
      row.lastActivityAt ??
      row.lastUpdatedAt ??
      row.lastMessage?.deliveredAt ??
      null,
    preview: excerpt(preview, 280),
    read:
      typeof row.read === "boolean"
        ? row.read
        : typeof row.unreadCount === "number"
          ? row.unreadCount === 0
          : null,
    category: category ?? row.category ?? null,
  };
}
export function newestFirst(rows: Args[]) {
  return [...rows].sort(
    (a, b) =>
      (typeof b.deliveredAt === "number" ? b.deliveredAt : -Infinity) -
        (typeof a.deliveredAt === "number" ? a.deliveredAt : -Infinity) ||
      String(a.entityUrn).localeCompare(String(b.entityUrn)),
  );
}

export function postView(row: Args): Args {
  const identifier =
    typeof row.author_profile_url === "string"
      ? (row.author_profile_url.match(
          /^https:\/\/www\.linkedin\.com\/in\/([^/?#]+)/,
        )?.[1] ?? null)
      : null;
  const author = personRef({
    name: asText(row.author),
    publicIdentifier: identifier,
  });
  return {
    entityUrn: row.entityUrn ?? null,
    scan_key: row.scan_key ?? null,
    ...excerpt(asText(row.text), 1000),
    source_text_truncated: !!row.text_truncated,
    source: row.source ?? "linkedin_dom",
    full_text: row.entityUrn
      ? { operation: "post_get", post_urn: row.entityUrn }
      : { operation: "post_resolve", scan_key: row.scan_key ?? null },
    author: asText(row.author),
    author_identity: author,
    published_at: row.published_at ?? null,
    visible_time: row.visible_time ?? null,
    date_precision: row.published_at
      ? "timestamp"
      : row.visible_time
        ? "relative"
        : "unknown",
    post_kind: row.post_kind ?? "unknown",
    original_author: row.post_kind === "repost" ? author : null,
    url: row.url ?? null,
    identity_status: row.entityUrn ? "resolved" : "unresolved",
  };
}
