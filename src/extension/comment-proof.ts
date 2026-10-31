// The URL must be freshly obtained from the exact reply's native Copy link action.
// No guessed URL or position/indentation inference is accepted as parent evidence.
export function replyPermalink(url: string, parentId: string, replyId: string) {
  const parse = (id: string) =>
    id.match(
      /^(?:replaceableComment_)?urn:li:comment:\((activity|ugcPost|share):(\d+),(\d+)\)$/,
    );
  const parent = parse(parentId),
    reply = parse(replyId);
  if (
    !parent ||
    !reply ||
    parent[1] !== reply[1] ||
    parent[2] !== reply[2] ||
    parent[3] === reply[3]
  )
    return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const post = `urn:li:${parent[1]}:${parent[2]}`;
  return (
    target.origin === "https://www.linkedin.com" &&
    decodeURIComponent(target.pathname).replace(/\/$/, "") ===
      "/feed/update/" + post &&
    target.searchParams.get("dashCommentUrn") ===
      `urn:li:fsd_comment:(${parent[3]},${post})` &&
    target.searchParams.get("dashReplyUrn") ===
      `urn:li:fsd_comment:(${reply[3]},${post})`
  );
}

// Self-contained read-only injection, following the native reply permalink.
export function visibleCommentProof(
  id: string,
  text: string,
  profileUrl: string,
) {
  const rows = [
    ...document.querySelectorAll(
      '[componentkey^="replaceableComment_"],[data-comment-urn],.comments-comment-entity,.comments-comment-item',
    ),
  ].filter((e) =>
    ["componentkey", "data-id", "data-urn", "data-comment-urn", "id"].some(
      (k) => e.getAttribute(k) === id,
    ),
  );
  if (rows.length !== 1) return false;
  const row = rows[0];
  const body = row.querySelector(
    '.comments-comment-item__main-content,.comments-comment-entity__content,[data-testid="expandable-text-box"]',
  );
  return (
    body?.textContent?.trim() === text &&
    [...row.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]')].some(
      (link) =>
        link.href.split(/[?#]/)[0].replace(/\/$/, "") ===
        profileUrl.replace(/\/$/, ""),
    )
  );
}
