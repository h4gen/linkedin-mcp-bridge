// One owner for source-backed post identity, shared by reads and write targets.
export const POST_TEXT =
  '.feed-shared-update-v2__commentary,.feed-shared-inline-show-more-text__text-view,.feed-shared-update-v2__description,.update-components-text,[data-test-id="main-feed-post-content"],[data-testid="expandable-text-box"]';
const COMMENTS =
  '[componentkey^="replaceableComment_"],.comments-comment-entity,.comments-comment-item';
const MENU = 'button[aria-label^="Open control menu for post by "]';
const ROOTS =
  '[data-mcp-post-urn],[data-urn^="urn:li:activity:"],[data-urn^="urn:li:share:"],[data-urn^="urn:li:ugcPost:"],[data-id^="urn:li:"],.feed-shared-update-v2,[role="listitem"]:has(button[aria-label^="Open control menu for post by "]),[role="listitem"]:has(button[aria-label="Comment"]):has(button[aria-label="Repost"]),[role="listitem"]:has(a[href*="/feed/update/"])';
export function postUrlIdentity(value: string): string | null {
  if (
    !/^(?:https:\/\/www\.linkedin\.com)?\/(?:feed\/update\/|posts\/)/.test(
      value,
    )
  )
    return null;
  try {
    const url = new URL(value, location.href);
    if (url.origin !== "https://www.linkedin.com") return null;
    const path = decodeURIComponent(url.pathname);
    const direct = path.match(
      /^\/feed\/update\/(urn:li:(?:activity|share|ugcPost):\d+)\/?$/,
    );
    if (direct) return direct[1];
    const native = path.match(
      /^\/posts\/[^/]+-(activity|share|ugcPost)-(\d+)-[^/]+\/?$/,
    );
    return native ? `urn:li:${native[1]}:${native[2]}` : null;
  } catch {
    return null;
  }
}
export function postIdentities(root: Element): string[] {
  const found = new Set<string>();
  const nodes = [
    root,
    ...root.querySelectorAll(
      '[data-mcp-post-urn],[data-urn],[data-id],[data-entity-urn],[data-reaction-urn],[id*="ContentUrn"],[componentkey*="ContentUrn"],[componentkey*="userGeneratedContent"],[componentkey*="ugcPostId="],[componentkey*="shareId="],a[href]',
    ),
  ];
  for (const node of nodes) {
    if (node.closest(POST_TEXT + "," + COMMENTS)) continue;
    // A separately authored embedded card owns its own identity.
    const nested = node.closest('[role="listitem"],.feed-shared-update-v2');
    if (
      nested &&
      nested !== root &&
      root.contains(nested) &&
      nested.querySelector(MENU) &&
      root.querySelector(MENU) !== nested.querySelector(MENU)
    )
      continue;
    for (const attr of [
      "data-mcp-post-urn",
      "data-urn",
      "data-id",
      "data-entity-urn",
      "data-reaction-urn",
      "id",
      "componentkey",
      "href",
    ]) {
      let value = node.getAttribute(attr) ?? "";
      if (attr === "href") {
        const urn = postUrlIdentity(value);
        if (urn) found.add(urn);
        continue;
      }
      try {
        value = decodeURIComponent(value);
      } catch {
        continue;
      }
      const direct = value.match(/urn:li:(?:activity|share|ugcPost):\d+/)?.[0];
      if (direct) {
        found.add(direct);
        continue;
      }
      const activity = value.match(/activity[-:](\d+)/)?.[1];
      const ugc = value.match(
        /(?:userGeneratedContent(?:Post)?Id|ugcPostId)=(\d+)/,
      )?.[1];
      const share = value.match(/shareId=(\d+)/)?.[1];
      if (activity) found.add("urn:li:activity:" + activity);
      else if (ugc) found.add("urn:li:ugcPost:" + ugc);
      else if (share) found.add("urn:li:share:" + share);
    }
  }
  return [...found];
}
export const postIdentity = (root: Element) => postIdentities(root)[0] ?? null;
export function postRoots(scope: ParentNode = document): Element[] {
  const nodes = [...scope.querySelectorAll(ROOTS)].filter(
    (e) => !e.closest(POST_TEXT + "," + COMMENTS),
  );
  // A wrapper around independently authored cards is not itself a target card.
  const cards = nodes.filter((e) => e.querySelectorAll(MENU).length <= 1);
  return cards.filter(
    (e) => !cards.some((other) => other !== e && other.contains(e)),
  );
}
export function postContext(urn: string) {
  const candidates = postRoots();
  const matches = candidates.filter((e) => postIdentities(e).includes(urn));
  if (matches.length !== 1) {
    const error = new Error(
      matches.length > 1
        ? "post_target_ambiguous"
        : document.readyState === "loading" ||
            document.querySelector('main[aria-busy="true"]')
          ? "post_target_loading"
          : "post_target_not_found",
    );
    Object.assign(error, {
      details: {
        candidate_count: candidates.length,
        matching_count: matches.length,
      },
    });
    throw error;
  }
  const root = matches[0] as HTMLElement;
  const container = root.closest<HTMLElement>(
    '[componentkey*="pagedCommentsContainer"]',
  );
  const commentsRoot =
    container && postRoots(container).length === 1 ? container : root;
  const identities = postIdentities(root);
  const routeIdentity = postUrlIdentity(location.href);
  const onPermalink = !!routeIdentity && identities.includes(routeIdentity);
  return { root, commentsRoot, identities, onPermalink };
}
export async function waitForPost(urn: string) {
  for (let n = 0; n < 8; n++) {
    try {
      return postContext(urn);
    } catch (error) {
      if ((error as Error).message === "post_target_ambiguous" || n === 7)
        throw error;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw Error("post_target_loading");
}
