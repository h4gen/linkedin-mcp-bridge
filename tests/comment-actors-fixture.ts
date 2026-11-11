// Anonymized structural fixture of the native SDUI picker observed 2026-11-11.
export const fixtureActors = [
  {
    type: "person",
    name: "Me",
    profile_url: "https://www.linkedin.com/in/me",
    avatar:
      "https://media.licdn.com/dms/image/v2/person/profile-displayphoto-scale_100_100/0/1",
  },
  {
    type: "company",
    name: "Example Company",
    profile_url: "https://www.linkedin.com/company/example",
    avatar:
      "https://media.licdn.com/dms/image/v2/company/company-logo_100_100/0/2",
  },
];
export function installActorPicker(
  w: any,
  scope?: Element,
  actors = fixtureActors,
) {
  const doc = w.document as Document;
  scope ??= doc.querySelector('[data-urn^="urn:li:activity:"]')!;
  if (!scope) return;
  let active = actors[0];
  const links = doc.createElement("aside");
  links.setAttribute("aria-label", "Sidebar");
  for (const actor of actors) {
    const link = doc.createElement("a");
    link.href = actor.profile_url;
    link.innerHTML = `<img src="${actor.avatar}" alt="${actor.name}"><p>${actor.name}</p>`;
    links.append(link);
  }
  doc.body.append(links);
  const trigger = doc.createElement("a");
  trigger.href = "#";
  trigger.innerHTML = `<div aria-label="Switch to different account"><img src="${active.avatar}"></div>`;
  scope.append(trigger);
  trigger.onclick = (event) => {
    event.preventDefault();
    const dialog = doc.createElement("dialog");
    dialog.open = true;
    dialog.innerHTML =
      '<h2>Comment, react, and repost as</h2><div role="radiogroup"></div><button>Cancel</button><button>Save</button>';
    let selection = active;
    for (const [i, actor] of actors.entries()) {
      const row = doc.createElement("div");
      row.setAttribute("componentkey", `opaque-row-${i}`);
      row.innerHTML = `<figure><svg id="${actor.type === "person" ? "person" : "company"}-accent-4"></svg><img src="${actor.avatar}"></figure><p>${actor.name}</p><div><input type="radio" aria-label="Select ${actor.name}"></div>`;
      row.querySelector("input")!.checked = actor === active;
      row.querySelector("p")!.onclick = () => {
        row.querySelector("input")!.click();
        selection = actor;
        dialog
          .querySelectorAll("input")
          .forEach(
            (input) => (input.checked = input === row.querySelector("input")),
          );
      };
      dialog.querySelector('[role="radiogroup"]')!.append(row);
    }
    const buttons = dialog.querySelectorAll("button");
    buttons[0].onclick = () => dialog.remove();
    buttons[1].onclick = () => {
      active = selection;
      trigger.querySelector("img")!.src = active.avatar;
      dialog.remove();
    };
    doc.body.append(dialog);
  };
  return {
    trigger,
    links,
    setActive(index: number) {
      active = actors[index];
      trigger.querySelector("img")!.src = active.avatar;
    },
  };
}
