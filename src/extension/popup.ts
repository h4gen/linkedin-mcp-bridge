const status = document.querySelector("#status")!;
async function action(action: string) {
  try {
    const r = await chrome.runtime.sendMessage({ action });
    status.textContent = JSON.stringify(r, null, 2);
  } catch {
    status.textContent =
      "Extension could not connect. See installation instructions.";
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-action]",
))
  button.addEventListener("click", () => void action(button.dataset.action!));
void action("status");
