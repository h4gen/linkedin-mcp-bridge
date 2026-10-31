import { workTab } from "./work-tab.js";
import { composerOperation } from "./composer.js";
import { cursorEvictions } from "../core/cursor-budget.js";
import { retryAt } from "../core/errors.js";
import { Engine, Store } from "../core/engine.js";
import { Fault } from "../core/contracts.js";
import { self, normalize } from "../core/normalize.js";
import { pageFetch } from "./page-fetch.js";
import { extractionOperation } from "./extraction.js";
import { firstDegreeConnection } from "./profile-state.js";
import { domOperation } from "./dom.js";
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
const tabId = workTab({
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
async function fetchRequest(r: Request) {
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
  const id = await tabId();
  if (generation !== requestGeneration) throw new Fault("cancelled");
  const out = await browserFetch(id, r);
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
    const urn = p.dashEntityUrn ?? p.entityUrn;
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
    if (typeof urn === "string" && /^urn:li:fsd_profile:/.test(urn) && name)
      await store.set("identity:" + urn, {
        urn,
        name,
        profile_url:
          typeof p.publicIdentifier === "string"
            ? "https://www.linkedin.com/in/" + p.publicIdentifier + "/"
            : null,
      });
  }
  return result.data;
}
async function invalidateDocument() {
  const c = await store.get("connection");
  if (c?.tabId)
    await chrome.scripting
      .executeScript({
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
  if (id !== state.tab_id) throw new Fault("cursor_invalidated");
  const check = await chrome.scripting.executeScript({
    target: { tabId: id },
    world: "ISOLATED",
    func: () =>
      (window as any).__liBridgeSessionPath ===
      location.pathname + location.search
        ? (window as any).__liBridgeSession
        : null,
  });
  if (check[0]?.result !== state.dom_session)
    throw new Fault("cursor_invalidated");
}
const engine = new Engine({
  generation: () => generation,
  identity: (urn) => store.get("identity:" + urn),
  cursorContext: validateDomCursor,
  store,
  fetch: fetchRequest,
  dom: async (op, a, state) => {
    const id = await tabId();
    if (state.dom_session) await validateDomCursor(op, state);
    await chrome.tabs.update(id, { active: true });
    if (
      op === "scheduled_posts_list" ||
      op === "scheduled_post_cancel" ||
      (op === "post_schedule" && a.reconcile)
    ) {
      // SDUI retains stale schedule lists across closing/reopening its modal.
      // Refresh only an empty editor/manager in our dedicated work tab.
      const stamp = crypto.randomUUID();
      const safe = await chrome.scripting.executeScript({
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
      const url = a.post_urn.startsWith("urn:li:activity:")
        ? "https://www.linkedin.com/feed/update/" + a.post_urn + "/"
        : await store.get("post-url:" + a.post_urn);
      const tab = await chrome.tabs.get(id);
      const target = await chrome.scripting.executeScript({
        target: { tabId: id },
        world: "ISOLATED",
        func: (urn: string) =>
          Array.from(
            document.querySelectorAll(
              "[data-mcp-post-urn],[data-urn],[data-id]",
            ),
          ).some((e) =>
            ["data-mcp-post-urn", "data-urn", "data-id"].some(
              (k) => e.getAttribute(k) === urn,
            ),
          ),
        args: [a.post_urn],
      });
      if (!target[0]?.result && !url)
        throw new Fault("post_location_unresolved");
      if (!target[0]?.result && tab.url !== url) {
        await chrome.tabs.update(id, { url });
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((r) => setTimeout(r, 250));
          const current = await chrome.tabs.get(id);
          if (current.status === "complete" && current.url === url) break;
          if (attempt === 39) throw new Fault("post_navigation_timeout");
        }
      }
    }
    const session = state.dom_session ?? crypto.randomUUID();
    if (!state.dom_session) {
      await chrome.scripting.executeScript({
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
          w.__liBridgeSession = session;
          w.__liBridgeSessionPath = location.pathname + location.search;
          if (!w.__liBridgeSessionGuard) {
            w.__liBridgeSessionGuard = true;
            document.addEventListener(
              "click",
              (event) => {
                if (
                  event.isTrusted &&
                  (event.target as Element)?.closest("button,a,[role=button]")
                )
                  w.__liBridgeSession = undefined;
              },
              true,
            );
          }
        },
        args: [session],
      });
    }
    const result = await chrome.scripting.executeScript({
      target: { tabId: id },
      world: "ISOLATED",
      func: ["comments_list", "reactions_list"].includes(op)
        ? extractionOperation
        : [
              "post_draft_create",
              "post_schedule",
              "scheduled_posts_list",
              "scheduled_post_cancel",
            ].includes(op)
          ? composerOperation
          : domOperation,
      args: [op, { ...a, execution_session: session }, state],
    });
    if (!result[0]?.result) throw new Fault("ui_operation_failed");
    if (result[0].result.bridge_error)
      throw new Fault(
        result[0].result.bridge_error,
        result[0].result.bridge_error,
        { dispatch_state: result[0].result.dispatch_state },
      );
    const value = result[0].result;
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
    if (value.next)
      value.next = { ...value.next, dom_session: session, tab_id: id };
    if (value.entityUrn && value.url)
      await store.set("post-url:" + value.entityUrn, value.url);
    for (const post of value.items ?? [])
      if (post.entityUrn && post.url)
        await store.set("post-url:" + post.entityUrn, post.url);
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
const cancelled = new Set<string>();
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
    port.onMessage.addListener(async (msg) => {
      reconnectDelay = 1000;
      nativeError = undefined;
      if (msg?.cancel) {
        cancelled.add(msg.cancel);
        return;
      }
      if (!msg || typeof msg.id !== "string" || typeof msg.op !== "string")
        return;
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
          () => cancelled.has(msg.id),
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
  await engine.expireReceipts();
  if (await store.get("connection")) connectHost();
});
const initialized = (async () => {
  if ((await store.get("schemaVersion")) !== 1) {
    generation++;
    await chrome.storage.session.clear();
    await chrome.storage.local.remove("allowInboxChanges");
    // Schema migration is independent of release version; compatible updates keep the binding.
    await store.set("schemaVersion", 1);
  }
  if (await store.get("connection")) connectHost();
})();
