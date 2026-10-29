const status = document.querySelector("#status")!;
const actions = document.querySelector("#actions")!;
async function refresh() {
  const result = await chrome.runtime.sendMessage({ action: "approvals" });
  actions.replaceChildren();
  for (const row of result.items ?? []) {
    const article = document.createElement("article");
    const heading = document.createElement("h2");
    heading.textContent = row.operation.replaceAll("_", " ");
    const data = document.createElement("pre");
    data.textContent = JSON.stringify(row.args, null, 2);
    article.append(heading, data);
    for (const approve of [true, false]) {
      const button = document.createElement("button");
      button.textContent = approve ? "Confirm and execute once" : "Reject";
      button.disabled = row.status !== "approval_required";
      button.onclick = async () => {
        article.querySelectorAll("button").forEach((b) => (b.disabled = true));
        try {
          const r = await chrome.runtime.sendMessage({
            action: "decide",
            key: row.key,
            id: row.id,
            approve,
          });
          status.textContent = r.error ?? r.status ?? "Action checked";
        } catch {
          status.textContent =
            "Connection interrupted. Check the operation receipt before retrying.";
        }
        await refresh();
      };
      article.append(button);
    }
    actions.append(article);
  }
  if (!actions.children.length) actions.textContent = "No pending actions.";
  const s = await chrome.runtime.sendMessage({ action: "status" });
  document.querySelector<HTMLInputElement>("#inbox")!.checked =
    s.allowInboxChanges;
}
document
  .querySelector("#refresh")!
  .addEventListener("click", () => void refresh());
document
  .querySelector<HTMLInputElement>("#inbox")!
  .addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({
      action: "inbox-permission",
      enabled: (e.target as HTMLInputElement).checked,
    });
  });
document.querySelector("#clear")!.addEventListener("click", async () => {
  if (
    !confirm(
      "Disconnect and delete all local bridge data? Previous send receipts will no longer prevent duplicates.",
    )
  )
    return;
  await chrome.runtime.sendMessage({ action: "clear" });
  await refresh();
  status.textContent = "Disconnected. Local data cleared.";
});
void refresh();
