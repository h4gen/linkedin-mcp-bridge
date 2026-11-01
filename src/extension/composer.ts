// Injected as one self-contained function. This adapter has no immediate-publish action.
export async function composerOperation(
  op: string,
  a: Record<string, any>,
  _state: Record<string, any>,
): Promise<Record<string, any>> {
  let dispatched = false;
  const fail = (code: string): never => {
    throw Error(code);
  };
  const clean = (s: string) =>
    s
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim();
  const visible = (e: Element) =>
    !!(e as HTMLElement).offsetParent || e.getClientRects().length > 0;
  const guard = () => {
    if (
      location.hostname !== "www.linkedin.com" ||
      !/^\/(feed(?:\/|$)|sharing\/compose(?:\/|$))/.test(location.pathname)
    )
      fail("open_feed_in_connected_tab");
    if (
      a.execution_session &&
      (window as any).__liBridgeSession !== a.execution_session
    )
      fail("cancelled");
    if (Date.now() > (a.execution_deadline ?? Infinity))
      fail("deadline_exceeded");
  };
  const wait = async <T>(
    read: () => T | undefined,
    code = "composer_not_ready",
  ): Promise<T> => {
    const until = Math.min(
      Date.now() + 10000,
      a.execution_deadline ?? Infinity,
    );
    for (;;) {
      guard();
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() >= until) fail(code);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const dialogs = () =>
    [
      ...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"]'),
    ].filter(visible);
  const label = (e: Element) =>
    clean(
      e.getAttribute("aria-label") ||
        (e.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim() ||
        e
          .querySelector(':scope > [aria-label="Start a post"]')
          ?.getAttribute("aria-label") ||
        e
          .querySelector(':scope > svg[aria-label="More options"]')
          ?.getAttribute("aria-label") ||
        e.textContent ||
        "",
    );
  const controls = (root: ParentNode, re: RegExp) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'button,a[href],[role="button"],[role="menuitem"],[role="menuitemradio"]',
      ),
    ].filter(
      (e) =>
        visible(e) &&
        !e.closest('[role="alert"]') &&
        re.test(label(e)) &&
        !(e as HTMLButtonElement).disabled &&
        e.getAttribute("aria-disabled") !== "true",
    );
  const find = (root: ParentNode, re: RegExp) => {
    const hits = controls(root, re);
    if (hits.length > 1) fail("composer_control_ambiguous");
    return hits[0];
  };
  const click = async (root: ParentNode, re: RegExp, mutation = false) => {
    const el = await wait(() => find(root, re), "composer_control_missing");
    guard();
    // Every click, including navigation, passes this prohibition.
    if (/^(Post|Posten|Veröffentlichen|Publish)(\s+now)?$/i.test(label(el)))
      fail("direct_publication_forbidden");
    if (mutation) dispatched = true;
    // LinkedIn uses history navigation when closing its own composer dialogs.
    // This narrow owner token never suppresses trusted user-interaction cancellation.
    if (a.execution_session)
      (window as any).__liBridgeComposerNavigation = a.execution_session;
    el.click();
  };
  const hash = async (s: string) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
      ),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const editorIn = (d: HTMLElement) =>
    d.querySelector<HTMLElement>(
      '[contenteditable="true"][role="textbox"],[contenteditable="true"]',
    );
  const editorText = (e: HTMLElement) =>
    clean(e.innerText ?? e.textContent ?? "");
  const activeComposer = () => {
    const hits = dialogs().filter((d) => !!editorIn(d));
    if (hits.length > 1) fail("composer_not_unique");
    return hits[0];
  };
  const actor = (d: HTMLElement) => {
    const name = a.verified_actor?.name;
    if (
      !name ||
      ![...d.querySelectorAll("[aria-label]")].some(
        (e) => e.getAttribute("aria-label") === name,
      )
    )
      fail("composer_actor_mismatch");
  };
  const openComposer = async () => {
    let d = activeComposer();
    if (!d) {
      const current = dialogs();
      if (current.length) {
        if (current.length !== 1) fail("composer_ui_conflict");
        if (current[0].querySelector('[data-sdui-screen$="ShareCompose"]')) {
          d = await wait(activeComposer);
        } else {
          if (!current[0].querySelector('[data-sdui-screen*="ShareSchedule"]'))
            fail("composer_ui_conflict");
          await click(current[0], /^(Dismiss|Close|Schließen)$/);
          await wait(() =>
            dialogs().length === 0 || activeComposer() ? true : undefined,
          );
          d = activeComposer();
        }
      }
      if (!d) {
        for (let attempt = 0; attempt < 2 && !d; attempt++) {
          await click(
            document,
            /^(Start a post|Beitrag beginnen|Beitrag erstellen)$/,
          );
          try {
            d = await wait(activeComposer, "composer_open_timeout");
          } catch (e) {
            // A fresh SDUI document may render its launcher before attaching handlers.
            // Retry only opening an untouched editor; never retry a save/schedule click.
            if (
              attempt ||
              dialogs().length ||
              !(e instanceof Error) ||
              e.message !== "composer_open_timeout"
            )
              throw e;
          }
        }
      }
    }
    // Let the native editor hydrate its saved content before inspecting or writing it.
    await new Promise((r) => setTimeout(r, 500));
    guard();
    if (!d) fail("composer_open_timeout");
    actor(d!);
    return d!;
  };
  const closeComposer = async (d: HTMLElement, save: boolean) => {
    await click(d, /^(Dismiss|Close|Schließen)$/);
    if (save) {
      const confirm = await wait(() =>
        dialogs().find((x) => !!find(x, /^(Save as draft|Entwurf speichern)$/)),
      );
      const previousAlerts = new Set(
        document.querySelectorAll('[role="alert"]'),
      );
      await click(confirm, /^(Save as draft|Entwurf speichern)$/, true);
      await wait(
        () =>
          [...document.querySelectorAll('[role="alert"]')].some(
            (e) =>
              !previousAlerts.has(e) &&
              /Draft successfully saved|Entwurf.*gespeichert/i.test(
                e.textContent ?? "",
              ),
          )
            ? true
            : undefined,
        "draft_save_unconfirmed",
      );
    }
    await wait(() => (dialogs().length === 0 ? true : undefined));
    // The feed launcher can remain stale until another feed refresh. Wait for
    // the completed save transition, then verify by reopening the native draft.
    if (save) await new Promise((r) => setTimeout(r, 500));
  };
  const fill = (e: HTMLElement, text: string) => {
    guard();
    e.focus();
    if (e instanceof HTMLInputElement)
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(e, text);
    else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(e);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // Chromium emits a trusted input event synchronously from execCommand.
      // Exempt only this exact target during the synchronous call, never user input.
      (window as any).__liBridgeOwnedInput = {
        token: a.execution_session,
        target: e,
      };
      try {
        if (!document.execCommand("insertText", false, text))
          fail("composer_input_failed");
      } finally {
        delete (window as any).__liBridgeOwnedInput;
      }
    }
    e.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    e.dispatchEvent(new Event("change", { bubbles: true }));
    e.blur();
  };
  const openTiming = async (d: HTMLElement) => {
    if (!find(d, /^(Scheduled(?: \(\d+\))?|Schedule post|Beitrag planen)$/)) {
      await click(d, /^(Expand content types|Weitere Inhaltstypen)$/);
    }
    await click(d, /^(Scheduled(?: \(\d+\))?|Schedule post|Beitrag planen)$/);
    return await wait(() =>
      dialogs().find(
        (x) => !!x.querySelector('input[placeholder="mm/dd/yyyy"]'),
      ),
    );
  };
  const openList = async () => {
    const existing = dialogs().find(
      (x) => !!x.querySelector('[data-sdui-screen$="ShareSchedulePostList"]'),
    );
    if (existing) return existing;
    const d = await openComposer();
    const timing = await openTiming(d);
    await click(timing, /^(Scheduled \(\d+\)|View all scheduled posts)$/);
    return await wait(() =>
      dialogs().find(
        (x) => !!x.querySelector('[data-sdui-screen$="ShareSchedulePostList"]'),
      ),
    );
  };
  const readList = async (d: HTMLElement) => {
    // SDUI can replace the loading dialog while hydrating its rows. Never keep
    // polling a detached snapshot, and never select an arbitrary duplicate.
    const currentList = () => {
      const candidates = dialogs().filter(
        (x) => !!x.querySelector('[data-sdui-screen$="ShareSchedulePostList"]'),
      );
      if (candidates.length > 1) fail("scheduled_list_ambiguous");
      if (!candidates.length) return false;
      d = candidates[0];
      return true;
    };
    await wait(() =>
      currentList() && !d.querySelector('[role="progressbar"]')
        ? true
        : undefined,
    );
    const countMatch =
      d.innerText?.match(/Scheduled \((\d+)\)/) ??
      d.textContent?.match(/Scheduled \((\d+)\)/);
    if (!countMatch) fail("scheduled_list_shape_changed");
    const count = Number(countMatch![1]);
    if (count === 0) return [];
    const rows = await wait(() => {
      if (!currentList()) return undefined;
      const currentCount = (d.innerText ?? d.textContent ?? "").match(
        /Scheduled \((\d+)\)/,
      )?.[1];
      if (Number(currentCount) !== count) fail("scheduled_list_changed");
      const mounted = [
        ...d.querySelectorAll<HTMLElement>('[id^="ScheduledPostRowSlot_"]'),
      ];
      if (
        mounted.length !== count ||
        mounted.some(
          (row) =>
            !row.querySelector('[role="listitem"] p')?.textContent?.trim() ||
            ![...row.querySelectorAll("p")].some((p) =>
              /^Posting .+ at .+[AP]M$/.test(p.textContent ?? ""),
            ),
        )
      )
        return undefined;
      return mounted;
    }, "scheduled_list_incomplete");
    const items: Record<string, any>[] = [];
    for (const row of rows) {
      const nativeId = row.id.match(
        /^ScheduledPostRowSlot_(urn:li:share:\d+)_/,
      )?.[1];
      const body = row.querySelector<HTMLElement>('[role="listitem"]');
      if (!nativeId || !body || body.querySelector("button"))
        fail("scheduled_row_shape_changed");
      const text = clean(
        [...body!.querySelectorAll("p")]
          .map((p) => p.innerText ?? p.textContent ?? "")
          .join("\n"),
      );
      const dates = [...row.querySelectorAll("p")].filter(
        (p) => !body!.contains(p) && /^Posting /.test(p.textContent ?? ""),
      );
      if (dates.length !== 1) fail("scheduled_row_shape_changed");
      const display = clean(dates[0].textContent ?? "");
      const match = display.match(
        /^Posting (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2} \d{1,2}, \d{4}) at (\d{1,2}:\d{2} [AP]M)$/,
      );
      const timestamp = match ? Date.parse(match[1] + " " + match[2]) : NaN;
      if (!text || !Number.isFinite(timestamp))
        fail("scheduled_row_shape_changed");
      items.push({
        text,
        text_hash: await hash(text),
        scheduled_at: new Date(timestamp).toISOString(),
        native_id: nativeId,
        element: row,
      });
    }
    if (items.length !== count) fail("scheduled_list_incomplete");
    return items;
  };
  const matching = (
    items: Record<string, any>[],
    target: Record<string, any>,
  ) =>
    items.filter(
      (x) =>
        x.text_hash === target.text_hash &&
        x.scheduled_at === target.scheduled_at &&
        (!target.native_id || x.native_id === target.native_id),
    );
  const publicItem = ({ element: _element, ...item }: Record<string, any>) =>
    item;
  try {
    guard();
    if (op === "scheduled_posts_list") {
      const items = await readList(await openList());
      return { items: items.map(publicItem), complete: true };
    }
    if (
      op === "scheduled_post_cancel" ||
      (op === "post_schedule" && a.reconcile)
    ) {
      const list = await openList();
      const items = await readList(list);
      const target = a.verified_target ?? a;
      const hits = matching(items, target);
      if (hits.length > 1) fail("scheduled_target_ambiguous");
      if (a.reconcile)
        return {
          verified:
            op === "post_schedule"
              ? hits.length === 1
              : !items.some((x) =>
                  target.native_id
                    ? x.native_id === target.native_id
                    : matching([x], target).length > 0,
                ),
          outcome: op === "post_schedule" ? "scheduled" : "schedule_cancelled",
          scheduled_item: hits[0] ? publicItem(hits[0]) : undefined,
        };
      if (hits.length !== 1) fail("scheduled_target_not_found");
      const row = hits[0].element as HTMLElement;
      const priorMenus = new Set(
        [...document.querySelectorAll('[role="menu"]')].filter(visible),
      );
      const priorDialogs = new Set(dialogs());
      await click(row, /^(More options|Weitere Optionen)$/);
      const menu = await wait(() => {
        const hits = [
          ...document.querySelectorAll<HTMLElement>('[role="menu"]'),
        ].filter((e) => visible(e) && !priorMenus.has(e));
        if (hits.length > 1) fail("scheduled_menu_ambiguous");
        return hits[0];
      });
      await click(menu, /^(Delete post|Beitrag löschen)$/);
      const confirm = await wait(() =>
        dialogs().find(
          (x) =>
            !priorDialogs.has(x) &&
            /Delete this post\?|Diesen Beitrag löschen/i.test(
              x.textContent ?? "",
            ) &&
            !!find(x, /^(Delete Post|Löschen)$/),
        ),
      );
      await click(confirm, /^(Delete Post|Löschen)$/, true);
      await wait(() =>
        !confirm.isConnected || !visible(confirm) ? true : undefined,
      );
      // The engine verifies absence from a freshly loaded native manager.
      return { verified: false, outcome: "schedule_cancelled" };
    }
    if (!["post_draft_create", "post_schedule"].includes(op))
      fail("unsupported_composer_operation");
    if (a.reconcile && activeComposer())
      fail("draft_reconciliation_requires_closed_composer");
    if (
      !a.reconcile &&
      /^Draft:|^Entwurf:/.test(
        document.querySelector("#draft-text-replaceable-component")
          ?.textContent ?? "",
      )
    )
      fail("existing_draft_conflict");
    let d = await openComposer();
    const editor = editorIn(d)!;
    const current = editorText(editor);
    if (a.reconcile)
      return {
        verified: (await hash(current)) === a.text_hash,
        outcome: "draft_saved",
      };
    if (current) fail("existing_draft_conflict");
    if (d.querySelector('img[data-media],video,[data-sdui-screen*="Media"]'))
      fail("unsupported_composer_attachment");
    // ProseMirror and the host UI commit editor transactions asynchronously.
    // Do not dismiss the editor in the same event-loop turn as input.
    fill(editor, a.text);
    await new Promise((r) => setTimeout(r, 500));
    await wait(
      () => (editorText(editor) === clean(a.text) ? true : undefined),
      "composer_text_mismatch",
    );
    if (op === "post_draft_create") {
      await closeComposer(d, true);
      d = await openComposer();
      // SDUI may reuse an empty editor instance immediately after saving.
      // Close only that empty instance, then reopen from the persisted draft.
      if (!editorText(editorIn(d)!)) {
        await closeComposer(d, false);
        d = await openComposer();
      }
      await wait(
        () => (editorText(editorIn(d)!) === clean(a.text) ? true : undefined),
        "draft_verification_failed",
      );
      await closeComposer(d, true);
      return {
        verified: true,
        outcome: "draft_saved",
        text_hash: await hash(clean(a.text)),
      };
    }
    const wanted = new Date(a.scheduled_at);
    const checkTime = () => {
      const max = new Date();
      max.setMonth(max.getMonth() + 3);
      if (
        !Number.isFinite(wanted.getTime()) ||
        wanted.getTime() % 60000 ||
        wanted.getTime() < Date.now() + 600000 ||
        wanted > max
      )
        fail("invalid_schedule_time");
    };
    checkTime();
    const timing = await openTiming(d);
    const date = timing.querySelector<HTMLInputElement>(
      'input[placeholder="mm/dd/yyyy"]',
    )!;
    const inputs = [...timing.querySelectorAll<HTMLInputElement>("input")];
    const time = inputs.find((x) => x !== date && x.type === "text");
    if (!time || inputs.length !== 2) fail("schedule_inputs_ambiguous");
    const dateText =
      wanted.getMonth() +
      1 +
      "/" +
      wanted.getDate() +
      "/" +
      wanted.getFullYear();
    const timeText = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(wanted);
    const stamp =
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(wanted) +
      ", " +
      timeText;
    fill(date, dateText);
    fill(time!, timeText);
    await wait(
      () =>
        clean(timing.innerText ?? timing.textContent ?? "").includes(
          "Posting at " + stamp,
        )
          ? true
          : undefined,
      "schedule_time_mismatch",
    );
    const option = find(
      timing,
      new RegExp("^" + timeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    );
    if (option?.getAttribute("role") === "menuitemradio")
      await click(
        timing,
        new RegExp("^" + timeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
      );
    if (new Date(date.value + " " + time!.value).getTime() !== wanted.getTime())
      fail("schedule_timezone_mismatch");
    await click(timing, /^(Confirm|Next|Bestätigen|Weiter)$/);
    d = await wait(activeComposer);
    actor(d);
    checkTime();
    if (
      editorText(editorIn(d)!) !== clean(a.text) ||
      !(d.innerText ?? d.textContent ?? "").includes("Posting at " + stamp)
    )
      fail("schedule_confirmation_mismatch");
    const previousAlerts = new Set(document.querySelectorAll('[role="alert"]'));
    await click(d, /^(Schedule|Planen)$/, true);
    await wait(
      () =>
        [...document.querySelectorAll('[role="alert"]')].some(
          (e) =>
            !previousAlerts.has(e) &&
            /Post scheduled\.|Beitrag.*geplant/i.test(e.textContent ?? ""),
        )
          ? true
          : undefined,
      "schedule_submission_unknown",
    );
    await wait(
      () => (!activeComposer() ? true : undefined),
      "schedule_submission_unknown",
    );
    // The engine verifies exact text/time against a fresh document, not SDUI cache.
    return { verified: false, outcome: "scheduled" };
  } catch (e) {
    return {
      bridge_error: e instanceof Error ? e.message : "composer_failed",
      dispatch_state: dispatched ? "dispatched" : "not_dispatched",
    };
  } finally {
    if ((window as any).__liBridgeComposerNavigation === a.execution_session)
      delete (window as any).__liBridgeComposerNavigation;
  }
}
