import {
  scanRelationshipInvitations,
  resolveRelationship,
} from "../core/relationships.js";
import { inspectDomSession } from "./dom-session.js";
import { personRef } from "../core/read-models.js";
import { readApi } from "../core/api.js";
import { prepareProfile } from "./profile-reader.js";
import { workTab } from "./work-tab.js";
import { composerOperation } from "./composer.js";
import { cursorEvictions } from "../core/cursor-budget.js";
import { retryAt } from "../core/errors.js";
import { Engine, Store } from "../core/engine.js";
import { Fault } from "../core/contracts.js";
import { self, normalize } from "../core/normalize.js";
import { pageFetch } from "./page-fetch.js";
import { firstDegreeConnection } from "./profile-state.js";
import { replyPermalink, visibleCommentProof } from "./comment-proof.js";
import { navigationTargetReached } from "./navigation.js";
import type { Request } from "../core/api.js";
import { VERSION, PROTOCOL, NATIVE_HOST as HOST } from "../version.js";
const area = (k: string) =>
  k.startsWith("identity:") ||
  k.startsWith("post-url:") ||
  k.startsWith("cursor:") ||
  k.startsWith("extraction:")
    ? chrome.storage.session
    : chrome.storage.local;
const store: Store = {
  get: async (k) => (await area(k).get(k))[k],
  set: async (k, v) => {
    if (k.startsWith("cursor:")) {
      const evict = cursorEvictions(
        await chrome.storage.session.get(null),
        k,
        v,
      );
      if (evict.length) await chrome.storage.session.remove(evict);
    }
    await area(k).set({ [k]: v });
  },
  remove: async (k) => area(k).remove(k),
};
let generation = 0;
let lastRequest = 0;
async function browserFetch(id: number, request: Request) {
  try {
    return await chrome.scripting.executeScript({
      injectImmediately: true,
      target: { tabId: id },
      world: "MAIN",
      func: pageFetch,
      args: [request],
    });
  } catch {
    // Injection may already have dispatched a write. Never retry it here.
    throw new Fault(
      request.method
        ? "browser_execution_unknown_outcome"
        : "browser_execution_failed",
    );
  }
}
async function documentReady(id: number, url: string) {
  try {
    const result = await chrome.scripting.executeScript({
      injectImmediately: true,
      target: { tabId: id },
      world: "ISOLATED",
      func: (expected: string) =>
        location.href === expected &&
        document.readyState !== "loading" &&
        !!document.body,
      args: [url],
    });
    return result[0]?.result === true;
  } catch {
    return false;
  }
}
const tabId = workTab({
  ready: documentReady,
  store,
  generation: () => generation,
  verify: async (id, account) => {
    const result = (await browserFetch(id, { path: "/me" }))[0]?.result;
    if (result?.error) throw new Fault(result.error);
    if (!result?.data) throw new Fault("empty_browser_response");
    if (self(result.data) !== account) throw new Fault("account_changed");
  },
  invalidate: async () => {
    const data = await chrome.storage.session.get(null);
    const keys = Object.keys(data).filter(
      (k) =>
        k.startsWith("extraction:") ||
        k.startsWith("post-url:") ||
        (k.startsWith("cursor:") && (data[k] as any)?.state?.dom_session),
    );
    if (keys.length) await chrome.storage.session.remove(keys);
  },
});
async function fetchRequest(r: Request, check = () => {}) {
  check();
  const requestGeneration = generation;
  const blocked = await store.get("blockedUntil");
  if (blocked > Date.now())
    throw new Fault("session_cooldown", "session_cooldown", {
      retry_at: new Date(blocked).toISOString(),
    });
  await new Promise((r) =>
    setTimeout(r, Math.max(0, lastRequest + 1000 - Date.now())),
  );
  lastRequest = Date.now();
  async function attempt() {
    const id = await tabId();
    if (generation !== requestGeneration) throw new Fault("cancelled");
    check();
    return browserFetch(id, r);
  }
  let out;
  try {
    out = await attempt();
  } catch (e) {
    // A tab may disappear after lookup. Replay only the API GET, not the
    // surrounding operation, cursor traversal, or any dispatched mutation.
    if (
      r.method ||
      !(e instanceof Fault) ||
      !["browser_execution_failed", "work_tab_unavailable"].includes(e.code)
    )
      throw e;
    out = await attempt();
  }
  if (generation !== requestGeneration) throw new Fault("cancelled");
  const result = out[0]?.result;
  if (result?.error) {
    if (result.error === "rate_limited" || result.error === "session_blocked")
      await store.set("blockedUntil", retryAt(result.retry_after, Date.now()));
    const retry = await store.get("blockedUntil");
    throw new Fault(
      result.error,
      result.error,
      retry > Date.now() ? { retry_at: new Date(retry).toISOString() } : {},
    );
  }
  if (!result || !Object.hasOwn(result, "data"))
    throw new Fault("empty_browser_response");
  const identities = normalize(result.data).entities;
  for (const p of identities) {
    const person = personRef(p);
    const urn = person.entityUrn;
    const name = person.name;
    if (typeof urn === "string" && /^urn:li:fsd_profile:/.test(urn) && name)
      await store.set("identity:" + urn, {
        ...(await store.get("identity:" + urn)),
        urn,
        name,
        ...(person.profile_url
          ? {
              profile_url: person.profile_url,
              public_identifier: person.public_identifier,
            }
          : {}),
      });
  }
  return result.data;
}
async function invalidateDocument() {
  const c = await store.get("connection");
  if (c?.tabId)
    await chrome.scripting
      .executeScript({
        injectImmediately: true,
        target: { tabId: c.tabId },
        world: "ISOLATED",
        func: () => {
          (window as any).__liBridgeSession = undefined;
        },
      })
      .catch(() => {});
}
async function validateDomCursor(_op: string, state: Record<string, any>) {
  if (!state.dom_session) return;
  const id = await tabId();
  if (id !== state.tab_id)
    throw new Fault("cursor_invalidated", "cursor_invalidated", {
      reason: "tab_changed",
    });
  const result = await chrome.scripting.executeScript({
    injectImmediately: true,
    target: { tabId: id },
    world: "ISOLATED",
    func: inspectDomSession,
    args: [state.dom_context ?? {}],
  });
  const reason =
    state.document_id && result[0]?.documentId !== state.document_id
      ? "document_changed"
      : result[0]?.result?.reason;
  if (reason || !result[0]?.result?.context)
    throw new Fault("cursor_invalidated", "cursor_invalidated", {
      reason: reason ?? "session_marker_missing",
    });
}
const engine = new Engine({
  generation: () => generation,
  identity: (urn) => store.get("identity:" + urn),
  cursorContext: validateDomCursor,
  store,
  fetch: fetchRequest,
  dom: async (op, a, state, check = () => {}) => {
    const id = await tabId();
    check();
    if (state.dom_session) await validateDomCursor(op, state);
    await chrome.tabs.update(id, { active: true });
    async function pageOperation(
      operation: string,
      args: Record<string, any>,
      cursor = {},
    ) {
      check();
      const loaded = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: "ISOLATED",
        files: ["page-adapters.js"],
        injectImmediately: true,
      });
      const documentId = loaded[0]?.documentId;
      return chrome.scripting.executeScript({
        target: documentId
          ? { tabId: id, documentIds: [documentId] }
          : { tabId: id },
        world: "ISOLATED",
        injectImmediately: true,
        func: (
          op: string,
          args: Record<string, any>,
          state: Record<string, any>,
        ) => (window as any).__liBridgeAdapters(op, args, state),
        args: [operation, args, cursor],
      });
    }
    async function navigate(url: string, fresh = false, postRedirect = false) {
      check();
      const tab = await chrome.tabs.get(id);
      if (
        tab.url === url &&
        !tab.pendingUrl &&
        tab.status === "complete" &&
        !fresh
      )
        return;
      // A fresh search clears SDUI filters that are not represented in the URL.
      if (tab.url === url && fresh) await chrome.tabs.reload(id);
      else await chrome.tabs.update(id, { url });
      for (let n = 0; n < 80; n++) {
        check();
        const current = await chrome.tabs.get(id);
        if (
          navigationTargetReached(current, url, tab.url, postRedirect) &&
          (current.status === "complete" ||
            (await documentReady(id, current.url!)))
        )
          return;
        if (current.url && /\/(login|checkpoint)/.test(current.url))
          throw new Fault("not_logged_in");
        await new Promise((r) => setTimeout(r, 250));
      }
      const last = await chrome.tabs.get(id);
      throw new Fault(
        "work_tab_navigation_timeout",
        "work_tab_navigation_timeout",
        {
          navigation: {
            expected_path: new URL(url).pathname,
            observed_path: last.url ? new URL(last.url).pathname : null,
            status: last.status,
            pending_path: last.pendingUrl
              ? new URL(last.pendingUrl).pathname
              : null,
          },
        },
      );
    }
    if (
      ["profile_get", "profile_posts_list", "relationship_get"].includes(op) &&
      !state.dom_session
    ) {
      const cached = a.profile_urn
        ? await store.get("identity:" + a.profile_urn)
        : undefined;
      const identifier =
        a.public_identifier ??
        cached?.public_identifier ??
        cached?.profile_url?.match(/\/in\/([^/?#]+)/)?.[1];

      const basic = (
        await readApi(
          "profile_get",
          identifier
            ? { public_identifier: identifier }
            : { profile_urn: a.profile_urn },
          {},
          (r) => fetchRequest(r, check),
        )
      ).profile;
      if (
        a.profile_urn &&
        basic.entityUrn?.replace("fs_miniProfile", "fsd_profile") !==
          a.profile_urn
      )
        throw new Fault("profile_identity_mismatch");
      basic.entityUrn = basic.entityUrn?.replace(
        "fs_miniProfile",
        "fsd_profile",
      );
      await navigate(basic.profile_url);
      await chrome.scripting.executeScript({
        injectImmediately: true,
        target: { tabId: id },
        world: "ISOLATED",
        func: () => {
          (window as any).__liBridgeSession = undefined;
        },
      });
      if (
        op === "profile_posts_list" ||
        (op === "profile_get" &&
          a.sections.some((s: string) =>
            ["about", "current_positions"].includes(s),
          ))
      )
        await chrome.scripting.executeScript({
          injectImmediately: true,
          target: { tabId: id },
          world: "ISOLATED",
          func: prepareProfile,
          args: [
            basic.profile_url,
            op === "profile_posts_list" ? "posts" : "sections",
          ],
        });
      let extra;
      for (let attempt = 0; attempt < 20; attempt++) {
        check();
        extra = (
          await pageOperation("profile_read", {
            profile_url: basic.profile_url,
            profile_urn: basic.entityUrn,
          })
        )[0]?.result;
        if (
          extra &&
          extra.bridge_error !== "profile_loading" &&
          (op !== "profile_posts_list" || extra.posts_url || extra.activity_url)
        )
          break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!extra || extra.bridge_error)
        throw new Fault(extra?.bridge_error ?? "profile_shape_changed");
      await store.set("identity:" + basic.entityUrn, {
        ...basic,
        posts_url: extra.posts_url,
      });
      if (op === "profile_get") {
        const all: Record<string, any> = {
          basic: { status: "available" },
          about: extra.about,
          current_positions: extra.current_positions,
          location: {
            status: basic.location ? "available" : extra.location!.status,
            text: basic.location ?? extra.location!.text,
          },
        };
        return {
          profile: {
            ...basic,
            sections: Object.fromEntries(
              a.sections.map((k: string) => [k, all[k]]),
            ),
          },
        };
      }
      if (op === "relationship_get") {
        const observed = (
          await pageOperation("profile_relationship", {
            profile_url: basic.profile_url,
            profile_urn: basic.entityUrn,
          })
        )[0]?.result;
        if (!observed || observed.bridge_error)
          throw new Fault(observed?.bridge_error ?? "profile_shape_changed");
        const scans = await scanRelationshipInvitations(
          a.profile_urn,
          (direction, cursor) =>
            readApi(
              "invitations_list",
              { account_urn: a.account_urn, direction, limit: 20 },
              cursor,
              (r) => fetchRequest(r, check),
            ),
        );
        return resolveRelationship(observed, scans);
      }
      if (!extra.posts_url && extra.activity_url) {
        await navigate(extra.activity_url);
        for (let n = 0; n < 12; n++) {
          const links = await chrome.scripting.executeScript({
            injectImmediately: true,
            target: { tabId: id },
            world: "ISOLATED",
            func: (profile: string) =>
              [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
                .filter(
                  (a) =>
                    /^(Posts|Beiträge)$/.test(a.textContent?.trim() ?? "") &&
                    a.href.startsWith(profile + "recent-activity/"),
                )
                .map((a) => a.href),
            args: [basic.profile_url],
          });
          const urls = [...new Set(links[0]?.result ?? [])];
          if (urls.length === 1) {
            extra.posts_url = urls[0];
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      if (!extra.posts_url)
        throw new Fault("profile_posts_location_unresolved");
      await navigate(extra.posts_url);
    }
    if (op === "feed_list" && !state.dom_session) {
      await navigate("https://www.linkedin.com/feed/");
    }
    if (op === "posts_search" && !state.dom_session) {
      await navigate(
        "https://www.linkedin.com/search/results/content/?keywords=" +
          encodeURIComponent(a.query) +
          "&origin=FACETED_SEARCH",
        true,
      );
    }
    if (op === "post_resolve" && a.url) {
      const url = new URL(a.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "www.linkedin.com" ||
        !/^\/(feed\/update\/urn:li:(activity|ugcPost|share):\d+\/?|posts\/[^/]+\/?)$/.test(
          decodeURIComponent(url.pathname),
        )
      )
        throw new Fault("post_url_unsupported");
      url.search = "";
      url.hash = "";
      await navigate(url.href);
    }
    if (
      op === "scheduled_posts_list" ||
      op === "scheduled_post_cancel" ||
      (op === "post_schedule" && a.reconcile)
    ) {
      // SDUI retains stale schedule lists across closing/reopening its modal.
      // Refresh only an empty editor/manager in our dedicated work tab.
      const stamp = crypto.randomUUID();
      const safe = await chrome.scripting.executeScript({
        injectImmediately: true,
        target: { tabId: id },
        world: "ISOLATED",
        func: (stamp: string) => {
          const dialogs = [
            ...document.querySelectorAll<HTMLElement>(
              'dialog[open],[role="dialog"]',
            ),
          ].filter((e) => e.getClientRects().length);
          if (
            dialogs.some(
              (d) =>
                [
                  ...d.querySelectorAll<HTMLElement>(
                    '[contenteditable="true"]',
                  ),
                ].some((e) => (e.innerText ?? e.textContent ?? "").trim()) ||
                d.querySelector("video,img[data-media]"),
            )
          )
            return false;
          document.documentElement.setAttribute(
            "data-li-planning-refresh",
            stamp,
          );
          return true;
        },
        args: [stamp],
      });
      if (safe[0]?.result !== true)
        throw new Fault(
          "close_existing_composer_before_listing",
          "close_existing_composer_before_listing",
          { dispatch_state: "not_dispatched" },
        );
      // A same-site reload can be intercepted by LinkedIn's navigation layer.
      // Cross the empty document first so cached SDUI state cannot survive.
      await chrome.tabs.update(id, { url: "about:blank" });
      let blankReady = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = await chrome.tabs.get(id);
        if (
          (!current.url || current.url === "about:blank") &&
          current.status === "complete"
        ) {
          blankReady = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!blankReady)
        throw new Fault(
          "schedule_blank_navigation_timeout",
          "schedule_blank_navigation_timeout",
          { dispatch_state: "not_dispatched" },
        );
      await chrome.tabs.update(id, { url: "https://www.linkedin.com/feed/" });
      let ready = false;
      let navigationDiagnostic: unknown;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((r) => setTimeout(r, 250));
        try {
          const fresh = await chrome.scripting.executeScript({
            injectImmediately: true,
            target: { tabId: id },
            world: "ISOLATED",
            func: (stamp: string) => ({
              fresh:
                document.documentElement.getAttribute(
                  "data-li-planning-refresh",
                ) !== stamp,
              path: location.pathname,
              state: document.readyState,
            }),
            args: [stamp],
          });
          navigationDiagnostic = fresh[0]?.result;
          if (
            fresh[0]?.result?.fresh &&
            /^\/(feed(?:\/|$)|sharing\/compose(?:\/|$))/.test(
              fresh[0].result.path,
            ) &&
            fresh[0].result.state !== "loading"
          ) {
            ready = true;
            break;
          }
        } catch (e) {
          navigationDiagnostic =
            e instanceof Error ? e.message : "navigation_interrupted";
          /* Navigation may temporarily destroy the old document. */
        }
      }
      if (ready) await new Promise((r) => setTimeout(r, 1000));
      if (!ready)
        throw new Fault(
          "schedule_refresh_timeout",
          "schedule_refresh_timeout",
          {
            dispatch_state: "not_dispatched",
            navigation: navigationDiagnostic,
          },
        );
    }
    if (op === "conversation_delete") {
      const target = a.verified_target;
      if (!target || target.entityUrn !== a.conversation_urn)
        throw new Fault("conversation_not_verified");
      const url = target.conversationUrl;
      if (
        typeof url !== "string" ||
        !url.startsWith("https://www.linkedin.com/messaging/thread/")
      )
        throw new Fault("conversation_location_unresolved");
      if ((await chrome.tabs.get(id)).url !== url)
        await chrome.tabs.update(id, { url });
    }
    if (["invitation_respond", "invitation_withdraw"].includes(op)) {
      if (!a.verified_target?.profile?.profile_url)
        throw new Fault("invitation_not_verified");
      const url =
        "https://www.linkedin.com/mynetwork/invitation-manager/" +
        (op === "invitation_withdraw" ? "sent/" : "received/");
      if ((await chrome.tabs.get(id)).url !== url)
        await chrome.tabs.update(id, { url });
    }
    if (
      [
        "post_draft_create",
        "post_schedule",
        "scheduled_posts_list",
        "scheduled_post_cancel",
      ].includes(op) &&
      !/^https:\/\/www\.linkedin\.com\/(feed(?:\/|$)|sharing\/compose(?:\/|$))/.test(
        (await chrome.tabs.get(id)).url ?? "",
      )
    )
      await chrome.tabs.update(id, { url: "https://www.linkedin.com/feed/" });
    for (
      let attempt = 0;
      (await chrome.tabs.get(id)).status !== "complete";
      attempt++
    ) {
      // Background resources may keep Chrome's tab status loading after the
      // document is interactive. Never accept the old document of a pending navigation.
      const loadingTab = await chrome.tabs.get(id);
      if (!loadingTab.pendingUrl) {
        const ready = await chrome.scripting.executeScript({
          injectImmediately: true,
          target: { tabId: id },
          world: "ISOLATED",
          func: () => document.readyState !== "loading" && !!document.body,
        });
        if (ready[0]?.result === true) break;
      }
      if (attempt >= 40)
        throw new Fault(
          "work_tab_navigation_timeout",
          "work_tab_navigation_timeout",
          { dispatch_state: "not_dispatched" },
        );
      await new Promise((r) => setTimeout(r, 250));
    }
    if (
      [
        "comments_list",
        "reactions_list",
        "post_get",
        "post_like",
        "post_comment",
      ].includes(op)
    ) {
      const url =
        (await store.get("post-url:" + a.post_urn)) ??
        (a.post_urn.startsWith("urn:li:activity:")
          ? "https://www.linkedin.com/feed/update/" + a.post_urn + "/"
          : undefined);
      const tab = await chrome.tabs.get(id);
      const target = await pageOperation("post_context", {
        post_urn: a.post_urn,
      });
      if (target[0]?.result?.bridge_error === "post_target_ambiguous")
        throw new Fault("post_target_ambiguous");
      if (!target[0]?.result?.matched && !url)
        throw new Fault("post_location_unresolved");
      if (!target[0]?.result?.matched && tab.url !== url) await navigate(url);
    }
    check();
    const session = state.dom_session ?? crypto.randomUUID();
    if (!state.dom_session) {
      await chrome.scripting.executeScript({
        injectImmediately: true,
        target: { tabId: id },
        world: "ISOLATED",
        func: (session: string) => {
          const w = window as any;
          for (const dialog of document.querySelectorAll<HTMLElement>(
            "[data-bridge-post]",
          )) {
            const dismiss = dialog.querySelector<HTMLElement>(
              'button[aria-label="Dismiss"],button[aria-label="Close"],button[aria-label="Schließen"],.artdeco-modal__dismiss',
            );
            if (dismiss) dismiss.click();
            else if (dialog.getClientRects().length) throw Error("ui_conflict");
          }
        },
        args: [session],
      });
      await pageOperation("session_begin", {
        token: session,
        preparing: op === "posts_search",
      });
    }
    check();
    const planning = [
      "post_draft_create",
      "post_schedule",
      "scheduled_posts_list",
      "scheduled_post_cancel",
    ].includes(op);
    const result = planning
      ? await chrome.scripting.executeScript({
          injectImmediately: true,
          target: { tabId: id },
          world: "ISOLATED",
          func: composerOperation,
          args: [op, { ...a, execution_session: session }, state],
        })
      : await pageOperation(op, { ...a, execution_session: session }, state);
    if (!result[0]?.result) throw new Fault("ui_operation_failed");
    if (result[0].result.bridge_error)
      throw new Fault(
        result[0].result.bridge_error,
        result[0].result.bridge_error,
        {
          ...result[0].result.details,
          dispatch_state: result[0].result.dispatch_state,
        },
      );
    let value = result[0].result;
    if (
      op === "post_comment" &&
      a.parent_comment_id &&
      value.verification_url &&
      value.receipt_id
    ) {
      // Verification can navigate, but must never repeat the submitted mutation.
      try {
        const observed = new URL(value.verification_url);
        if (
          observed.origin === "https://lnkd.in" &&
          /^\/p\/[\w-]+$/.test(observed.pathname)
        ) {
          await navigate(observed.href, false, true);
          const finalUrl = (await chrome.tabs.get(id)).url!;
          value.verification_error = "parent_permalink_mismatch";
          if (replyPermalink(finalUrl, a.parent_comment_id, value.receipt_id)) {
            value.verification_error = "reply_not_visible_on_permalink";
            for (let n = 0; n < 8; n++) {
              const proof = await chrome.scripting.executeScript({
                injectImmediately: true,
                target: { tabId: id },
                world: "ISOLATED",
                func: visibleCommentProof,
                args: [value.receipt_id, a.text, a.verified_actor.profile_url],
              });
              if (proof[0]?.result === true) {
                value.verified = true;
                value.parent_comment_id = a.parent_comment_id;
                value.parent_relation = "known";
                delete value.verification_error;
                break;
              }
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
      } catch (error) {
        /* Keep the observed receipt and unknown outcome; never resend. */
        value.verification_error =
          error instanceof Fault
            ? error.code
            : "reply_verification_unavailable";
      }
      delete value.verification_url;
    }
    if (op === "post_resolve" && value.resolve_url) {
      const observed = new URL(value.resolve_url);
      if (
        !(
          (observed.origin === "https://lnkd.in" &&
            /^\/p\/[\w-]+$/.test(observed.pathname)) ||
          (observed.origin === "https://www.linkedin.com" &&
            /^\/(feed\/update\/|posts\/)/.test(observed.pathname))
        )
      )
        throw new Fault("post_url_unsupported");
      await navigate(observed.href, false, true);
      const finalUrl = (await chrome.tabs.get(id)).url!;
      const resolved = await pageOperation(op, {
        url: finalUrl,
        expected_author: value.source_author,
        expected_text_prefix: value.source_text_prefix,
      });
      const resolvedValue = resolved[0]?.result;
      if (!resolvedValue || resolvedValue.bridge_error)
        throw new Fault(
          resolvedValue?.bridge_error ?? "post_identity_unavailable",
        );
      value = resolvedValue;
    }
    if (op === "invitation_respond" && a.action === "accept" && !a.preflight) {
      const profile = a.verified_target.profile;
      await chrome.tabs.update(id, { url: profile.profile_url });
      for (let attempt = 0; attempt < 40; attempt++) {
        const tab = await chrome.tabs.get(id);
        if (
          tab.status === "complete" &&
          tab.url?.replace(/\/$/, "") === profile.profile_url.replace(/\/$/, "")
        )
          break;
        await new Promise((r) => setTimeout(r, 250));
      }
      value.verified = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const proof = await chrome.scripting.executeScript({
          injectImmediately: true,
          target: { tabId: id },
          world: "ISOLATED",
          func: firstDegreeConnection,
          args: [profile.profile_url, profile.entityUrn],
        });
        if (proof[0]?.result === true) {
          value.verified = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      value.verification = value.verified
        ? "profile_first_degree"
        : "connection_state_unverified";
    }
    if (value.next) {
      const bound = await chrome.scripting.executeScript({
        injectImmediately: true,
        target: { tabId: id },
        world: "ISOLATED",
        func: inspectDomSession,
        args: [{ version: 1, token: session }],
      });
      const reason =
        result[0]?.documentId && result[0].documentId !== bound[0]?.documentId
          ? "document_changed"
          : bound[0]?.result?.reason;
      if (reason || !bound[0]?.result?.context)
        throw new Fault("cursor_invalidated", "cursor_invalidated", {
          reason: reason ?? "session_marker_missing",
        });
      value.next = {
        ...value.next,
        dom_session: session,
        tab_id: id,
        document_id: bound[0].documentId,
        dom_context: bound[0].result.context,
      };
    }
    for (const post of [value, ...(value.items ?? [])])
      if (post.entityUrn && post.url)
        for (const urn of new Set<string>([
          post.entityUrn,
          ...(post.observed_identities ?? []),
        ]))
          await store.set("post-url:" + urn, post.url);
    return value;
  },
  account: async () => {
    const c = await store.get("connection");
    return c?.account;
  },
  now: Date.now,
  uuid: () => crypto.randomUUID(),
  hash: async (text) =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
});
let port: chrome.runtime.Port | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1000;
let nativeError: string | undefined;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = undefined;
    if (await store.get("connection")) connectHost();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}
function connectHost() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
    const connectedPort = port;
    const active = new Set<string>();
    const cancelled = new Set<string>();
    port.onMessage.addListener(async (msg) => {
      reconnectDelay = 1000;
      nativeError = undefined;
      if (msg?.cancel) {
        if (active.has(msg.cancel)) cancelled.add(msg.cancel);
        return;
      }
      if (!msg || typeof msg.id !== "string" || typeof msg.op !== "string")
        return;
      if (active.has(msg.id)) return;
      active.add(msg.id);
      const current = connectedPort;
      try {
        if (msg.protocol !== PROTOCOL || msg.hostVersion !== VERSION)
          throw new Fault(
            "companion_version_mismatch",
            "Install the matching companion version " + VERSION,
          );
        const result = await engine.run(
          msg.op,
          msg.args,
          Math.min(Number(msg.deadline) || 0, Date.now() + 60000),
          () => port !== connectedPort || cancelled.has(msg.id),
        );
        if (
          new TextEncoder().encode(JSON.stringify(result)).byteLength >
          6 * 1024 * 1024
        )
          throw new Fault("response_too_large");
        if (port === current) current.postMessage({ id: msg.id, result });
      } catch (e) {
        if (port === current)
          current.postMessage({
            id: msg.id,
            error: {
              ...(e instanceof Fault ? e.details : {}),
              code: e instanceof Fault ? e.code : "operation_failed",
              message:
                e instanceof Fault
                  ? e.message
                  : "Operation failed validation or execution.",
            },
          });
      } finally {
        active.delete(msg.id);
        cancelled.delete(msg.id);
      }
    });
    port.onDisconnect.addListener(() => {
      nativeError =
        chrome.runtime.lastError?.message ?? "native_host_disconnected";
      if (port === connectedPort) port = undefined;
      scheduleReconnect();
    });
  } catch (e) {
    nativeError = e instanceof Error ? e.message : "native_host_connect_failed";
    port = undefined;
    scheduleReconnect();
  }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // Popup only. No content-script bridge or externally_connectable surface.
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("popup.html")
  )
    return;
  (async () => {
    await initialized;
    if (msg.action === "clear") {
      generation++;
      await invalidateDocument();
      await store.remove("connection");
      port?.disconnect();
      port = undefined;
      await chrome.storage.session.clear();
      await chrome.storage.local.clear();
      return { cleared: true };
    }
    if (msg.action === "open-work-tab") {
      await chrome.tabs.update(await tabId(), { active: true });
      return { opened: true };
    }
    if (msg.action === "status")
      return {
        connection: await store.get("connection"),
        native: !!port,
        nativeError,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        blockedUntil: await store.get("blockedUntil"),
      };
    if (msg.action === "connect") {
      generation++;
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/"))
        throw new Fault("open_linkedin_tab");
      await store.set("connection", { tabId: tab.id, paused: false });
      try {
        const account = self(await fetchRequest({ path: "/me" }));
        const previous = await store.get("workTabId");
        const existing = previous
          ? await chrome.tabs.get(previous).catch(() => undefined)
          : undefined;
        const work = existing?.url?.startsWith("https://www.linkedin.com/")
          ? existing
          : await chrome.tabs.create({
              url: "https://www.linkedin.com/feed/",
              active: false,
              windowId: tab.windowId,
            });
        if (!work.id) throw new Fault("work_tab_unavailable");
        await store.set("workTabId", work.id);
        await store.set("connection", {
          tabId: work.id,
          account,
          paused: false,
        });
        connectHost();
        return { account };
      } catch (e) {
        await store.remove("connection");
        throw e;
      }
    }
    if (msg.action === "pause") {
      generation++;
      await invalidateDocument();
      const c = await store.get("connection");
      if (c) await store.set("connection", { ...c, paused: true });
      return { paused: true };
    }
    if (msg.action === "disconnect") {
      generation++;
      await invalidateDocument();
      await store.remove("connection");
      port?.disconnect();
      port = undefined;
      return { disconnected: true };
    }
    throw new Fault("unknown_popup_action");
  })()
    .then(reply)
    .catch((e) =>
      reply({ error: e instanceof Fault ? e.code : "connection_failed" }),
    );
  return true;
});
chrome.alarms.create("host-reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async () => {
  const cursors = await chrome.storage.session.get(null);
  for (const [k, v] of Object.entries(cursors))
    if (
      (k.startsWith("cursor:") || k.startsWith("extraction:")) &&
      (v as { expires: number }).expires < Date.now()
    )
      await chrome.storage.session.remove(k);
  // Connection recovery must not wait behind a busy operation queue.
  if (await store.get("connection")) connectHost();
  await engine.expireReceipts();
});
const initialized = (async () => {
  if ((await store.get("schemaVersion")) !== 2) {
    generation++;
    await chrome.storage.session.clear();
    await chrome.storage.local.remove("allowInboxChanges");
    // Schema migration is independent of release version; compatible updates keep the binding.
    await store.set("schemaVersion", 2);
  }
  if (await store.get("connection")) connectHost();
})();
