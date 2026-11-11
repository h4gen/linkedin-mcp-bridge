import { commentText } from "../core/comment-proof.js";
export const COMMENT_SELECTOR =
  '.comments-comment-item,.comments-comment-entity,[data-comment-urn],div[componentkey^="replaceableComment_"]';
export function commentId(e: Element | null): string | null {
  if (!e) return null;
  for (const attr of [
    "componentkey",
    "data-id",
    "data-urn",
    "data-comment-urn",
    "id",
  ]) {
    const value = e.getAttribute(attr);
    if (value && /urn:li:comment:/.test(value)) return value;
  }
  return null;
}
export function commentBody(e: Element): string | undefined {
  const bodies = [
    ...e.querySelectorAll(
      '.comments-comment-item__main-content,.comments-comment-entity__content,[data-testid="expandable-text-box"]',
    ),
  ].filter((x) => x.closest(COMMENT_SELECTOR) === e);
  if (bodies.length !== 1) return;
  const clone = bodies[0].cloneNode(true) as Element;
  // A collapsed body is not complete proof.
  if (
    [...clone.querySelectorAll('button,[role="button"]')].some((x) =>
      /more|mehr/i.test(x.textContent ?? ""),
    )
  )
    return;
  clone
    .querySelectorAll('button,[role="button"],[aria-hidden="true"]')
    .forEach((x) => x.remove());
  for (const link of clone.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let url: URL;
    try {
      url = new URL(link.getAttribute("href")!, location.href);
    } catch {
      return;
    }
    if (
      url.origin === "https://www.linkedin.com" &&
      url.pathname === "/safety/go/"
    ) {
      try {
        url = new URL(url.searchParams.get("url") ?? "");
      } catch {
        return;
      }
    }
    // Preserve ordinary mention labels; reconstruct visibly shortened URL links
    // only from an observed native destination, never from the desired payload.
    if (
      /^(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,}(?:[\/\s…]|$))/i.test(
        link.textContent?.trim() ?? "",
      ) ||
      /…|\.\.\./.test(link.textContent ?? "")
    )
      link.replaceWith(url.href);
  }
  clone.querySelectorAll("br").forEach((x) => x.replaceWith(" "));
  clone.querySelectorAll("p,div,li").forEach((x) => x.append(" "));
  return commentText(clone.textContent ?? "");
}
export function commentActor(e: Element, profileUrl: string): boolean {
  const clean = (value: string) => {
    try {
      const u = new URL(value, location.href);
      return u.origin === "https://www.linkedin.com" &&
        /^\/(?:in|company)\/[^/]+\/?$/.test(u.pathname)
        ? u.origin + u.pathname.replace(/\/$/, "")
        : null;
    } catch {
      return null;
    }
  };
  const expected = clean(profileUrl);
  return (
    !!expected &&
    [
      ...e.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/in/"],a[href*="/company/"]',
      ),
    ]
      .filter(
        (link) =>
          link.closest(COMMENT_SELECTOR) === e &&
          !link.closest(
            '.comments-comment-item__main-content,.comments-comment-entity__content,[data-testid="expandable-text-box"]',
          ),
      )
      .some((link) => clean(link.href) === expected)
  );
}

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
    body?.textContent?.replace(/\s+/gu, " ").trim() ===
      text.replace(/\s+/gu, " ").trim() &&
    [
      ...row.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/in/"],a[href*="/company/"]',
      ),
    ].some(
      (link) =>
        link.closest(
          '[componentkey^="replaceableComment_"],[data-comment-urn],.comments-comment-entity,.comments-comment-item',
        ) === row &&
        !link.closest(
          '.comments-comment-item__main-content,.comments-comment-entity__content,[data-testid="expandable-text-box"]',
        ) &&
        link.href.split(/[?#]/)[0].replace(/\/$/, "") ===
          profileUrl.replace(/\/$/, ""),
    )
  );
}
