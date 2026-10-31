// A postcondition reader, never a relationship mutation. Identity comes from
// the exact invitation source row, not a display-name match.
export function relationshipStatus(topCard: string, invitations: string[]) {
  const positive = new Set(
    [topCard, ...invitations].filter(
      (v) => v !== "unknown" && v !== "not_connected",
    ),
  );
  if (positive.size > 1) return "unknown";
  return [...positive][0] ?? topCard;
}

export function firstDegreeConnection(
  expectedUrl: string,
  expectedUrn: string,
): boolean {
  if (
    location.origin !== "https://www.linkedin.com" ||
    location.pathname.replace(/\/$/, "") !==
      new URL(expectedUrl).pathname.replace(/\/$/, "")
  )
    return false;
  const messages = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/messaging/compose/"]',
    ),
  ).filter(
    (a) => new URL(a.href).searchParams.get("profileUrn") === expectedUrn,
  );
  for (const link of messages) {
    let scope: HTMLElement | null = link.parentElement;
    for (let i = 0; scope && i < 8; i++, scope = scope.parentElement) {
      if (scope.matches('main,body,[role="main"]')) break;
      if (!scope.querySelector("h1,h2")) continue;
      const degrees = Array.from(scope.querySelectorAll<HTMLElement>("p,span"));
      if (
        degrees.some(
          (e) =>
            !!e.getClientRects().length &&
            /^[·•]?\s*(?:1st|1\.)$/.test(e.textContent?.trim() ?? ""),
        )
      )
        return true;
    }
  }
  return false;
}
