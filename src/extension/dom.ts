// This entire function is injected into the connected LinkedIn tab. Never accepts
// JavaScript, selectors or arbitrary URLs from an MCP caller.
export async function domOperation(
  op: string,
  a: Record<string, any>,
  state: Record<string, any>,
): Promise<Record<string, any>> {
  const tracksDispatch = [
    "invitation_respond",
    "invitation_withdraw",
    "conversation_delete",
  ].includes(op);
  let mutationStarted = false;
  try {
    const fail = (code: string): never => {
      throw new Error(code);
    };
    if (
      location.hostname !== "www.linkedin.com" ||
      /checkpoint|challenge|login/.test(location.pathname)
    )
      fail("session_unavailable");
    const visible = (e: Element) =>
      !!(e as HTMLElement).offsetParent || e.getClientRects().length > 0;
    const wait = () => new Promise((r) => setTimeout(r, 800));
    const matchingControls = (root: ParentNode, pattern: RegExp) => {
      if (
        a.execution_session &&
        (window as any).__liBridgeSession !== a.execution_session
      )
        fail("cancelled");
      const matches = [
        ...root.querySelectorAll(
          'button,[role="button"],a[href],[role="menuitem"]',
        ),
      ].filter(
        (e) =>
          visible(e) &&
          [e.getAttribute("aria-label"), e.textContent].some((label) =>
            pattern.test(label?.trim() ?? ""),
          ) &&
          e.getAttribute("aria-disabled") !== "true" &&
          !(e as HTMLButtonElement).disabled,
      );
      return matches as HTMLElement[];
    };
    const button = (root: ParentNode, pattern: RegExp) => {
      const matches = matchingControls(root, pattern);
      if (matches.length !== 1) return fail("ui_control_ambiguous_or_missing");
      return matches[0];
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
      if (
        a.execution_session &&
        (window as any).__liBridgeSession !== a.execution_session
      )
        fail("cancelled");
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
        author_profile_url: (() => {
          const link = e.querySelector<HTMLAnchorElement>(
            ".update-components-actor__meta-link,.feed-shared-actor__container-link",
          );
          if (link?.href) return link.href;
          const candidates = Array.from(
            e.querySelectorAll<HTMLAnchorElement>(
              'a[href*="/in/"],a[href*="/company/"],a[href*="/school/"]',
            ),
          )
            .filter((a) => {
              const label = (
                a.getAttribute("aria-label") ??
                a.textContent ??
                ""
              ).trim();
              return label === author || label.startsWith(author + " ");
            })
            .map((a) => a.href.split(/[?#]/)[0]);
          return new Set(candidates).size === 1 ? candidates[0] : null;
        })(),
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
        url:
          Array.from(
            e.querySelectorAll<HTMLAnchorElement>(
              'a[href*="/feed/update/"],a[href*="/posts/"]',
            ),
          )
            .map((a) => a.href)
            .find(
              (url) => entityUrn && decodeURIComponent(url).includes(entityUrn),
            ) ?? null,
      };
    };
    if (op === "feed_list") {
      if (!location.pathname.startsWith("/feed"))
        fail("open_feed_in_connected_tab");
      const seen = new Set<string>(state.seen ?? []);
      if (seen.size >= 10000) fail("traversal_limit_reached");
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
        next: items.length ? { seen: [...seen] } : undefined,
        scans: stagnant,
      };
    }
    if (op === "post_resolve") {
      const matches = roots().filter(
        (e) => postData(e).scan_key === a.scan_key,
      );
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
              ) {
                post.setAttribute("data-mcp-post-urn", urn);
                return {
                  ...initial,
                  entityUrn: urn,
                  url: urn.startsWith("urn:li:activity:")
                    ? "https://www.linkedin.com/feed/update/" + urn
                    : null,
                };
              }
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
        verified:
          !!newComment?.getAttribute("data-id") &&
          !!a.verified_actor?.profile_url &&
          Array.from(
            newComment.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'),
          ).some(
            (link) =>
              link.href.split(/[?#]/)[0].replace(/\/$/, "") ===
              a.verified_actor.profile_url.replace(/\/$/, ""),
          ),
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
      const own = [
        ...document.querySelectorAll('[data-urn^="urn:li:activity:"]'),
      ]
        .map(postData)
        .find((p) => p.text === a.text && !beforePosts.has(p.entityUrn));
      return own && a.verified_actor?.name === own.author
        ? { verified: true, receipt_id: own.entityUrn }
        : { verified: false };
    }
    const readyUntil = Math.min(
      Date.now() + 10000,
      a.execution_deadline ?? Infinity,
    );
    const pagePath = location.pathname;
    const guard = () => {
      if (
        location.pathname !== pagePath ||
        (a.execution_session &&
          (window as any).__liBridgeSession !== a.execution_session)
      )
        fail("cancelled");
      if (Date.now() > (a.execution_deadline ?? Infinity))
        fail("deadline_exceeded");
    };
    const ready = async <T>(
      read: () => T | undefined,
      error: string,
    ): Promise<T> => {
      for (;;) {
        guard();
        const value = read();
        if (value !== undefined) return value;
        if (Date.now() >= readyUntil) return fail(error);
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    const readyButton = (root: ParentNode, pattern: RegExp) =>
      ready(() => {
        const matches = matchingControls(root, pattern);
        if (matches.length > 1) fail("ui_control_ambiguous_or_missing");
        return matches[0];
      }, "ui_control_ambiguous_or_missing");
    const mutate = (control: HTMLElement) => {
      guard();
      mutationStarted = true; // Immediately before the potentially mutating click.
      control.click();
    };
    const dialogs = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'dialog[open],[role="dialog"],[role="alertdialog"]',
        ),
      ].filter(visible);
    if (op === "invitation_respond" || op === "invitation_withdraw") {
      const verified = a.verified_target;
      if (!verified || verified.entityUrn !== a.invitation_urn)
        fail("invitation_not_verified");
      const canonical = (url: string) =>
        new URL(url, location.href).href.split(/[?#]/)[0].replace(/\/$/, "");
      const url = canonical(verified.profile.profile_url);
      const pattern =
        op === "invitation_withdraw"
          ? /^(Withdraw|Zurückziehen)(\s|$)/i
          : a.action === "accept"
            ? /^(Accept|Annehmen)(\s|$)/i
            : /^(Ignore|Ignorieren)(\s|$)/i;
      const target = await ready(() => {
        const candidates = new Set<HTMLElement>();
        for (const link of document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/in/"]',
        )) {
          if (!visible(link) || canonical(link.href) !== url) continue;
          for (
            let node = link.parentElement;
            node && !node.matches('body,main,[role="main"]');
            node = node.parentElement
          ) {
            const urls = new Set(
              [
                ...node.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'),
              ].map((l) => canonical(l.href)),
            );
            if (urls.size !== 1 || !urls.has(url)) break;
            const controls = [
              ...node.querySelectorAll<HTMLElement>(
                'button,[role="button"],a[href]',
              ),
            ].filter(
              (e) =>
                visible(e) &&
                [e.getAttribute("aria-label"), e.textContent].some((t) =>
                  pattern.test(t?.trim() ?? ""),
                ),
            );
            if (controls.length) {
              candidates.add(node);
              break;
            }
          }
        }
        const minimal = [...candidates].filter(
          (n) =>
            ![...candidates].some((other) => other !== n && n.contains(other)),
        );
        if (minimal.length > 1) fail("invitation_target_not_unique");
        return minimal[0];
      }, "invitation_target_not_unique");
      const control = await readyButton(target, pattern);
      if (
        control.tagName === "A" &&
        new URL((control as HTMLAnchorElement).href).origin !== location.origin
      )
        fail("invitation_control_location_mismatch");
      const label = control.getAttribute("aria-label");
      const pendingConfirmation = () => {
        if (op !== "invitation_withdraw" || !label) return undefined;
        const matching = dialogs().filter((d) =>
          matchingControls(d, pattern).some(
            (b) => b.getAttribute("aria-label") === label,
          ),
        );
        if (matching.length > 1) fail("withdraw_dialog_not_unique");
        return matching[0];
      };
      if (a.preflight) {
        // The previous adapter excluded links and matched only the whole aria-label.
        const oldPattern =
          op === "invitation_withdraw"
            ? /^(Withdraw|Zurückziehen)$/i
            : a.action === "accept"
              ? /^(Accept|Annehmen)$/i
              : /^(Ignore|Ignorieren)$/i;
        return {
          preflight: true,
          dispatch_state: "not_dispatched",
          continuation_ready: !!pendingConfirmation(),
          legacy_no_dispatch_proof:
            control.tagName === "A" ||
            !oldPattern.test(
              (
                control.getAttribute("aria-label") ??
                control.textContent ??
                ""
              ).trim(),
            ),
        };
      }
      if (op === "invitation_withdraw") {
        let dialog = pendingConfirmation();
        if (!dialog) {
          if (a.resume_confirmation) fail("withdraw_confirmation_lost");
          const before = new Set(dialogs());
          mutate(control); // A transport interruption here remains unknown.
          dialog = await ready(() => {
            const appeared = dialogs().filter((d) => !before.has(d));
            if (appeared.length > 1) fail("withdraw_dialog_not_unique");
            return appeared[0];
          }, "withdraw_dialog_missing");
        }
        // Observed confirmation means the final mutation has not been clicked.
        mutationStarted = false;
        const final = await readyButton(dialog, pattern);
        if (!label || final.getAttribute("aria-label") !== label)
          fail("withdraw_confirmation_target_mismatch");
        mutate(final);
      } else mutate(control);
      await wait();
      return {
        verified: false,
        dispatch_state: "dispatched",
        ui_target_disappeared: !target.isConnected,
      };
    }
    if (op === "conversation_delete") {
      const thread = a.conversation_urn.match(/,([^,)]+)\)$/)?.[1];
      if (
        !thread ||
        !/^[\w=+-]+$/.test(thread) ||
        decodeURIComponent(location.pathname).replace(/\/$/, "") !==
          "/messaging/thread/" + thread
      )
        fail("open_exact_conversation_before_delete");
      const pane = await ready(() => {
        const panes = [
          ...document.querySelectorAll<HTMLElement>(".msg-thread"),
        ].filter(visible);
        if (panes.length > 1) fail("conversation_pane_not_unique");
        return panes[0];
      }, "conversation_pane_missing");
      const header = await ready(
        () =>
          pane.querySelector<HTMLElement>(
            "#thread-detail-jump-target,.msg-title-bar",
          ) ?? undefined,
        "conversation_header_missing",
      );
      const trigger = button(
        header,
        /^(Open the options list in your conversation|More|More options|Weitere|Weitere Optionen)(\s|$)/i,
      );
      if (a.preflight)
        return {
          preflight: true,
          dispatch_state: "not_dispatched",
          legacy_no_dispatch_proof: true,
        };
      const beforeDialogs = new Set(dialogs());
      guard();
      if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
      const menu = await ready(() => {
        const id = trigger.getAttribute("aria-controls");
        const owned = id
          ? document.getElementById(id)
          : trigger
              .closest(".artdeco-dropdown")
              ?.querySelector<HTMLElement>(
                '[role="menu"],.artdeco-dropdown__content',
              );
        return owned && visible(owned) ? owned : undefined;
      }, "conversation_menu_missing");
      guard();
      (
        await readyButton(
          menu,
          /^(Delete conversation|Delete|Unterhaltung löschen|Löschen)$/i,
        )
      ).click();
      const dialog = await ready(() => {
        const fresh = dialogs().filter((d) => !beforeDialogs.has(d));
        if (fresh.length > 1) fail("delete_dialog_not_unique");
        return fresh[0];
      }, "delete_dialog_not_unique");
      mutate(await readyButton(dialog, /^(Delete|Löschen)$/i));
      await wait();
      return { verified: false, dispatch_state: "dispatched" };
    }
    return fail("unsupported_dom_operation");
  } catch (error) {
    return {
      bridge_error:
        error instanceof Error ? error.message : "dom_operation_failed",
      ...(tracksDispatch
        ? { dispatch_state: mutationStarted ? "dispatched" : "not_dispatched" }
        : {}),
    };
  }
}
