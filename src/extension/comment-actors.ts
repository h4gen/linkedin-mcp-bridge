// Native SDUI actor picker observed 2026-11-11. No generated class names,
// guessed organization URNs, or name-only selections.
export interface PublishingActor {
  type: "person" | "company";
  name: string;
  profile_url: string;
  avatar: string;
}
export function actorUrl(value: string): string | undefined {
  try {
    const u = new URL(value, "https://www.linkedin.com");
    if (
      u.origin === "https://www.linkedin.com" &&
      /^\/(in|company)\/[^/]+\/?$/.test(u.pathname)
    )
      return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    /* Not an identity. */
  }
}
export function actorImage(value: string): string | undefined {
  try {
    const u = new URL(value);
    if (
      u.hostname === "media.licdn.com" &&
      u.pathname.startsWith("/dms/image/")
    ) {
      // Observed SDUI sidebar/picker variants: same media ID and upload time,
      // but 200px/100px sizes and different rendition tokens. Do not collapse
      // other media types, different uploads or unrelated asset IDs.
      const photo =
        /^\/dms\/image\/v2\/([^/]+)\/profile-displayphoto-scale_\d+_\d+\/[^/]+\/0\/(\d+)$/.exec(
          u.pathname,
        );
      return photo
        ? `${u.origin}/dms/image/v2/${photo[1]}/profile-displayphoto/${photo[2]}`
        : u.origin + u.pathname;
    }
  } catch {
    /* Not an observed avatar. */
  }
}
const visible = (e: Element) =>
  !!(e as HTMLElement).offsetParent || e.getClientRects().length > 0;
const fail = (code: string): never => {
  throw new Error(code);
};
export function actorSwitch(scope: Element): HTMLElement {
  const nodes = [
    ...scope.querySelectorAll<HTMLElement>(
      '[aria-label="Switch to different account"]',
    ),
  ]
    .map((e) => e.closest<HTMLElement>("a,button") ?? e)
    .filter(visible);
  const unique = [...new Set(nodes)];
  if (unique.length !== 1) fail("comment_actor_switch_unavailable");
  return unique[0];
}
function dialog(): HTMLElement | undefined {
  const matches = [
    ...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]'),
  ].filter(
    (e) =>
      visible(e) &&
      e.querySelector('input[type="radio"]') &&
      e.querySelector("h2")?.textContent?.trim() ===
        "Comment, react, and repost as",
  );
  if (matches.length > 1) fail("comment_actor_dialog_unavailable");
  return matches[0];
}
function control(d: Element, label: string) {
  const matches = [...d.querySelectorAll<HTMLButtonElement>("button")].filter(
    (e) =>
      visible(e) &&
      !e.disabled &&
      (e.textContent?.trim() === label ||
        e.getAttribute("aria-label") === label),
  );
  if (matches.length !== 1) fail("comment_actor_control_unavailable");
  return matches[0];
}
export function pickerEntries(d: Element, known: PublishingActor[] = []) {
  return [...d.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
    (input) => {
      const row = input.closest<HTMLElement>("[componentkey]");
      const name = row?.querySelector("p")?.textContent?.trim();
      const avatar = actorImage(
        row?.querySelector("img")?.getAttribute("src") ?? "",
      );
      const type = row?.querySelector('[id="company-accent-4"]')
        ? "company"
        : row?.querySelector('[id="person-accent-4"]')
          ? "person"
          : undefined;
      const urls = new Set<string>();
      if (name && avatar && type) {
        for (const link of document.querySelectorAll<HTMLAnchorElement>(
          "a[href]",
        )) {
          const url = actorUrl(link.href);
          if (
            url &&
            url.includes(type === "company" ? "/company/" : "/in/") &&
            [...link.querySelectorAll("img")].some(
              (img) => actorImage(img.src) === avatar,
            )
          )
            urls.add(url);
        }
        // An earlier discovery can supply an observed URL when a post detail no
        // longer displays the sidebar. Both avatar and name must still agree.
        for (const candidate of known)
          if (
            candidate.name === name &&
            candidate.avatar === avatar &&
            candidate.type === type
          )
            urls.add(candidate.profile_url);
      }
      const actor: PublishingActor | undefined =
        name && avatar && type && urls.size === 1
          ? { name, avatar, type, profile_url: [...urls][0] }
          : undefined;
      return { input, row, actor };
    },
  );
}
export async function commentActors(
  scope: () => Element,
  mode: "list" | "select" | "assert",
  expected: Partial<PublishingActor> | undefined,
  check: () => void,
  wait: () => Promise<unknown>,
  directory: PublishingActor[] = [],
) {
  check();
  const trigger = actorSwitch(scope());
  trigger.click();
  // LinkedIn can mount the dialog shell before its radio rows arrive. Open
  // once and wait for the observed contents; never toggle/reclick on a delay.
  let observed: HTMLElement | undefined;
  for (let n = 0; n < 8; n++) {
    await wait();
    check();
    observed = dialog();
    if (observed) break;
  }
  const d = observed ?? fail("comment_actor_dialog_unavailable");
  try {
    const entries = pickerEntries(
      d,
      expected?.avatar
        ? [expected as PublishingActor, ...directory]
        : directory,
    );
    if (entries.length > 100) fail("comment_actor_limit");
    const resolved = entries.filter((e) => e.actor && !e.input.disabled);
    const urls = resolved.map((e) => e.actor!.profile_url);
    if (new Set(urls).size !== urls.length) fail("comment_actor_ambiguous");
    if (mode === "list")
      return {
        items: resolved.map((e) => e.actor!),
        complete: resolved.length === entries.length,
      };
    const wanted = actorUrl(expected?.profile_url ?? "");
    const matches = resolved.filter((e) => e.actor!.profile_url === wanted);
    if (matches.length !== 1) fail("comment_actor_unavailable");
    const target = matches[0];
    if (!target.input.checked) {
      if (mode === "assert") fail("comment_actor_changed");
      check();
      target.row!.querySelector<HTMLElement>("p")!.click();
      await wait();
      check();
      if (!target.input.checked) fail("comment_actor_selection_failed");
      control(d, "Save").click();
      await wait();
      check();
      if (d.isConnected && visible(d) && d.hasAttribute("open"))
        fail("comment_actor_save_unconfirmed");
    }
    return { items: [target.actor!], complete: true };
  } finally {
    if (
      d.isConnected &&
      visible(d) &&
      (d.tagName !== "DIALOG" || d.hasAttribute("open"))
    ) {
      control(d, "Cancel").click();
      await wait();
    }
  }
}
export function assertActorAvatar(scope: Element, actor: PublishingActor) {
  const images = [
    ...actorSwitch(scope).querySelectorAll<HTMLImageElement>("img"),
  ];
  if (images.length !== 1 || actorImage(images[0].src) !== actor.avatar)
    fail("comment_actor_changed");
}

// Read only the managed-page links in the feed sidebar, not arbitrary post bodies.
export function actorDirectory(): PublishingActor[] {
  const result: PublishingActor[] = [];
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    '[aria-label="Sidebar"] a[href]',
  )) {
    const profile_url = actorUrl(link.href);
    const avatar = actorImage(link.querySelector("img")?.src ?? "");
    const name = link.querySelector("p")?.textContent?.trim();
    if (profile_url?.includes("/company/") && avatar && name)
      result.push({ type: "company", name, profile_url, avatar });
    if (result.length >= 100) break;
  }
  return result;
}
