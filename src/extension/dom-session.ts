export type DomContext = {
  version: 1;
  token: string;
  document_token: string;
  path: string;
  filters: Record<string, string> | null;
};
export function beginDomSession(token: string) {
  const w = window as any;
  w.__liBridgeDocumentToken ??= crypto.randomUUID();
  w.__liBridgeSession = token;
  w.__liBridgeTraversal = {
    version: 1,
    token,
    document_token: w.__liBridgeDocumentToken,
    path: null,
    filters: null,
    invalidated: null,
  };
  if (!w.__liBridgeTraversalGuard) {
    w.__liBridgeTraversalGuard = true;
    const invalidate = (reason: string) => {
      if (w.__liBridgeTraversal) w.__liBridgeTraversal.invalidated = reason;
      w.__liBridgeSession = undefined;
    };
    for (const type of ["click", "keydown", "input", "pointerdown"])
      document.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) invalidate("user_interaction");
        },
        true,
      );
    for (const type of ["popstate", "hashchange"])
      window.addEventListener(type, () => {
        // The composer owns feed <-> compose transitions while it executes.
        // Trusted user input still invalidates above; a full document loses the token.
        const ownedComposerTransition =
          w.__liBridgeComposerNavigation === w.__liBridgeSession &&
          !!w.__liBridgeSession &&
          location.hostname === "www.linkedin.com" &&
          /^\/(feed\/?|sharing\/compose\/?)$/.test(location.pathname);
        if (w.__liBridgeTraversal?.path && !ownedComposerTransition)
          invalidate("path_changed");
      });
  }
}
export function bindDomSession(
  token: string | undefined,
  filters: Record<string, string> | null = null,
) {
  // Direct adapter fixtures without an execution session do not create cursors.
  if (!token) return;
  const w = window as any,
    current = w.__liBridgeTraversal;
  if (
    !current ||
    current.token !== token ||
    w.__liBridgeSession !== token ||
    current.invalidated
  ) {
    const e = new Error("cursor_invalidated");
    Object.assign(e, {
      details: { reason: current?.invalidated ?? "session_marker_missing" },
    });
    throw e;
  }
  if (current.path !== null) throw Error("session_already_bound");
  current.path = location.pathname + location.search;
  current.filters = filters;
  w.__liBridgeSessionPath = current.path;
}
// Self-contained so validation can run without initializing an adapter in a new document.
export function inspectDomSession(expected: Partial<DomContext>) {
  const w = window as any,
    current = w.__liBridgeTraversal;
  if (expected.version !== 1) return { reason: "context_version_mismatch" };
  if (
    expected.document_token &&
    w.__liBridgeDocumentToken !== expected.document_token
  )
    return { reason: "document_changed" };
  if (current?.invalidated) return { reason: current.invalidated };
  if (!current || !w.__liBridgeSession)
    return { reason: "session_marker_missing" };
  if (
    current.token !== expected.token ||
    w.__liBridgeSession !== expected.token
  )
    return { reason: "session_changed" };
  const path = location.pathname + location.search;
  if (
    !current.path ||
    current.path !== path ||
    (expected.path && expected.path !== path)
  )
    return { reason: "path_changed" };
  if (
    expected.filters &&
    (!current.filters ||
      Object.keys(expected.filters).length !==
        Object.keys(current.filters).length ||
      Object.entries(expected.filters).some(
        ([key, value]) => current.filters[key] !== value,
      ))
  )
    return { reason: "filters_changed" };
  if (current.filters) {
    const labels = [...document.querySelectorAll('button,[role="button"]')]
      .filter(
        (e) =>
          e.getClientRects().length &&
          !e.matches(':disabled,[aria-disabled="true"]'),
      )
      .flatMap((e) => [
        e.getAttribute("aria-label"),
        e.querySelector("[aria-label]")?.getAttribute("aria-label"),
      ]);
    const sort =
      current.filters.sort === "latest"
        ? ["Filter by Latest"]
        : ["Filter by Sort by", "Filter by Top Match"];
    const date: Record<string, string> = {
      any: "Date posted",
      day: "Past 24 hours",
      week: "Past week",
      month: "Past month",
    };
    if (
      !labels.some((l) => sort.includes(l ?? "")) ||
      !labels.includes("Filter by " + date[current.filters.date_posted])
    )
      return { reason: "filters_changed" };
  }
  return {
    context: {
      version: 1,
      token: current.token,
      document_token: current.document_token,
      path,
      filters: current.filters,
    },
  };
}
