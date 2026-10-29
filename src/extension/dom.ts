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
  const card = () => {
    const all = [...document.querySelectorAll("[data-urn],[data-id]")].filter(
      (e) =>
        e.getAttribute("data-urn") === a.post_urn ||
        e.getAttribute("data-id") === a.post_urn,
    );
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
  const postData = (e: Element) => ({
    entityUrn: e.getAttribute("data-urn") ?? e.getAttribute("data-id"),
    text:
      e
        .querySelector(
          ".update-components-text,.feed-shared-update-v2__description",
        )
        ?.textContent?.trim() ?? "",
    author:
      e
        .querySelector(
          ".update-components-actor__title,.feed-shared-actor__name",
        )
        ?.textContent?.trim() ?? "",
    url:
      e.querySelector<HTMLAnchorElement>('a[href*="/feed/update/"]')?.href ??
      null,
  });
  if (op === "feed_list") {
    if (!location.pathname.startsWith("/feed"))
      fail("open_feed_in_connected_tab");
    const seen = new Set<string>(state.seen ?? []);
    let items: Record<string, any>[] = [];
    let stagnant = 0;
    for (let i = 0; i < 5 && items.length < a.limit; i++) {
      const all = [
        ...document.querySelectorAll(
          '[data-urn^="urn:li:activity:"],[data-id^="urn:li:activity:"]',
        ),
      ].map(postData);
      for (const p of all)
        if (p.entityUrn && !seen.has(p.entityUrn) && items.length < a.limit) {
          items.push(p);
          seen.add(p.entityUrn);
        }
      if (items.length >= a.limit) break;
      stagnant++;
      window.scrollBy(0, Math.max(innerHeight, 700));
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
      !/^[\w-]+$/.test(thread) ||
      location.pathname.replace(/\/$/, "") !== "/messaging/thread/" + thread
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
