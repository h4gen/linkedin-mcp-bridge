// Normalize only presentation whitespace, never punctuation, case or URL targets.
export const commentText = (text: string) => text.replace(/\s+/gu, " ").trim();
export async function commentHash(text: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(commentText(text)),
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
// Observed native compound comment IDs encode Unix milliseconds in their high
// bits (source contract in docs/comment-receipts.md). Unsupported IDs fail closed.
export function commentCreatedAt(id: string): number | undefined {
  const match =
    /^(?:replaceableComment_)?urn:li:comment:\(activity:\d+,(\d{18,20})\)$/.exec(
      id,
    );
  if (!match) return;
  const ms = Number(BigInt(match[1]) >> 22n);
  return Number.isSafeInteger(ms) && ms >= 1577836800000 ? ms : undefined;
}
export function freshComment(
  id: string,
  proof: { before_ids: string[]; observed_at: number },
  now: number,
): boolean {
  const canonical = (value: string) =>
    value.replace(/^replaceableComment_/, "");
  const created = commentCreatedAt(id);
  return (
    !proof.before_ids.some((x) => canonical(x) === canonical(id)) &&
    created !== undefined &&
    created >= proof.observed_at &&
    created <= proof.observed_at + 120000 &&
    created <= now
  );
}
