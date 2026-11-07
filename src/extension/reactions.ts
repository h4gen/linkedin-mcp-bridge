import { postUrlIdentity } from "./post-context.js";
import { pageFetch } from "./page-fetch.js";
import { asText } from "../core/read-models.js";
import { restli } from "../core/normalize.js";
import type { Args } from "../core/contracts.js";

const activityPattern = /^urn:li:activity:\d+$/;
const queryId = "voyagerSocialDashReactions.759f60600a6108d4110bc8b8f6ecd507";

// Public permalink HTML labels both identities on the same card. A share
// and its activity can have different numbers; never convert the URN prefix.
export function attributedActivity(doc: ParentNode, post: string) {
  const cards = Array.from(
    doc.querySelectorAll("[data-attributed-urn][data-activity-urn]"),
  ).filter((card) => card.getAttribute("data-attributed-urn") === post);
  const id = cards[0]?.getAttribute("data-activity-urn");
  return cards.length === 1 && id && activityPattern.test(id) ? id : null;
}

async function findActivity(post: string, root: Element) {
  if (activityPattern.test(post)) return post;
  const local = attributedActivity(root.ownerDocument, post);
  if (local) return local;
  const link = [
    location.href,
    ...Array.from(
      root.querySelectorAll<HTMLAnchorElement>("a[href]"),
      (a) => a.href,
    ),
  ].find((url) => postUrlIdentity(url) === post);
  if (!link) return null;
  const url = new URL(link);
  url.search = "";
  url.hash = "";
  try {
    const response = await window.fetch(url.href, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5000),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/html")
    )
      return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "",
      bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) return null;
        html += decoder.decode(value, { stream: true });
      }
      // A template is inert: parsing the permalink must not load embedded resources.
      const template = document.createElement("template");
      template.innerHTML = html + decoder.decode();
      return attributedActivity(template.content, post);
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}

export function reactionPage(
  raw: Args,
  activity: string,
  limit: number,
  start: number,
  seen: Set<string>,
) {
  const page = raw?.data?.data?.socialDashReactionsByReactionType;
  const refs = page?.["*elements"];
  if (
    !Array.isArray(raw?.included) ||
    !Array.isArray(refs) ||
    refs.length > limit ||
    page.paging?.start !== start ||
    !Number.isSafeInteger(page.paging?.total) ||
    page.paging.total < 0
  )
    throw Error("reaction_response_shape_changed");
  const index = new Map<string, Args>(
    raw.included.map((row: Args) => [row.entityUrn, row]),
  );
  const items: Args[] = [];
  for (const ref of refs) {
    const row = index.get(ref);
    const actor = row?.actorUrn;
    if (
      !row ||
      typeof actor !== "string" ||
      !/^urn:li:(?:fsd_profile|fsd_company|organization):[\w-]+$/.test(actor) ||
      ref !== `urn:li:fsd_reaction:(${actor},${activity},0)`
    )
      throw Error("reaction_target_unverified");
    const lockup = row.reactorLockup;
    const name = asText(lockup?.title).trim();
    const url = lockup?.navigationUrl;
    if (
      typeof url !== "string" ||
      !/^https:\/\/www\.linkedin\.com\/(?:in|company)\/[\w%-]+\/?(?:[?#].*)?$/u.test(
        url,
      ) ||
      !name
    )
      throw Error("reaction_profile_unresolved");
    if (seen.has(actor)) continue;
    seen.add(actor);
    items.push({
      id: url.split(/[?#]/)[0],
      profile_url: url.split(/[?#]/)[0],
      name,
      ...(actor.startsWith("urn:li:fsd_profile:")
        ? { entityUrn: actor, profile_urn: actor }
        : {}),
      headline: asText(lockup.subtitle) || undefined,
      reaction_type: asText(row.reactionType) || undefined,
    });
  }
  const end = start + refs.length,
    more = end < page.paging.total;
  const advance = more && refs.length > 0 && items.length > 0 && end < 10000;
  return {
    items,
    partial: true,
    order: "source_order",
    reason: more
      ? advance
        ? "more_available"
        : "reaction_traversal_blocked"
      : "source_exhausted",
    completeness: more ? "partial" : "source_exhausted",
    next: advance
      ? { reaction_activity: activity, reaction_offset: end, seen: [...seen] }
      : undefined,
  };
}

export async function readReactions(
  post: string,
  root: Element,
  limit: number,
  state: Args,
) {
  const activity = state.reaction_activity ?? (await findActivity(post, root));
  if (!activity || !activityPattern.test(activity)) return null;
  const start = state.reaction_offset ?? 0;
  const result = await pageFetch({
    path:
      "/graphql?queryId=" +
      queryId +
      "&variables=" +
      restli({ threadUrn: activity, count: limit, start }),
  });
  if (result.error) throw Error(result.error);
  return reactionPage(
    result.data,
    activity,
    limit,
    start,
    new Set(state.seen ?? []),
  );
}
