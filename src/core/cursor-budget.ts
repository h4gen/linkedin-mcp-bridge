import { Fault } from "./contracts.js";
export const CURSOR_BUDGET = 5 * 1024 * 1024;
export function cursorEvictions(
  all: Record<string, any>,
  key: string,
  value: unknown,
  budget = CURSOR_BUDGET,
): string[] {
  const size = (x: unknown) =>
    new TextEncoder().encode(JSON.stringify(x)).byteLength;
  const incoming = size({ [key]: value });
  if (incoming > budget) throw new Fault("cursor_page_too_large");
  const rows = Object.entries(all)
    .filter(([k]) => k.startsWith("cursor:") && k !== key)
    .map(([k, v]) => ({
      key: k,
      size: size({ [k]: v }),
      expires: v.expires ?? 0,
    }))
    .sort((a, b) => a.expires - b.expires);
  let total = incoming + rows.reduce((sum, row) => sum + row.size, 0);
  const evict: string[] = [];
  for (const row of rows) {
    if (total <= budget) break;
    evict.push(row.key);
    total -= row.size;
  }
  return evict;
}
