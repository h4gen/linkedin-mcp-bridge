const status = document.querySelector("#status")!;
async function action(action: string) {
  try {
    if (
      action === "connect" &&
      !document.querySelector<HTMLInputElement>("#consent")?.checked
    ) {
      status.textContent =
        "Please acknowledge the data flow before connecting.";
      return;
    }
    if (
      action === "clear" &&
      !confirm(
        "Disconnect and delete all local bridge data? Previous send receipts will no longer prevent duplicates.",
      )
    )
      return;
    const r = await chrome.runtime.sendMessage({ action });
    if (r.error) {
      status.textContent = r.error;
      return;
    }
    const s = await chrome.runtime.sendMessage({ action: "status" });
    status.textContent = s.connection
      ? `${s.connection.paused ? "Paused" : "Connected"} · ${s.connection.account ?? "Checking account"}\nCompanion: ${s.native ? "available" : "not connected"} · Version ${s.version}`
      : "Not connected. Open LinkedIn and connect this tab.";
  } catch {
    status.textContent =
      "Connection unavailable. Check that the companion is installed and LinkedIn is open.";
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>(
  "button[data-action]",
))
  b.addEventListener("click", () => void action(b.dataset.action!));
void action("status");
