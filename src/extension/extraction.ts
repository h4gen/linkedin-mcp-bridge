// Parsers adapted from the user's lead-extractor-for-linkedin-posts (1.1.10).
// Self-contained: Chrome serializes this function into an isolated world.
export async function extractionOperation(
  op: string,
  a: Record<string, any>,
  state: Record<string, any>,
): Promise<Record<string, any>> {
  try {
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

    const cleanDescription = (
      value: string,
      name: string,
    ): string | undefined =>
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
      clone
        .querySelectorAll("p, div, li")
        .forEach((block) => block.append("\n"));
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
          item.querySelector<HTMLAnchorElement>('a[href*="commentUrn="]')
            ?.href ||
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
    const isUsableControl = (element: HTMLElement): boolean => {
      if (
        element.closest('[hidden], [inert], [aria-hidden="true"]') ||
        element.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')
      )
        return false;
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };

    function findReactionTrigger(post: HTMLElement): HTMLElement | null {
      const controls = Array.from(
        post.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
      );
      return (
        controls.find((control) => {
          if (
            !isUsableControl(control) ||
            control.closest(
              '[componentkey^="replaceableComment_"], .comments-comment-entity',
            )
          )
            return false;
          const ownPost = control.closest(
            '[data-urn], [data-id^="urn:"], [role="listitem"]',
          );
          if (ownPost && ownPost !== post && !ownPost.contains(post))
            return false;
          const labelledElement = control.hasAttribute("aria-labelledby")
            ? control
            : control.querySelector("[aria-labelledby]");
          const labelledText = (
            labelledElement?.getAttribute("aria-labelledby") || ""
          )
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ")
            .trim();
          const label =
            control.getAttribute("aria-label") ||
            labelledText ||
            elementText(control);
          return (
            /^(?:view all reactions|[\d,.\sKMB]+ reactions?)$/i.test(
              label.trim(),
            ) ||
            control.matches(
              ".social-details-social-counts__reactions-count, .social-details-social-counts__count-value",
            ) ||
            !!control.querySelector(
              ".social-details-social-counts__reactions-count",
            )
          );
        }) || null
      );
    }

    const findCommentsRoot = (post: HTMLElement): HTMLElement =>
      // SDUI permalink comments are siblings of the post, inside its own paged container.
      post.closest<HTMLElement>('[componentkey*="pagedCommentsContainer"]') ||
      post;

    function activateReactionTrigger(trigger: HTMLElement) {
      // SDUI's press control needs the press/release sequence, not only HTMLElement.click().
      // Keep this strictly scoped to the already-validated reaction-count control.
      const control =
        trigger.querySelector<HTMLElement>("[aria-labelledby]") || trigger;
      control.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
      const rect = control.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      // Dispatch on the actual hit-tested descendant, as a browser click does.
      // A click on the wrapper skips handlers attached to the icon/list below it.
      const hit = document.elementFromPoint?.(clientX, clientY);
      const target = hit && control.contains(hit) ? hit : control;
      // Let LinkedIn's press handler consume the event and cancel its own link.
      // Do not pre-cancel a delegated handler at document capture.
      if (control !== trigger && typeof PointerEvent !== "undefined") {
        const init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          button: 0,
        };
        const pointer = {
          ...init,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          width: 1,
          height: 1,
        };
        for (const event of [
          new PointerEvent("pointerdown", { ...pointer, buttons: 1 }),
          new MouseEvent("mousedown", { ...init, buttons: 1 }),
          new PointerEvent("pointerup", { ...pointer, buttons: 0 }),
          new MouseEvent("mouseup", { ...init, buttons: 0 }),
          new PointerEvent("click", { ...pointer, detail: 1, buttons: 0 }),
        ]) {
          target.dispatchEvent(event);
        }
      } else control.click();
    }

    function findReactionDialog(): HTMLElement | null {
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(
          'dialog[open], [role="dialog"], .artdeco-modal',
        ),
      );
      return (
        dialogs.find((dialog) => {
          if (!isUsableControl(dialog)) return false;
          if (dialog.querySelector(".social-details-reactors-modal__content"))
            return true;
          const labelled = (dialog.getAttribute("aria-labelledby") || "")
            .split(/\s+/)
            .map((id) => elementText(document.getElementById(id)))
            .join(" ")
            .trim();
          const heading =
            labelled ||
            elementText(dialog.querySelector('h1, h2, h3, [role="heading"]'));
          return /^reactions$/i.test(heading);
        }) || null
      );
    }

    const scrollExtractionList = (root: HTMLElement) => {
      const candidates = [
        root,
        ...Array.from(root.querySelectorAll<HTMLElement>("*")),
      ];
      const target = candidates.find(
        (element) =>
          element.scrollHeight > element.clientHeight + 20 &&
          /auto|scroll/.test(getComputedStyle(element).overflowY),
      );
      if (target)
        target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
      else
        root.lastElementChild?.scrollIntoView({
          block: "end",
          behavior: "auto",
        });
    };

    if (
      location.origin !== "https://www.linkedin.com" ||
      /checkpoint|challenge|login/.test(location.pathname)
    )
      throw Error("session_unavailable");
    const expectedPath = "/feed/update/" + a.post_urn;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-mcp-post-urn],[data-urn],[data-id]",
      ),
    ).filter((e) =>
      ["data-mcp-post-urn", "data-urn", "data-id"].some(
        (k) => e.getAttribute(k) === a.post_urn,
      ),
    );
    const direct = targets.filter(
      (e) => !targets.some((other) => other !== e && other.contains(e)),
    );
    const onPermalink =
      decodeURIComponent(location.pathname).replace(/\/$/, "") === expectedPath;
    const root =
      direct.length === 1
        ? direct[0]
        : onPermalink
          ? document.querySelector<HTMLElement>('main, [role="main"]')
          : null;
    if (!root) throw Error("post_target_not_unique");
    const seen = new Set<string>(state.seen ?? []);
    const items: Profile[] = [];
    const usable = (e: HTMLElement) =>
      !!e.offsetParent &&
      !e.matches(':disabled,[aria-disabled="true"],[aria-busy="true"]');
    if (op === "reactions_list") {
      const prior = findReactionDialog();
      const trigger = findReactionTrigger(root);
      let dialog = prior;
      if (
        prior &&
        !(
          onPermalink ||
          (prior.id && trigger?.getAttribute("aria-controls") === prior.id)
        )
      )
        throw Error("unrelated_dialog_open");
      if (!dialog) {
        if (
          Array.from(
            document.querySelectorAll<HTMLElement>(
              'dialog[open],[role="dialog"]',
            ),
          ).some(isUsableControl)
        )
          throw Error("unrelated_dialog_open");
        if (!trigger) throw Error("reaction_control_missing");
        activateReactionTrigger(trigger);
        for (let attempt = 0; attempt < 12 && !dialog; attempt++) {
          await new Promise((r) => setTimeout(r, 200));
          dialog = findReactionDialog();
        }
      }
      if (!dialog) throw Error("reaction_dialog_missing");
      try {
        for (let step = 0; step < 5 && items.length < a.limit; step++) {
          for (const p of extractReactors(dialog)) {
            const key = p.profile_url?.split(/[?#]/)[0];
            if (!key || seen.has(key) || items.length >= a.limit) continue;
            seen.add(key);
            items.push({ ...p, id: key, headline: p.description });
          }
          if (items.length >= a.limit) break;
          scrollExtractionList(dialog);
          await new Promise((r) => setTimeout(r, 700));
        }
        return {
          items,
          partial: true,
          completeness: "bounded_visible_results",
          next: items.length ? { seen: [...seen].slice(-5000) } : undefined,
        };
      } finally {
        if (!prior)
          dialog
            .querySelector<HTMLElement>(
              'button[aria-label="Dismiss"],button[aria-label="Close"],button[aria-label="Schließen"],.artdeco-modal__dismiss',
            )
            ?.click();
      }
    }
    if (!root.querySelector(COMMENT_SELECTOR)) {
      const comments = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((e) =>
        /^(Comment|Kommentieren)$/.test(e.getAttribute("aria-label") ?? ""),
      );
      if (comments.length === 1) {
        comments[0].click();
        for (
          let attempt = 0;
          attempt < 15 && !root.querySelector(COMMENT_SELECTOR);
          attempt++
        )
          await new Promise((r) => setTimeout(r, 200));
      }
    }
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
  } catch (e) {
    return {
      bridge_error: e instanceof Error ? e.message : "extraction_failed",
    };
  }
}
