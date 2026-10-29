import { Fault } from "./contracts.js";
type Obj = Record<string, any>;
export function normalize(raw: Obj) {
  const index = new Map<string, Obj>(
    (raw.included ?? [])
      .filter((x: Obj) => x.entityUrn)
      .map((x: Obj) => [x.entityUrn, x]),
  );
  const resolve = (x: any, depth = 0, seen = new Set<string>()): any => {
    if (depth > 14) return undefined;
    if (Array.isArray(x)) return x.map((v) => resolve(v, depth + 1, seen));
    if (!x || typeof x !== "object") return x;
    const out: Obj = {};
    for (const [k, v] of Object.entries(x)) {
      if (
        /secret|anti_abuse|^tracking|^(originToken|accessToken|refreshToken|csrfToken|token|cookie|csrf|authorization)$/i.test(
          k,
        )
      )
        continue;
      if (k.startsWith("*")) {
        const ref = (u: any) =>
          typeof u === "string" && index.has(u) && !seen.has(u)
            ? resolve(index.get(u), depth + 1, new Set([...seen, u]))
            : u;
        out[k.slice(1)] = Array.isArray(v) ? v.map(ref) : ref(v);
      } else out[k] = resolve(v, depth + 1, seen);
    }
    return out;
  };
  return {
    data: resolve(raw.data ?? raw),
    entities: [...index.values()].map((x) => resolve(x)),
  };
}
export function collection(
  raw: Obj,
  operation?: string,
): {
  items: Obj[];
  metadata: Obj;
  paging: Obj;
} {
  const n = normalize(raw);
  const paths: Record<string, string[]> = {
    conversations_list: [
      "messengerConversationsBySyncToken",
      "messengerConversations",
    ],
    messages_list: ["messengerMessagesBySyncToken", "messengerMessages"],
    people_search: ["searchDashClustersByAll", "searchDashClusters"],
    invitations_list: [],
  };
  const candidates: any[] = [];
  const visit = (x: any, depth = 0) => {
    if (!x || typeof x !== "object" || Array.isArray(x) || depth > 8) return;
    if (Array.isArray(x.elements)) {
      candidates.push(x);
      return;
    }
    for (const [key, value] of Object.entries(x)) {
      if (
        operation &&
        depth === 0 &&
        key !== "data" &&
        !(paths[operation] ?? []).some((name) => key.endsWith(name))
      )
        continue;
      visit(value, depth + 1);
    }
  };
  visit(n.data);
  if (candidates.length > 1) throw new Fault("ambiguous_collection");
  const node = candidates[0];
  const result = node
    ? {
        items: node.elements,
        metadata: node.metadata ?? {},
        paging: node.paging ?? {},
      }
    : undefined;
  if (!result)
    throw new Fault(
      "response_shape_changed",
      "LinkedIn returned no recognized collection; this is not an empty result.",
    );
  if (result.items.some((x: any) => typeof x !== "object" || x === null))
    throw new Fault("unresolved_entity");
  return result;
}
export function self(raw: Obj): string {
  const ref = raw.data?.["*miniProfile"] ?? raw.data?.miniProfile?.entityUrn;
  const p =
    (raw.included ?? []).find((x: Obj) => x.entityUrn === ref) ??
    raw.data?.miniProfile;
  const urn = p?.dashEntityUrn ?? p?.entityUrn;
  if (
    typeof urn !== "string" ||
    !/^urn:li:(fs_miniProfile|fsd_profile):[\w-]+$/.test(urn)
  )
    throw new Fault("account_unresolved");
  return urn.replace("fs_miniProfile", "fsd_profile");
}
export function restli(v: any): string {
  if (Array.isArray(v)) return `List(${v.map(restli).join(",")})`;
  if (v !== null && typeof v === "object")
    return `(${Object.entries(v)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}:${restli(v)}`)
      .join(",")})`;
  return encodeURIComponent(String(v)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
