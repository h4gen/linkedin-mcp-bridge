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
      !location.pathname.startsWith("/feed")
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
    clean(e.getAttribute("aria-label") || e.textContent || "");
  const controls = (root: ParentNode, re: RegExp) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'button,a[href],[role="button"],[role="menuitemradio"]',
      ),
    ].filter(
      (e) =>
        visible(e) &&
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
        if (
          current.length !== 1 ||
          !current[0].querySelector('[data-sdui-screen*="ShareSchedule"]')
        )
          fail("composer_ui_conflict");
        await click(current[0], /^(Dismiss|Close|Schließen)$/);
        await wait(() => (dialogs().length === 0 ? true : undefined));
      }
      await click(
        document,
        /^(Start a post|Beitrag beginnen|Beitrag erstellen)$/,
      );
      d = await wait(activeComposer);
    }
    actor(d);
    return d;
  };
  const closeComposer = async (d: HTMLElement, save: boolean) => {
    await click(d, /^(Dismiss|Close|Schließen)$/);
    if (save) {
      const confirm = await wait(() =>
        dialogs().find((x) => !!find(x, /^(Save as draft|Entwurf speichern)$/)),
      );
      await click(confirm, /^(Save as draft|Entwurf speichern)$/, true);
    }
    await wait(() => (!activeComposer() ? true : undefined));
  };
  const fill = (e: HTMLElement, text: string) => {
    guard();
    e.focus();
    if (e instanceof HTMLInputElement)
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(e, text);
    else e.textContent = text;
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
    if (!find(d, /^(Scheduled|Schedule post|Beitrag planen)$/)) {
      await click(d, /^(Expand content types|Weitere Inhaltstypen)$/);
    }
    await click(d, /^(Scheduled|Schedule post|Beitrag planen)$/);
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
    await wait(() =>
      !d.querySelector('[role="progressbar"]') ? true : undefined,
    );
    const countMatch =
      d.innerText?.match(/Scheduled \((\d+)\)/) ??
      d.textContent?.match(/Scheduled \((\d+)\)/);
    if (!countMatch) fail("scheduled_list_shape_changed");
    const count = Number(countMatch![1]);
    if (count === 0) return [];
    // Native row identity when exposed, otherwise exact visible text/time fingerprint.
    const rows = [
      ...d.querySelectorAll<HTMLElement>(
        '[data-scheduled-post], [data-urn], [data-id], li, [role="listitem"]',
      ),
    ].filter(
      (e) =>
        !!e.querySelector(
          'button[aria-label*="Delete"],button[aria-label*="More"],[data-scheduled-text]',
        ),
    );
    const minimal = rows.filter(
      (e) => !rows.some((other) => other !== e && e.contains(other)),
    );
    const items: Record<string, any>[] = [];
    for (const row of minimal) {
      const textNode = row.querySelector<HTMLElement>(
        "[data-scheduled-text],.scheduled-post-content",
      );
      const timeNode = row.querySelector("time,[data-scheduled-at]");
      const text = clean(textNode?.innerText ?? textNode?.textContent ?? "");
      const rawTime =
        timeNode?.getAttribute("datetime") ??
        timeNode?.getAttribute("data-scheduled-at");
      const timestamp = Date.parse(rawTime ?? "");
      if (!text || !Number.isFinite(timestamp))
        fail("scheduled_row_shape_changed");
      items.push({
        text,
        text_hash: await hash(text),
        scheduled_at: new Date(timestamp).toISOString(),
        native_id: row.getAttribute("data-urn") ?? row.getAttribute("data-id"),
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
        x.scheduled_at === target.scheduled_at,
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
            op === "post_schedule" ? hits.length === 1 : hits.length === 0,
          outcome: op === "post_schedule" ? "scheduled" : "schedule_cancelled",
          scheduled_item: hits[0] ? publicItem(hits[0]) : undefined,
        };
      if (hits.length !== 1) fail("scheduled_target_not_found");
      const row = hits[0].element as HTMLElement;
      if (!find(row, /^(Delete|Delete scheduled post|Löschen)$/))
        await click(row, /^(More|More options|Weitere Optionen)$/);
      const scope = find(row, /^(Delete|Delete scheduled post|Löschen)$/)
        ? row
        : list;
      await click(scope, /^(Delete|Delete scheduled post|Löschen)$/);
      const confirm = await wait(() =>
        dialogs().find(
          (x) =>
            /Delete scheduled post|Geplanten Beitrag löschen/i.test(
              x.innerText ?? x.textContent ?? "",
            ) && !!find(x, /^(Delete|Löschen)$/),
        ),
      );
      await click(confirm, /^(Delete|Löschen)$/, true);
      await wait(() =>
        !confirm.isConnected || !visible(confirm) ? true : undefined,
      );
      // Reopen the manager rather than treating a disappearing confirmation as success.
      await click(list, /^(Dismiss|Close|Schließen)$/);
      const refreshed = await readList(await openList());
      return {
        verified: matching(refreshed, target).length === 0,
        outcome: "schedule_cancelled",
      };
    }
    if (!["post_draft_create", "post_schedule"].includes(op))
      fail("unsupported_composer_operation");
    if (a.reconcile && activeComposer())
      fail("draft_reconciliation_requires_closed_composer");
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
    fill(editor, a.text);
    await wait(
      () => (editorText(editor) === clean(a.text) ? true : undefined),
      "composer_text_mismatch",
    );
    if (op === "post_draft_create") {
      await closeComposer(d, true);
      d = await openComposer();
      const verified = editorText(editorIn(d)!) === clean(a.text);
      if (!verified) fail("draft_verification_failed");
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
    await click(d, /^(Schedule|Planen)$/, true);
    await wait(
      () => (!activeComposer() ? true : undefined),
      "schedule_submission_unknown",
    );
    const items = await readList(await openList());
    const hits = matching(items, {
      text_hash: await hash(clean(a.text)),
      scheduled_at: wanted.toISOString(),
    });
    return {
      verified: hits.length === 1,
      outcome: "scheduled",
      scheduled_item: hits.length === 1 ? publicItem(hits[0]) : undefined,
    };
  } catch (e) {
    return {
      bridge_error: e instanceof Error ? e.message : "composer_failed",
      dispatch_state: dispatched ? "dispatched" : "not_dispatched",
    };
  }
}
