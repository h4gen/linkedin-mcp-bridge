const visible = (element: Element) => !!element.getClientRects().length;
function profileActionEvidence(labels: string[]) {
  const evidence: Array<{ source: string; value: string }> = [];
  if (
    labels.some((t) =>
      /^(?:Connect(?: with .+)?|Invite .+ to connect|Vernetzen(?: mit .+)?)$/i.test(
        t,
      ),
    )
  )
    evidence.push({
      source: "verified_profile_action",
      value: "connect_available",
    });
  if (
    labels.some((t) =>
      /^(?:Pending(?: invitation)?|Invitation sent|Ausstehend|Anfrage gesendet)$/i.test(
        t,
      ),
    )
  )
    evidence.push({
      source: "verified_profile_action",
      value: "outgoing_pending",
    });
  if (
    labels.some((t) =>
      /^(?:Accept(?: invitation)?|Einladung annehmen|Annehmen)$/i.test(t),
    )
  )
    evidence.push({
      source: "verified_profile_action",
      value: "incoming_pending",
    });
  return evidence;
}
function profileTopCard(expectedUrl: string): HTMLElement | null {
  const path = new URL(expectedUrl).pathname.replace(/\/$/, "");
  const contacts = [
    ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ].filter((a) => visible(a) && a.pathname === path + "/overlay/contact-info/");
  const cards = new Set<HTMLElement>();
  for (const contact of contacts) {
    // The source top-card section owns both the identity header and its sibling
    // action row. The nearest heading wrapper alone omits those actions.
    const section = contact.closest<HTMLElement>("section");
    if (
      section &&
      section.querySelectorAll("h1,h2").length === 1 &&
      [
        ...section.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/overlay/contact-info/"]',
        ),
      ].every((a) => a.pathname === path + "/overlay/contact-info/")
    ) {
      cards.add(section);
      continue;
    }
    let top = contact.parentElement;
    for (let i = 0; top && i < 7 && !top.querySelector("h1,h2"); i++)
      top = top.parentElement;
    if (top && top.querySelectorAll("h1,h2").length === 1) cards.add(top);
  }
  return cards.size === 1 ? [...cards][0] : null;
}
// Packaged, read-only profile adapter. The caller resolves and verifies the basic profile first.
export function profileReader(expectedUrl: string, expectedUrn: string) {
  const canonical = (v: string) => new URL(v).pathname.replace(/\/$/, "");
  if (
    location.origin !== "https://www.linkedin.com" ||
    canonical(location.href) !== canonical(expectedUrl)
  )
    return { bridge_error: "profile_navigation_changed" };
  const visible = (e: Element) => !!e.getClientRects().length;
  const headings = [...document.querySelectorAll("h1,h2")].filter(visible);
  function section(pattern: RegExp) {
    const h = headings.filter((e) => pattern.test(e.textContent?.trim() ?? ""));
    if (h.length !== 1) return { status: "unavailable", text: null };
    let node = h[0].parentElement;
    for (let i = 0; node && i < 5; i++, node = node.parentElement) {
      if (node.querySelectorAll("h1,h2").length > 1) break;
      const paragraphs = [
        ...node.querySelectorAll("p,[data-testid='expandable-text-box']"),
      ]
        .filter(visible)
        .filter(
          (e, _, all) => !all.some((other) => other !== e && other.contains(e)),
        );
      if (paragraphs.length)
        return {
          status: "available",
          text: paragraphs
            .map((e) => e.textContent?.trim())
            .filter(Boolean)
            .join("\n"),
        };
    }
    return { status: "unavailable", text: null };
  }
  const links = [
    ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ].filter(visible);
  const posts = links.filter(
    (a) =>
      /Show all posts|Alle Beiträge/i.test(a.textContent ?? "") &&
      a.pathname.startsWith(canonical(expectedUrl) + "/recent-activity/"),
  );
  // Degree and action evidence must be in the exact profile's top-card, not recommendations.
  const contact = links.find(
    (a) => a.pathname === canonical(expectedUrl) + "/overlay/contact-info/",
  );
  const top = profileTopCard(expectedUrl);
  if (!top) return { bridge_error: "profile_loading" };
  const labels = [...top.querySelectorAll("p,span")]
    .filter(visible)
    .map((e) => e.textContent?.trim() ?? "");
  const degrees = [
    ...new Set(
      labels.flatMap((label) => {
        const degree = label.match(/^[·•]?\s*([123])(?:st|nd|rd|\.)\+?$/i)?.[1];
        return degree ? [degree] : [];
      }),
    ),
  ];
  const connection_degree = degrees.length === 1 ? degrees[0] : "unknown";
  const actions = [...top.querySelectorAll("button,a,[role=button]")]
    .filter(visible)
    .map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim());
  const actionEvidence = profileActionEvidence(actions);
  const direct = degrees.includes("1");
  const status = direct
    ? "connected"
    : actionEvidence.some((e) => e.value === "outgoing_pending")
      ? "outgoing_pending"
      : actionEvidence.some((e) => e.value === "incoming_pending")
        ? "incoming_pending"
        : actionEvidence.some((e) => e.value === "connect_available")
          ? "not_connected"
          : "unknown";
  const messaging = [...top.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .filter(visible)
    .some(
      (a) =>
        a.pathname.includes("/messaging/compose/") &&
        new URL(a.href).searchParams.get("profileUrn") === expectedUrn,
    );
  const current: string[] = [];
  const experienceHeading = headings.find((h) =>
    /^(Experience|Berufserfahrung)$/.test(h.textContent?.trim() ?? ""),
  );
  let experienceRoot = experienceHeading?.parentElement;
  for (
    let i = 0;
    experienceRoot && i < 5;
    i++, experienceRoot = experienceRoot.parentElement
  ) {
    if (experienceRoot.querySelectorAll("h1,h2").length > 1) break;
    const dates = [...experienceRoot.querySelectorAll("p,span")].filter(
      (e) =>
        visible(e) &&
        /(?:^|\s)[–-]\s*(?:Present|Heute|heute|Aktuell)\b/.test(
          e.textContent ?? "",
        ),
    );
    for (const date of dates) {
      let entry = date.parentElement;
      for (
        let n = 0;
        entry && entry !== experienceRoot && n < 5;
        n++, entry = entry.parentElement
      ) {
        const lines = [...entry.querySelectorAll("p,span")]
          .filter(visible)
          .filter(
            (e, _, all) =>
              !all.some((other) => other !== e && other.contains(e)),
          )
          .map((e) => e.textContent?.trim())
          .filter(Boolean);
        // Include the actual role/company context, never just a duration line.
        if (lines.length >= 3 && lines.length <= 12) {
          current.push(lines.join("\n"));
          break;
        }
      }
    }
    if (current.length) break;
  }
  return {
    about: section(/^(About|Info)$/),
    current_positions: {
      status: current.length ? "available" : "unavailable",
      text: current.length ? [...new Set(current)].join("\n\n") : null,
    },
    location: (() => {
      const ps = [...top!.querySelectorAll("p")].filter(visible);
      const contactIndex = ps.findIndex((p) => p.contains(contact!));
      const text =
        ps
          .slice(0, contactIndex)
          .map((p) => p.textContent?.trim())
          .filter((t) => t && t !== "·")
          .at(-1) ?? null;
      return { status: text ? "available" : "unavailable", text };
    })(),
    posts_url: posts.length === 1 ? posts[0].href : null,
    activity_url:
      links.find((a) =>
        a.pathname.startsWith(canonical(expectedUrl) + "/recent-activity/"),
      )?.href ?? null,
    relationship: {
      profile_urn: expectedUrn,
      status,
      messaging: messaging ? "allowed" : "unknown",
      observed_at: new Date().toISOString(),
      connection_degree,
      messaging_evidence: messaging
        ? [
            {
              source: "verified_profile_compose_link",
              value: "ui_affordance_only",
            },
          ]
        : [],
      evidence: [
        ...degrees.map((value) => ({
          source: "verified_profile_degree",
          value,
        })),
        ...(direct
          ? [{ source: "verified_profile_top_card", value: "connected" }]
          : []),
        ...actionEvidence,
        ...(degrees.length > 1
          ? [{ source: "verified_profile_top_card", value: "degree_conflict" }]
          : []),
      ],
    },
  };
}

export async function readProfileRelationship(
  expectedUrl: string,
  expectedUrn: string,
) {
  const read = profileReader(expectedUrl, expectedUrn);
  if (read.bridge_error) return read;
  const relationship = read.relationship!;
  const result = {
    ...relationship,
    action_scan: { reason: "profile_actions_observed", menu_opened: false },
  };
  if (relationship.status !== "unknown") return result;
  const top = profileTopCard(expectedUrl)!;
  const more = [
    ...top.querySelectorAll<HTMLElement>('button,[role="button"]'),
  ].filter(
    (e) =>
      visible(e) &&
      /^(?:More(?: actions)?|Mehr|Weitere(?: Aktionen)?)$/i.test(
        (e.getAttribute("aria-label") ?? e.textContent ?? "").trim(),
      ),
  );
  if (more.length !== 1) {
    result.action_scan.reason = more.length
      ? "profile_action_menu_ambiguous"
      : "profile_actions_unavailable";
    return result;
  }
  const trigger = more[0];
  if (trigger.getAttribute("aria-expanded") === "true") {
    result.action_scan.reason = "profile_action_menu_already_open";
    return result;
  }
  const before = new Set(
    [...document.querySelectorAll<HTMLElement>('[role="menu"]')].filter(
      visible,
    ),
  );
  let owned: HTMLElement | undefined;
  try {
    trigger.click();
    result.action_scan.menu_opened = true;
    for (let n = 0; n < 6; n++) {
      const menus = [
        ...document.querySelectorAll<HTMLElement>('[role="menu"]'),
      ].filter(visible);
      const fresh = menus.filter((m) => !before.has(m));
      owned =
        menus.find(
          (m) => m.id && m.id === trigger.getAttribute("aria-controls"),
        ) ?? (fresh.length === 1 ? fresh[0] : undefined);
      if (owned) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (location.origin + location.pathname !== expectedUrl || !top.isConnected)
      return { bridge_error: "profile_navigation_changed" };
    if (!owned) {
      result.action_scan.reason = "profile_action_menu_unavailable";
      return result;
    }
    const evidence = profileActionEvidence(
      [
        ...owned.querySelectorAll<HTMLElement>(
          'button,a,[role="menuitem"],[role="button"]',
        ),
      ]
        .filter(visible)
        .map((e) =>
          (e.getAttribute("aria-label") ?? e.textContent ?? "").trim(),
        ),
    );
    result.evidence.push(
      ...evidence.map((e) => ({ ...e, source: "verified_profile_more_menu" })),
    );
    result.action_scan.reason = evidence.length
      ? "profile_actions_observed"
      : "profile_actions_unavailable";
    return result;
  } finally {
    if (trigger.isConnected && trigger.getAttribute("aria-expanded") === "true")
      trigger.click();
    else if (owned?.isConnected)
      owned.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
  }
}

// Bounded lazy-section loading on the already verified profile route.
export async function prepareProfile(
  expectedUrl: string,
  target: "sections" | "posts" = "sections",
) {
  if (location.origin + location.pathname !== expectedUrl) return;
  for (let step = 0; step < 4; step++) {
    if (
      target === "posts"
        ? [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].some(
            (a) =>
              /Show all posts|Alle Beiträge/i.test(a.textContent ?? "") &&
              a.href.startsWith(expectedUrl + "recent-activity/"),
          )
        : [...document.querySelectorAll("h2")].some((e) =>
            /^(Experience|Berufserfahrung)$/.test(e.textContent?.trim() ?? ""),
          )
    )
      return;
    let scroller: Element | null = document.querySelector(
      'main [role="region"],main',
    );
    while (scroller) {
      if (
        /auto|scroll/.test(window.getComputedStyle(scroller).overflowY) &&
        scroller.scrollHeight > scroller.clientHeight + 100
      )
        break;
      scroller = scroller.parentElement;
    }
    (scroller ?? document.scrollingElement)?.scrollBy(0, 750);
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (location.origin + location.pathname !== expectedUrl) return;
  }
}
