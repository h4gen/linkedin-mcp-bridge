const status = document.querySelector("#status")!;
const actions = document.querySelector("#actions")!;
async function refresh() {
  const result = await chrome.runtime.sendMessage({ action: "approvals" });
  actions.replaceChildren();
  for (const row of result.items ?? []) {
    const article = document.createElement("article");
    const heading = document.createElement("h2");
    heading.textContent = row.operation.replaceAll("_", " ");
    const body = document.createElement("pre");
    body.textContent =
      row.args?.text ?? row.args?.note ?? row.args?.action ?? "";
    const account = document.createElement("p");
    account.textContent = "Account: " + (row.args?.account_urn ?? "");
    article.append(heading, account);
    const recipients =
      row.args?.expected_participant_urns ??
      (row.args?.profile_urn ? [row.args.profile_urn] : []);
    for (const urn of recipients) {
      const line = document.createElement("p");
      line.append("Recipient: ");
      const link = document.createElement("a");
      link.href = "https://www.linkedin.com/in/" + urn.split(":").pop() + "/";
      link.textContent = "Open recipient profile";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      line.append(link);
      article.append(line);
    }
    article.append(body);
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Exact identifiers and request";
    const data = document.createElement("pre");
    data.textContent = JSON.stringify(row.args, null, 2);
    details.append(summary, data);
    article.append(details);
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
  const jobs = document.querySelector("#extractions")!;
  jobs.replaceChildren();
  for (const row of s.extractions ?? []) {
    const p = document.createElement("p");
    p.textContent = `${row.kind}: ${row.count} results · ${row.status}`;
    if (row.status === "running") {
      const stop = document.createElement("button");
      stop.textContent = "Stop";
      stop.onclick = async () => {
        await chrome.runtime.sendMessage({
          action: "cancel-extraction",
          id: row.id,
        });
        await refresh();
      };
      p.append(stop);
    }
    jobs.append(p);
  }
  if (!jobs.children.length)
    jobs.textContent = "No extraction jobs in this session.";
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
