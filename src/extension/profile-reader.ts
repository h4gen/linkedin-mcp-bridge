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
  let top = contact?.parentElement;
  for (let i = 0; top && i < 7 && !top.querySelector("h1,h2"); i++)
    top = top.parentElement;
  if (
    !top ||
    !top.querySelector("h1,h2") ||
    top.querySelectorAll("h1,h2").length !== 1
  )
    return { bridge_error: "profile_loading" };
  const labels = top
    ? [...top.querySelectorAll("button,a,p,span")]
        .filter(visible)
        .map((e) =>
          (e.getAttribute("aria-label") ?? e.textContent ?? "").trim(),
        )
    : [];
  const direct = labels.some((t) => /^[·•]?\s*(1st|1\.)$/.test(t));
  const pending = labels.some((t) => /^(Pending|Ausstehend)$/.test(t));
  const connect = labels.some((t) => /^(Connect|Vernetzen)$/.test(t));
  const messaging = links.some(
    (a) =>
      a.pathname.includes("/messaging/compose/") &&
      new URL(a.href).searchParams.get("profileUrn") === expectedUrn,
  );
  const status = direct
    ? "connected"
    : pending
      ? "outgoing_pending"
      : connect
        ? "not_connected"
        : "unknown";
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
    relationship: {
      profile_urn: expectedUrn,
      status,
      messaging: messaging ? "allowed" : "unknown",
      observed_at: new Date().toISOString(),
      evidence:
        status === "unknown"
          ? []
          : [{ source: "verified_profile_top_card", value: status }],
    },
  };
}
