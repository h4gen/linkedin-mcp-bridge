// Parsers adapted from the user's lead-extractor-for-linkedin-posts (1.1.10).
// Self-contained: Chrome serializes this function into an isolated world.
export async function extractionOperation(
  op: string,
  a: Record<string, any>,
  state: Record<string, any>,
): Promise<Record<string, any>> {
  type Profile = Record<string, any>;
  const elementText = (e: Element | null): string =>
    ((e as HTMLElement)?.innerText || e?.textContent || "").trim();
  const COMMENT_SELECTOR =
    'article.comments-comment-entity, .comments-comment-item, div[componentkey^="replaceableComment_"]';

  const getProfileImageUrl = (container: Element): string | undefined => {
    const image = container.querySelector("img");
    if (!image) return undefined;
    for (const attr of [
      "src",
      "data-delayed-url",
      "data-delayed-url-ghost",
      "data-ghost-url",
      "data-li-src",
      "data-src",
      "data-img-src",
    ]) {
      const value = image.getAttribute(attr);
      if (value?.startsWith("http")) return value;
    }
    return (
      image.srcset?.match(/https?:\/\/[^\s]+/)?.[0] ||
      image.style.backgroundImage?.match(/url\(["']?(.+?)["']?\)/)?.[1]
    );
  };

  const isMetadata = (value: string): boolean =>
    /^(?:author|autor|autorin|•?\s*[123](?:st|nd|rd|th)?\+?(?:\s+degree connection)?)$/i.test(
      value.trim(),
    ) ||
    /^(?:\d+\s*)?(?:s|m|h|d|w|mo|y)$/i.test(value.trim()) ||
    /^(?:just now|yesterday|today)$/i.test(value.trim());

  const cleanDescription = (value: string, name: string): string | undefined =>
    value && value !== name && !isMetadata(value) ? value : undefined;

  function commentContent(element: Element | null): {
    text: string;
    truncated: boolean;
  } {
    if (!element) return { text: "", truncated: false };
    const controls = element.querySelectorAll('button, [role="button"]');
    const truncated = Array.from(controls).some((control) =>
      /^(?:…|\.\.\.)?\s*(?:more|see more)$/i.test(elementText(control)),
    );
    const clone = element.cloneNode(true) as Element;
    clone
      .querySelectorAll(
        'button, [role="button"], [aria-hidden="true"], script, style',
      )
      .forEach((control) => control.remove());
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    clone.querySelectorAll("p, div, li").forEach((block) => block.append("\n"));
    return {
      text: (clone.textContent || "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      truncated,
    };
  }

  const extractReactors = (root: ParentNode = document): Profile[] => {
    const legacy = Array.from(
      root.querySelectorAll(".social-details-reactors-tab-body-list-item"),
    );
    if (legacy.length)
      return legacy.flatMap((item) => {
        const link = item.querySelector<HTMLAnchorElement>(
          'a[href*="/in/"], a[href*="/company/"]',
        );
        const name = elementText(
          item.querySelector(
            ".artdeco-entity-lockup__title .text-view-model, .artdeco-entity-lockup__title",
          ),
        );
        if (!link?.href || !name) return [];
        return [
          {
            profile_url: link.href,
            name,
            description: cleanDescription(
              elementText(
                item.querySelector(".artdeco-entity-lockup__caption"),
              ),
              name,
            ),
            photo_url: getProfileImageUrl(item),
            connection_degree: elementText(
              item.querySelector(".artdeco-entity-lockup__degree"),
            ).match(/[123]/)?.[0],
            reaction_type:
              item
                .querySelector(".social-details-reactors-tab-body__icon")
                ?.getAttribute("alt") || undefined,
          },
        ];
      });
    const list = root.querySelector('[data-testid="lazy-column"]') || root;
    const profiles = new Map<string, Profile>();
    list
      .querySelectorAll<HTMLAnchorElement>(
        'a[href*="/in/"], a[href*="/company/"]',
      )
      .forEach((link) => {
        const label =
          link
            .querySelector('[aria-label*="reacted with" i]')
            ?.getAttribute("aria-label") || "";
        const match = label.match(/^(.+?) reacted with (.+?)(?:,|$)/i);
        const paragraphs = Array.from(link.querySelectorAll("p")).map(
          elementText,
        );
        const name = match?.[1]?.trim() || paragraphs[0];
        if (!name || !link.href) return;
        const degree =
          label.match(/,\s*([123])(?:st|nd|rd|th)\s+degree connection/i) ||
          elementText(link).match(/•\s*([123])(?:st|nd|rd|th)?\+?/i);
        profiles.set(link.href.split(/[?#]/)[0], {
          profile_url: link.href,
          name,
          photo_url: getProfileImageUrl(link),
          description: paragraphs
            .slice(1)
            .map((value) => cleanDescription(value, name))
            .find(Boolean),
          connection_degree: degree?.[1],
          reaction_type: match?.[2]?.trim(),
        });
      });
    return [...profiles.values()];
  };

  const extractCommenters = (root: ParentNode = document): Profile[] => {
    const profiles = new Map<string, Profile>();
    root.querySelectorAll<HTMLElement>(COMMENT_SELECTOR).forEach((item) => {
      const legacy = item.matches("article");
      const profileLinks = Array.from(
        item.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/in/"], a[href*="/company/"]',
        ),
      );
      const link = legacy
        ? item.querySelector<HTMLAnchorElement>(
            '.comments-comment-meta__actor a[href*="/in/"], .comments-comment-meta__actor a[href*="/company/"]',
          )
        : profileLinks[0];
      if (!link?.href) return;
      const optionsLabel =
        item
          .querySelector('button[aria-label^="View more options for "]')
          ?.getAttribute("aria-label") || "";
      const nameMatch = optionsLabel.match(
        /^View more options for (.+?)(?:’s|'s) comment\.?$/i,
      );
      const metaLink =
        profileLinks.find((candidate) => elementText(candidate)) || link;
      const name = legacy
        ? elementText(
            item.querySelector(".comments-comment-meta__description-title"),
          )
        : nameMatch?.[1]?.trim() || elementText(metaLink.querySelector("p"));
      if (!name) return;
      const metadata = Array.from(metaLink.querySelectorAll("p")).map(
        elementText,
      );
      const description = legacy
        ? cleanDescription(
            elementText(
              item.querySelector(
                ".comments-comment-meta__description-subtitle",
              ),
            ),
            name,
          )
        : metadata
            .slice(1)
            .map((value) => cleanDescription(value, name))
            .find(Boolean);
      const contentRoot = item.querySelector(
        '.comments-comment-item__main-content, [data-testid="expandable-text-box"], .comments-comment-item-content-body',
      );
      const bodyParts = contentRoot
        ? [contentRoot]
        : Array.from(item.querySelectorAll("p")).filter(
            (paragraph) =>
              !paragraph.closest('a, button, [role="button"]') &&
              !isMetadata(elementText(paragraph)),
          );
      const content = bodyParts.map(commentContent);
      const comment_text = content
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n");
      const comment_id =
        item.getAttribute("componentkey") ||
        item.getAttribute("data-id") ||
        item.getAttribute("data-urn") ||
        item.id ||
        item.querySelector<HTMLAnchorElement>('a[href*="commentUrn="]')?.href ||
        undefined;
      const key = comment_id || link.href + "\n" + comment_text;
      profiles.set(key, {
        reaction_type: "Comment",
        profile_url: link.href,
        name,
        description,
        photo_url: getProfileImageUrl(item),
        connection_degree: elementText(
          legacy
            ? item.querySelector("h3.comments-comment-meta__description")
            : metaLink,
        ).match(/•\s*([123])(?:st|nd|rd)?\+?/i)?.[1],
        comment_id,
        comment_text: comment_text || undefined,
        comment_text_truncated: content.some((part) => part.truncated),
      });
    });
    return [...profiles.values()];
  };
  if (
    location.origin !== "https://www.linkedin.com" ||
    /checkpoint|challenge|login/.test(location.pathname)
  )
    throw Error("session_unavailable");
  const expectedPath = "/feed/update/" + a.post_urn;
  if (decodeURIComponent(location.pathname).replace(/\/$/, "") !== expectedPath)
    throw Error("open_exact_post_before_extraction");
  const root = document.querySelector<HTMLElement>('main, [role="main"]');
  if (!root) throw Error("post_container_missing");
  const seen = new Set<string>(state.seen ?? []);
  const items: Profile[] = [];
  const usable = (e: HTMLElement) =>
    !!e.offsetParent &&
    !e.matches(':disabled,[aria-disabled="true"],[aria-busy="true"]');
  let advances = 0;
  for (let step = 0; step < 5 && items.length < a.limit; step++) {
    for (const p of extractCommenters(root)) {
      const key = p.comment_id || p.profile_url + "\n" + p.comment_text;
      if (seen.has(key) || items.length >= a.limit) continue;
      seen.add(key);
      items.push({
        ...p,
        id: key,
        author: {
          name: p.name,
          profile_url: p.profile_url,
          headline: p.description,
          connection_degree: p.connection_degree,
        },
        text: p.comment_text,
        truncated: p.comment_text_truncated,
        parent_id: null,
      });
    }
    if (items.length >= a.limit) break;
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>('button,[role="button"]'),
    ).filter(usable);
    const more = controls.find((e) =>
      /^(?:(?:load|show|view)\s+)?(?:\d+\s+)?more comments?\b|^Weitere Kommentare|^Mehr Kommentare|^(?:View|Show) (?:\d+ )?(?:more )?repl(?:y|ies)|^\d+ Antworten|^Antworten anzeigen/i.test(
        elementText(e),
      ),
    );
    if (!more) break;
    more.click();
    advances++;
    await new Promise((r) => setTimeout(r, 800));
  }
  return {
    items,
    partial: true,
    completeness: "bounded_visible_results",
    reason: "linkedin_may_rank_or_hide_comments",
    advances,
    next:
      items.length || advances ? { seen: [...seen].slice(-5000) } : undefined,
  };
}
