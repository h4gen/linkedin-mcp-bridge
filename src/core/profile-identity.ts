import type { Args } from "./contracts.js";

export function profileUrn(value: unknown): string | null {
  return typeof value === "string" &&
    /^urn:li:(fsd_profile|fs_miniProfile):[\w-]+$/.test(value)
    ? value.replace("fs_miniProfile", "fsd_profile")
    : null;
}
export function publicIdentifier(
  value: unknown,
  memberId?: string | null,
  verified = false,
): string | null {
  if (typeof value !== "string") return null;
  try {
    const identifier = decodeURIComponent(value);
    if (!/^[\p{L}\p{M}\p{N}_-]{1,150}$/u.test(identifier)) return null;
    // Observed 39-character ACo member IDs are opaque; length alone is not evidence.
    if (
      !verified &&
      (identifier === memberId || /^ACo[A-Za-z0-9_-]{36}$/.test(identifier))
    )
      return null;
    return identifier;
  } catch {
    return null;
  }
}
export function profileReference(input: Args, verified = false) {
  const p = input && typeof input === "object" ? input : {};
  const member = p.participantType?.member ?? p.member ?? p;
  const urn = profileUrn(
    p.hostIdentityUrn ?? member.dashEntityUrn ?? member.entityUrn ?? p.urn,
  );
  const member_id = urn?.split(":").at(-1) ?? null;
  const candidates = [
    member.publicIdentifier,
    member.public_identifier,
    ...[member.profile_url, member.profileUrl, p.profile_url, p.profileUrl].map(
      (value) =>
        typeof value === "string"
          ? value.match(
              /^https:\/\/www\.linkedin\.com\/in\/([^/?#]+)\/?(?:[?#].*)?$/,
            )?.[1]
          : undefined,
    ),
  ];
  const identifier =
    candidates
      .map((value) => publicIdentifier(value, member_id, verified))
      .find(Boolean) ?? null;
  return {
    entityUrn: urn,
    member_id,
    public_identifier: identifier,
    profile_url: identifier
      ? `https://www.linkedin.com/in/${encodeURIComponent(identifier)}/`
      : null,
    identity_status: urn || identifier ? "resolved" : "unresolved",
  };
}

export type IdentitySource = "observed" | "profile_verified";
// All cache writers use this merge. Only a matched profile response may promote a slug.
export function mergeIdentity(
  previous: Args | undefined,
  incoming: Args,
  source: IdentitySource = "observed",
): Args {
  const next = profileReference(incoming, source === "profile_verified");
  const old = profileReference(
    previous ?? {},
    previous?.identity_source === "profile_verified",
  );
  const same = old.entityUrn === next.entityUrn;
  const keepVerified =
    same &&
    previous?.identity_source === "profile_verified" &&
    source !== "profile_verified";
  const useNext = !!next.public_identifier && !keepVerified;
  const identifier = useNext
    ? next.public_identifier
    : same
      ? old.public_identifier
      : null;
  const result: Args = {
    ...(same ? previous : {}),
    entityUrn: next.entityUrn,
    urn: next.entityUrn,
    member_id: next.member_id,
    name:
      typeof incoming.name === "string" && incoming.name.trim()
        ? incoming.name.trim()
        : same
          ? (previous?.name ?? "")
          : "",
    public_identifier: identifier,
    profile_url: identifier
      ? `https://www.linkedin.com/in/${encodeURIComponent(identifier)}/`
      : null,
    identity_source: useNext
      ? source
      : same
        ? (previous?.identity_source ?? "observed")
        : "observed",
  };
  if (useNext && next.public_identifier !== old.public_identifier)
    delete result.posts_url;
  // Only the verified profile adapter owns additional profile navigation hints.
  if (source === "profile_verified" && Object.hasOwn(incoming, "posts_url"))
    result.posts_url = incoming.posts_url;
  return result;
}
export async function rememberIdentity(
  store: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
  },
  incoming: Args,
  source: IdentitySource = "observed",
) {
  const urn = profileReference(
    incoming,
    source === "profile_verified",
  ).entityUrn;
  if (!urn) return;
  const key = "identity:" + urn;
  await store.set(key, mergeIdentity(await store.get(key), incoming, source));
}
