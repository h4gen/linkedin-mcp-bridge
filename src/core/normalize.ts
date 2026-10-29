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
    if (Array.isArray(x))
      return x.slice(0, 100).map((v) => resolve(v, depth + 1, seen));
    if (!x || typeof x !== "object") return x;
    const out: Obj = {};
    for (const [k, v] of Object.entries(x)) {
      if (/tracking|token|cookie|csrf|authorization/i.test(k)) continue;
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
export function collection(raw: Obj): {
  items: Obj[];
  metadata: Obj;
  paging: Obj;
} {
  const n = normalize(raw);
  const walk = (x: any, depth = 0): any => {
    if (!x || typeof x !== "object" || depth > 8) return;
    if (Array.isArray(x.elements))
      return {
        items: x.elements,
        metadata: x.metadata ?? {},
        paging: x.paging ?? {},
      };
    for (const v of Object.values(x)) {
      const r = walk(v, depth + 1);
      if (r) return r;
    }
  };
  const result = walk(n.data);
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
