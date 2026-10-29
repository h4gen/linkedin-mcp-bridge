// This entire function is injected into the connected LinkedIn tab. Never accepts
// JavaScript, selectors or arbitrary URLs from an MCP caller.
export async function domOperation(
  op: string,
  a: Record<string, any>,
  state: Record<string, any>,
): Promise<Record<string, any>> {
  const fail = (code: string): never => {
    throw new Error(code);
  };
  if (
    location.hostname !== "www.linkedin.com" ||
    /checkpoint|challenge|login/.test(location.pathname)
  )
    fail("session_unavailable");
  const visible = (e: Element) => !!(e as HTMLElement).offsetParent;
  const wait = () => new Promise((r) => setTimeout(r, 800));
  const button = (root: ParentNode, pattern: RegExp) => {
    const matches = [...root.querySelectorAll('button,[role="button"]')].filter(
      (e) =>
        visible(e) &&
        pattern.test(
          (e.getAttribute("aria-label") ?? e.textContent ?? "").trim(),
        ) &&
        !(e as HTMLButtonElement).disabled,
    );
    if (matches.length !== 1) return fail("ui_control_ambiguous_or_missing");
    return matches[0] as HTMLElement;
  };
  // Modern SDUI and legacy post structure, adapted from the user's LinkedIn extractor.
  const roots = () => {
    const nodes = [
      ...document.querySelectorAll(
        '[data-urn^="urn:li:activity:"],[data-id^="urn:li:activity:"],.feed-shared-update-v2,[role="listitem"]:has(button[aria-label^="Open control menu for post by "]),[role="listitem"]:has(button[aria-label="Comment"]):has(button[aria-label="Repost"])',
      ),
    ];
    return nodes.filter(
      (e) => !nodes.some((other) => other !== e && other.contains(e)),
    );
  };
  const identity = (e: Element): string | null => {
    for (const node of [
      e,
      ...e.querySelectorAll(
        '[data-urn],[data-id],[data-entity-urn],[data-reaction-urn],[id*="ContentUrn"],[componentkey*="ContentUrn"],[componentkey*="userGeneratedContentId="],[componentkey*="ugcPostId="],[componentkey*="shareId="],a[href*="/feed/update/"],a[href*="/posts/"]',
      ),
    ]) {
      for (const attr of [
        "data-urn",
        "data-id",
        "data-entity-urn",
        "data-reaction-urn",
        "id",
        "componentkey",
        "href",
      ]) {
        let value = node.getAttribute(attr) ?? "";
        try {
          value = decodeURIComponent(value);
        } catch {}
        const direct = value.match(
          /urn:li:(?:activity|share|ugcPost):\d+/,
        )?.[0];
        if (direct) return direct;
        const activity = value.match(/activity[-:](\d+)/)?.[1];
        if (activity) return "urn:li:activity:" + activity;
        const ugc = value.match(
          /(?:userGeneratedContent(?:Post)?Id|ugcPostId)=(\d+)/,
        )?.[1];
        if (ugc) return "urn:li:ugcPost:" + ugc;
        const share = value.match(/shareId=(\d+)/)?.[1];
        if (share) return "urn:li:share:" + share;
      }
    }
    return null;
  };
  const card = () => {
    const all = roots().filter((e) => identity(e) === a.post_urn);
    if (all.length !== 1) return fail("post_target_not_unique");
    return all[0];
  };
  const fill = (e: HTMLElement, text: string) => {
    e.focus();
    if (e instanceof HTMLTextAreaElement || e instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(e),
        "value",
      )?.set?.call(e, text);
    } else {
      e.textContent = text;
    }
    e.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  };
  const postData = (e: Element) => {
    const entityUrn = identity(e);
    const text =
      e
        .querySelector(
          '.feed-shared-update-v2__commentary,.feed-shared-inline-show-more-text__text-view,.feed-shared-update-v2__description,.update-components-text,[data-test-id="main-feed-post-content"],[data-testid="expandable-text-box"]',
        )
        ?.textContent?.trim() ?? "";
    const menuLabel =
      e
        .querySelector('button[aria-label^="Open control menu for post by "]')
        ?.getAttribute("aria-label") ?? "";
    const author =
      menuLabel.replace(/^Open control menu for post by /, "") ||
      e
        .querySelector(
          ".update-components-actor__name,.update-components-actor__title,.feed-shared-actor__name",
        )
        ?.textContent?.trim() ||
      "";
    let hash = 2166136261;
    for (const ch of author + "|" + text)
      hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return {
      entityUrn,
      scan_key: entityUrn ?? "local:" + String(hash >>> 0),
      text,
      author,
      author_profile_url:
        e.querySelector<HTMLAnchorElement>(
          'a[href*="/in/"],a[href*="/company/"]',
        )?.href ?? null,
      published_at: e.querySelector("time")?.getAttribute("datetime") ?? null,
      visible_time: e.querySelector("time")?.textContent?.trim() ?? null,
      engagement: Array.from(
        e.querySelectorAll(
          '.social-details-social-counts, [aria-label*="reaction"], [aria-label*="comment"]',
        ),
      )
        .map((x) => x.getAttribute("aria-label") || x.textContent?.trim())
        .filter(Boolean)
        .slice(0, 8),
      media: Array.from(
        e.querySelectorAll("video, .update-components-image img"),
      ).map((x) => ({
        type: x.tagName.toLowerCase(),
        description: x.getAttribute("alt"),
      })),
      url: entityUrn
        ? "https://www.linkedin.com/feed/update/" + entityUrn
        : null,
    };
  };
  if (op === "feed_list") {
    if (!location.pathname.startsWith("/feed"))
      fail("open_feed_in_connected_tab");
    const seen = new Set<string>(state.seen ?? []);
    let items: Record<string, any>[] = [];
    let stagnant = 0;
    for (let i = 0; i < 5 && items.length < a.limit; i++) {
      const all = roots().map(postData);
      for (const p of all)
        if (
          (p.text || p.author) &&
          !seen.has(p.scan_key) &&
          items.length < a.limit
        ) {
          items.push(p);
          seen.add(p.scan_key);
        }
      if (items.length >= a.limit) break;
      stagnant++;
      let scrolling: Element | null = roots()[0]?.parentElement ?? null;
      while (scrolling) {
        const overflow = window.getComputedStyle(scrolling).overflowY;
        if (
          /auto|scroll/.test(overflow) &&
          scrolling.scrollHeight > scrolling.clientHeight + 100
        )
          break;
        scrolling = scrolling.parentElement;
      }
      scrolling ??= document.scrollingElement;
      if (scrolling) scrolling.scrollBy(0, Math.max(innerHeight, 700));
      else window.scrollBy(0, Math.max(innerHeight, 700));
      await wait();
    }
    return {
      items,
      partial: true,
      reason: "bounded_live_feed_scan",
      next: items.length ? { seen: [...seen].slice(-1000) } : undefined,
      scans: stagnant,
    };
  }
  if (op === "post_resolve") {
    const matches = roots().filter((e) => postData(e).scan_key === a.scan_key);
    if (matches.length !== 1) fail("post_target_not_unique");
    const post = matches[0];
    const initial = postData(post);
    if (initial.entityUrn) return initial;
    const trigger = post.querySelector<HTMLButtonElement>(
      'button[aria-label^="Open control menu for post by "]',
    );
    if (!trigger) return fail("post_menu_missing");
    const opened = trigger.getAttribute("aria-expanded") === "true";
    const before = new Set(
      [...document.querySelectorAll('[role="menu"]')].filter(visible),
    );
    let owned: Element | undefined;
    try {
      if (!opened) trigger.click();
      for (let attempt = 0; attempt < 6; attempt++) {
        await wait();
        const menus = [...document.querySelectorAll('[role="menu"]')].filter(
          visible,
        );
        const appeared = menus.filter((m) => !before.has(m));
        owned =
          menus.find(
            (m) => m.id && m.id === trigger.getAttribute("aria-controls"),
          ) ??
          menus.find((m) => post.contains(m)) ??
          (!opened && appeared.length === 1 ? appeared[0] : undefined);
        if (owned) {
          const links = [
            ...owned.querySelectorAll<HTMLAnchorElement>("a[href]"),
          ];
          for (const link of links) {
            let href = link.href;
            try {
              href = decodeURIComponent(href);
            } catch {}
            const urn = href.match(
              /urn:li:(?:activity|share|ugcPost):\d+/,
            )?.[0];
            if (
              urn &&
              post.isConnected &&
              postData(post).scan_key === initial.scan_key
            )
              return {
                ...initial,
                entityUrn: urn,
                url: "https://www.linkedin.com/feed/update/" + urn,
              };
          }
        }
      }
      return fail("post_identity_unavailable");
    } finally {
      if (
        !opened &&
        trigger.isConnected &&
        trigger.getAttribute("aria-expanded") === "true"
      )
        trigger.click();
      else if (!opened && owned?.isConnected)
        owned.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    }
  }
  if (op === "post_get") return postData(card());
  if (op === "comments_list") {
    const root = card();
    const seen = new Set<string>(state.seen ?? []);
    const items = [
      ...root.querySelectorAll(
        ".comments-comment-item,.comments-comment-entity",
      ),
    ]
      .map((e) => ({
        id: e.getAttribute("data-id") ?? e.id,
        text:
          e
            .querySelector(
              ".comments-comment-item__main-content,.comments-comment-entity__content",
            )
            ?.textContent?.trim() ?? "",
        author: e.querySelector('a[href*="/in/"]')?.textContent?.trim() ?? "",
      }))
      .filter((e) => e.id && !seen.has(e.id))
      .slice(0, a.limit);
    items.forEach((x) => seen.add(x.id));
    return {
      items,
      partial: true,
      reason: "currently_rendered_comments",
      next: items.length ? { seen: [...seen] } : undefined,
    };
  }
  if (op === "post_like") {
    const root = card();
    const b = button(
      root,
      /^(Like|Unlike|Gefällt mir|Gefällt mir nicht mehr)(\s|$)/i,
    );
    const active = b.getAttribute("aria-pressed") === "true";
    if (active === a.liked) return { verified: true };
    b.click();
    await wait();
    return { verified: b.getAttribute("aria-pressed") === String(a.liked) };
  }
  if (op === "post_comment") {
    const root = card();
    const beforeComments = new Set([
      ...root.querySelectorAll(
        ".comments-comment-item,.comments-comment-entity",
      ),
    ]);
    button(root, /^(Comment|Kommentieren)$/i).click();
    await wait();
    const fields = [
      ...root.querySelectorAll<HTMLElement>(
        '[contenteditable="true"][role="textbox"],.ql-editor[contenteditable="true"]',
      ),
    ].filter(visible);
    if (fields.length !== 1) fail("comment_editor_not_unique");
    fill(fields[0], a.text);
    button(root, /^(Post|Comment|Kommentieren|Posten)$/i).click();
    await wait();
    const newComment = [
      ...root.querySelectorAll(
        ".comments-comment-item,.comments-comment-entity",
      ),
    ].find(
      (e) =>
        !beforeComments.has(e) &&
        e
          .querySelector(
            ".comments-comment-item__main-content,.comments-comment-entity__content",
          )
          ?.textContent?.trim() === a.text,
    );
    return {
      verified: !!newComment?.getAttribute("data-id"),
      receipt_id: newComment?.getAttribute("data-id") ?? undefined,
    };
  }
  if (op === "post_create") {
    const beforePosts = new Set(
      [...document.querySelectorAll('[data-urn^="urn:li:activity:"]')].map(
        (e) => e.getAttribute("data-urn"),
      ),
    );
    button(
      document,
      /^(Start a post|Beitrag beginnen|Beitrag erstellen)$/i,
    ).click();
    await wait();
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
      visible,
    );
    if (dialogs.length !== 1) fail("composer_not_unique");
    const dialog = dialogs[0];
    const editor = dialog.querySelector<HTMLElement>(
      '[contenteditable="true"][role="textbox"],.ql-editor[contenteditable="true"]',
    );
    if (!editor) return fail("composer_missing");
    fill(editor, a.text);
    button(dialog, /^(Post|Posten|Veröffentlichen)$/i).click();
    await wait();
    // A closed dialog alone does not prove publication.
    const own = [...document.querySelectorAll('[data-urn^="urn:li:activity:"]')]
      .map(postData)
      .find((p) => p.text === a.text && !beforePosts.has(p.entityUrn));
    return own
      ? { verified: true, receipt_id: own.entityUrn }
      : { verified: false };
  }
  if (op === "invitation_respond" || op === "invitation_withdraw") {
    const targets = [
      ...document.querySelectorAll("[data-urn],[data-id]"),
    ].filter(
      (e) =>
        e.getAttribute("data-urn") === a.invitation_urn ||
        e.getAttribute("data-id") === a.invitation_urn,
    );
    if (targets.length !== 1) fail("invitation_target_not_unique");
    const target = targets[0];
    button(
      target,
      op === "invitation_withdraw"
        ? /^(Withdraw|Zurückziehen)$/i
        : a.action === "accept"
          ? /^(Accept|Annehmen)$/i
          : /^(Ignore|Ignorieren)$/i,
    ).click();
    await wait();
    if (op === "invitation_withdraw") {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
        visible,
      );
      if (dialogs.length === 1) {
        button(dialogs[0], /^(Withdraw|Zurückziehen)$/i).click();
        await wait();
      }
    }
    return { verified: false, ui_target_disappeared: !target.isConnected };
  }
  if (op === "conversation_delete") {
    // Require the exact thread to already be open; never navigate a guessed ID.
    const thread = a.conversation_urn.match(/,([^,)]+)\)$/)?.[1];
    if (
      !thread ||
      !/^[\w=+-]+$/.test(thread) ||
      decodeURIComponent(location.pathname).replace(/\/$/, "") !==
        "/messaging/thread/" + thread
    )
      fail("open_exact_conversation_before_delete");
    const pane = document.querySelector(".msg-thread");
    if (!pane) return fail("conversation_pane_missing");
    button(
      pane,
      /^(More|More options|Weitere|Weitere Optionen)(\s|$)/i,
    ).click();
    await wait();
    button(document, /^(Delete conversation|Unterhaltung löschen)$/i).click();
    await wait();
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
      visible,
    );
    if (dialogs.length !== 1) fail("delete_dialog_not_unique");
    button(dialogs[0], /^(Delete|Löschen)$/i).click();
    await wait();
    return { verified: false };
  }
  return fail("unsupported_dom_operation");
}
