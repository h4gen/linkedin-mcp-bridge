import { agentInstructions, type SetupClient } from "../setup.js";
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const primary = el<HTMLButtonElement>("primary"),
  choice = el<HTMLSelectElement>("client");
let state: any,
  next = "copy",
  busy = false;
choice.value =
  localStorage.getItem("setupClient") === "claude" ? "claude" : "codex";
choice.addEventListener("change", () =>
  localStorage.setItem("setupClient", choice.value),
);
function render(s: any) {
  const previousView = next;
  state = s;
  const c = s.connection;
  let title = "LinkedIn, connected to your AI.",
    description =
      "Copy the instructions into your agent. It handles installation and checks the connection for you.",
    label = "Copy setup instructions",
    step = "LET YOUR AGENT HANDLE THE SETUP";
  next = "copy";
  if (c?.paused) {
    title = "LinkedIn is paused.";
    description = "Your agent cannot access LinkedIn until you resume.";
    label = "Resume";
    next = "resume";
  } else if (s.setupIntent === "off") {
    title = "LinkedIn is disconnected.";
    description =
      "Enable the connection when you want to use LinkedIn with your agent again.";
    label = "Enable connection";
    next = "resume";
  } else if (
    !s.nativeReady &&
    (s.hostVersion || c || s.nativeError === "native_handshake_unavailable")
  ) {
    title = "Let's restore the connection.";
    description =
      s.nativeError === "companion_version_mismatch"
        ? "Your extension and local server need matching versions. Give your agent the update instructions."
        : "The local connection is unavailable. Recovery runs automatically; your agent can check the installation.";
    label = "Copy repair instructions";
    next = "repair";
  } else if (s.setupError === "account_changed") {
    title = "Your LinkedIn account changed.";
    description =
      "The previous account stays connected until you choose to use the account currently signed in to LinkedIn.";
    label = "Use current LinkedIn account";
    next = "use-current-account";
  } else if (
    s.nativeReady &&
    /not_logged_in|session_blocked/.test(s.setupError ?? "")
  ) {
    title = "Sign in to LinkedIn.";
    description =
      "Your local server is ready. Open LinkedIn and sign in; we'll connect automatically.";
    label = "Open LinkedIn";
    next = "open-linkedin";
  } else if (s.nativeReady && s.setupError) {
    title = "LinkedIn needs attention.";
    description =
      "Open LinkedIn to check its sign-in state. If it already looks right, give your agent the repair instructions in Settings.";
    label = "Open LinkedIn";
    next = "open-linkedin";
  } else if (s.nativeReady && c?.account) {
    title = "Ready for your agent.";
    description =
      (c.accountName
        ? `Connected as ${c.accountName}. `
        : "LinkedIn is connected. ") +
      "Continue in your agent. If you just installed the server, start a new chat or restart the client if it hasn't loaded the tools yet.";
    next = "ready";
    step = "YOU'RE ALL SET";
  } else if (s.nativeReady) {
    title = "Connecting LinkedIn…";
    description =
      "Your local server is ready. We're checking your LinkedIn sign-in.";
    label = "Open LinkedIn";
    next = "open-linkedin";
  }
  if (previousView !== next) el("feedback").textContent = "";
  el("title").textContent = title;
  el("description").textContent = description;
  el("step").textContent = step;
  primary.textContent = label;
  primary.hidden = next === "ready";
  el("client-choice").hidden =
    !["copy", "repair"].includes(next) &&
    !el<HTMLDetailsElement>("settings").open;
  const toggle = el<HTMLButtonElement>("toggle");
  toggle.textContent = c && !c.paused ? "Pause" : "Resume";
  toggle.dataset.action = c && !c.paused ? "pause" : "resume";
  el("diagnostics").textContent = JSON.stringify(
    {
      version: s.version,
      channel: s.channel,
      hostVersion: s.hostVersion,
      nativeReady: s.nativeReady,
      connection: c ? (c.paused ? "paused" : "bound") : "disconnected",
      error: s.setupError ?? s.nativeError,
    },
    null,
    2,
  );
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    el("feedback").textContent = "Copied. Paste this into your agent.";
  } catch {
    el("feedback").textContent = "Copy the instructions below into your agent.";
    let area = document.querySelector<HTMLTextAreaElement>("#copy-fallback");
    if (!area) {
      area = document.createElement("textarea");
      area.id = "copy-fallback";
      area.rows = 12;
      area.style.width = "100%";
      el("feedback").after(area);
    }
    area.value = text;
    area.focus();
    area.select();
  }
}
function instructions(task: "install" | "repair" | "uninstall" = "install") {
  return agentInstructions(
    choice.value as SetupClient,
    state?.extensionId ?? chrome.runtime.id,
    task,
  );
}
async function refresh(check = false) {
  if (check) await chrome.runtime.sendMessage({ action: "check-setup" });
  render(await chrome.runtime.sendMessage({ action: "status" }));
}
async function action(name: string) {
  if (busy) return;
  busy = true;
  primary.disabled = true;
  try {
    if (name === "copy" || name === "repair") {
      await copy(instructions(name === "repair" ? "repair" : "install"));
      return;
    }
    if (
      name === "clear" &&
      !confirm(
        "Disconnect and clear local data? Saved duplicate-send protection will be removed. Content already sent to your AI client is not erased.",
      )
    )
      return;
    const r = await chrome.runtime.sendMessage({ action: name });
    if (r.error)
      el("feedback").textContent =
        "That step couldn't finish. Open Settings and copy the repair instructions for your agent.";
    await refresh();
  } catch {
    el("feedback").textContent =
      "The extension updated or restarted. Reload this page to continue.";
  } finally {
    busy = false;
    primary.disabled = false;
  }
}
primary.addEventListener("click", () => void action(next));
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-action]"))
  b.addEventListener("click", () => void action(b.dataset.action!));
el("copy-setup").addEventListener("click", () => void copy(instructions()));
el("copy-remove").addEventListener(
  "click",
  () => void copy(instructions("uninstall")),
);
el("copy-diagnostics").addEventListener(
  "click",
  () => void copy(el("diagnostics").textContent ?? ""),
);
const repair = document.createElement("button");
repair.textContent = "Copy repair instructions";
repair.addEventListener("click", () => void copy(instructions("repair")));
el("advanced").querySelector(".advanced-body")!.prepend(repair);
el("settings").addEventListener("toggle", () => {
  if (state) render(state);
});
window.addEventListener("focus", () => void refresh(true).catch(() => {}));
void refresh()
  .then(() => refresh(true))
  .catch(() => {
    el("description").textContent =
      "Reload this page to reconnect to the extension.";
  });
setInterval(() => {
  if (!document.hidden) void refresh().catch(() => {});
}, 2000);
