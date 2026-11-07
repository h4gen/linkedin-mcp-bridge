import type { Args } from "../core/contracts.js";

// Follow only a profile's own first-party compose link. No inferred deep links,
// other recipients, redirect parameters, feed overlays or premium sales surfaces.
export function composeRoute(href: string, peer: string) {
  try {
    const u = new URL(href);
    return (
      u.origin === "https://www.linkedin.com" &&
      !u.username &&
      !u.password &&
      /^\/messaging\/compose\/?$/.test(u.pathname) &&
      !u.hash &&
      u.searchParams.getAll("profileUrn").length === 1 &&
      u.searchParams.get("profileUrn") === peer &&
      (!u.searchParams.has("recipient") ||
        (u.searchParams.getAll("recipient").length === 1 &&
          u.searchParams.get("recipient") === peer.split(":").at(-1))) &&
      (!u.searchParams.has("interop") ||
        u.searchParams.get("interop") === "msgOverlay") &&
      (!u.searchParams.has("screenContext") ||
        u.searchParams.get("screenContext") === "NON_SELF_PROFILE_VIEW") &&
      [...u.searchParams.keys()].every((k) =>
        [
          "profileUrn",
          "recipient",
          "interop",
          "screenContext",
          "messageComposeFlowTrackingId",
          "controlUrn",
          "referringModuleKey",
          "trk",
        ].includes(k),
      )
    );
  } catch {
    return false;
  }
}
const visible = (e: Element) => !!e.getClientRects().length;
const shown = <T extends Element>(root: ParentNode, selector: string) =>
  [...root.querySelectorAll<T>(selector)].filter(visible);
const label = (e: Element) =>
  (e.getAttribute("aria-label") || e.textContent || "").trim();
function inspect(a: Args) {
  if (!composeRoute(location.href, a.profile_urn))
    throw Error("composer_route_mismatch");
  const blocking = shown<HTMLElement>(document, "[role=dialog],dialog[open]");
  if (blocking.length) {
    const premium =
      blocking.length === 1 &&
      shown<HTMLAnchorElement>(blocking[0], "a[href]").some((link) => {
        try {
          const u = new URL(link.href);
          const dest = u.searchParams.get("destRedirectURL");
          return (
            u.hostname === "www.linkedin.com" &&
            u.pathname === "/premium/products/" &&
            u.searchParams.get("upsellSlotId") === "PROFILE_MESSAGE_ACTION" &&
            !!dest &&
            composeRoute(dest, a.profile_urn)
          );
        } catch {
          return false;
        }
      });
    if (premium)
      return {
        cost: "credits_required",
        reason: "premium_subscription_required",
        editor: null,
        button: null,
      };
    throw Error("composer_dialog_blocked");
  }
  const main = shown<HTMLElement>(document, "main,[role=main]").filter(
    (e, i, all) => !all.some((other) => other !== e && other.contains(e)),
  );
  if (main.length !== 1) throw Error("composer_unavailable");
  const editors = shown<HTMLElement>(
    main[0],
    "[contenteditable=true],textarea",
  ).filter(
    (e) =>
      !e.closest(".msg-overlay-conversation-bubble,[role=dialog]") &&
      !e.matches("[name=subject]"),
  );
  if (editors.length !== 1) throw Error("composer_body_not_unique");
  const editor = editors[0];
  const pane =
    editor.closest<HTMLElement>(
      ".msg-inmail-compose-form-v2,.msg-compose,.msg-inmail-compose-form,.msg-convo-wrapper",
    ) ?? editor.closest<HTMLElement>("form");
  if (!pane) throw Error("composer_unavailable");
  // Recipient chips and the recipient header are identity evidence, never links inside history/body.
  const recipientRoots = shown<HTMLElement>(
    pane,
    '.msg-compose__inmail-compose-entity-lockup,.msg-compose__recipient,.msg-compose__recipient-pill,.msg-compose__recipient-list,.msg-compose__profile-card,.msg-form__recipient,.artdeco-pill--blue,[data-view-name="message-recipient"]',
  ).filter(
    (e) =>
      !e.closest(
        ".msg-overlay-conversation-bubble,[role=log],.msg-s-message-list,[contenteditable=true]",
      ),
  );
  if (!recipientRoots.length) throw Error("composer_recipient_unverified");
  const people = new Set<string>();
  const normalizePath = (s: string) =>
    new URL(s, location.origin).pathname.replace(/\/$/, "");
  for (const root of recipientRoots) {
    const refs = [
      root,
      ...root.querySelectorAll("a[href],[data-entity-urn],[data-profile-urn]"),
    ];
    let identified = false;
    for (const e of refs) {
      const urn =
        e.getAttribute("data-profile-urn") ?? e.getAttribute("data-entity-urn");
      if (urn?.startsWith("urn:li:fsd_profile:")) {
        people.add(urn);
        identified = true;
      }
      if (e instanceof HTMLAnchorElement && e.pathname.startsWith("/in/")) {
        if (
          e.origin !== location.origin ||
          normalizePath(e.href) !== normalizePath(a.profile_url)
        )
          throw Error("recipient_mismatch");
        people.add(a.profile_urn);
        identified = true;
      }
    }
    if (!identified) throw Error("composer_recipient_unverified");
  }
  if (people.size !== 1 || !people.has(a.profile_urn))
    throw Error("recipient_mismatch");
  const controls = shown<HTMLButtonElement>(
    pane,
    "button,[role=button]",
  ).filter((b) =>
    /^(?:Send|Send message|Senden|Nachricht senden)$/i.test(label(b)),
  );
  if (controls.length !== 1) throw Error("composer_send_control_not_unique");
  // The native rate line is outside the editable form and recipient profile.
  // Its text node contains "Free message |" followed by the separate Why? link.
  const priceRows = shown<HTMLElement>(pane, "p").filter(
    (e) =>
      !e.closest(
        "[contenteditable],textarea,aside,nav,[role=log],[role=listitem],.msg-compose__inmail-compose-entity-lockup,.msg-s-message-list,.msg-overlay-conversation-bubble,.msg-s-event-listitem",
      ),
  );
  const labels = priceRows.map((e) =>
    [...e.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent?.trim())
      .join(" ")
      .trim()
      .replace(/\s*\|\s*$/, ""),
  );
  const free = priceRows.some(
    (p, i) =>
      /^(Free message|Kostenlose Nachricht|Gratisnachricht)$/i.test(
        labels[i],
      ) &&
      shown<HTMLAnchorElement>(p, "a[href]").some((a) =>
        /^(Why|Warum|Wieso)\??$/i.test(label(a)),
      ),
  );
  const paid = labels.some((s) =>
    /(?:\b(?:use|uses|costs?|requires?)\b.*\bcredit|\b\d+\s+(?:InMail[- ]?)?Credits?\b|InMail[- ]Guthaben|Credit verwenden)/i.test(
      s,
    ),
  );
  return {
    pane,
    editor,
    reason: "verified_recipient_composer",
    button: controls[0],
    cost:
      free && !paid ? "free" : paid && !free ? "credits_required" : "unknown",
  };
}
export async function messageComposer(a: Args) {
  let clicked = false;
  try {
    const x = inspect(a);
    if (!a.dispatch)
      return { cost: x.cost, reason: x.reason, profile_urn: a.profile_urn };
    const { editor, button } = x;
    if (!editor || !button || x.cost !== "free")
      throw Error("composer_conditions_changed");
    const guard = () => {
      if (
        !a.execution_session ||
        (window as any).__liBridgeSession !== a.execution_session ||
        Date.now() >= a.execution_deadline
      )
        throw Error("composer_session_changed");
      const y = inspect(a);
      if (y.cost !== "free" || y.editor !== x.editor || y.button !== x.button)
        throw Error("composer_conditions_changed");
    };
    guard();
    const value = () => {
      if (editor instanceof HTMLTextAreaElement) return editor.value;
      const lines = [...editor.childNodes];
      // Chromium can render a blank <p><br></p> as three visual newlines in
      // innerText. LinkedIn's editor represents each paragraph as one line.
      if (
        lines.length &&
        lines.every(
          (e) => e instanceof HTMLElement && /^(P|DIV)$/.test(e.tagName),
        )
      ) {
        return lines
          .map((n) => {
            const line = n as HTMLElement;
            if (
              line.childNodes.length === 1 &&
              line.firstChild?.nodeName === "BR"
            )
              return "";
            return line.innerText ?? line.textContent ?? "";
          })
          .join("\n");
      }
      return editor.innerText ?? editor.textContent ?? "";
    };
    const hasExtras = () =>
      !!x.pane?.querySelector(
        ".msg-form__attachment-item,.msg-form__attachment-preview",
      ) ||
      [
        ...(x.pane?.querySelectorAll<HTMLInputElement>("input[type=file]") ??
          []),
      ].some((input) => input.files?.length) ||
      shown<HTMLInputElement>(
        x.pane!,
        "input[name=subject],textarea[name=subject]",
      ).some((input) => input.value.trim());
    if (value().trim() || hasExtras()) throw Error("composer_existing_draft");
    if (editor instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(editor, a.text);
    } else {
      editor.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(editor);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      (window as any).__liBridgeOwnedInput = {
        token: a.execution_session,
        target: editor,
      };
      try {
        if (!document.execCommand("insertText", false, a.text))
          throw Error("composer_input_failed");
      } finally {
        delete (window as any).__liBridgeOwnedInput;
      }
    }
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: a.text,
        inputType: "insertText",
      }),
    );
    for (
      let n = 0;
      n < 10 && button.matches(":disabled,[aria-disabled=true]");
      n++
    ) {
      guard();
      await new Promise((r) => setTimeout(r, 100));
    }
    guard();
    if (
      hasExtras() ||
      value().replace(/\r\n/g, "\n") !== a.text.replace(/\r\n/g, "\n") ||
      button.matches(":disabled,[aria-disabled=true]")
    )
      throw Error("composer_message_not_ready");
    // Single synchronous click, no keyboard or API fallback. Verification is read-only.
    clicked = true;
    const clicked_at = Date.now();
    button.click();
    return { dispatch_state: "dispatched", clicked_at };
  } catch (e) {
    const reasons = [
      "composer_dialog_blocked",
      "composer_route_mismatch",
      "composer_unavailable",
      "composer_body_not_unique",
      "composer_recipient_unverified",
      "recipient_mismatch",
      "composer_send_control_not_unique",
      "composer_session_changed",
      "composer_conditions_changed",
      "composer_existing_draft",
      "composer_input_failed",
      "composer_message_not_ready",
    ];
    const reason = (e as Error).message;
    return {
      cost: "unknown",
      reason: reasons.includes(reason) ? reason : "composer_unavailable",
      ...(a.dispatch
        ? {
            bridge_error: reasons.includes(reason)
              ? reason
              : "composer_unavailable",
            dispatch_state: clicked ? "unknown" : "not_dispatched",
          }
        : {}),
    };
  }
}
