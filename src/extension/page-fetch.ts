import type { Request } from "../core/api.js";
export async function pageFetch(request: Request): Promise<any> {
  if (
    location.origin !== "https://www.linkedin.com" ||
    /checkpoint|challenge|login/.test(location.pathname)
  )
    return { error: "session_unavailable" };
  const guest = request.surface === "guest_typeahead";
  if (
    guest &&
    (!/^\/jobs-guest\/api\/typeaheadHits\?/.test(request.path) ||
      request.method ||
      request.body)
  )
    return { error: "path_denied" };
  // Only packaged code builds request paths. Defense in depth at browser boundary.
  if (
    !guest &&
    !/^\/(me|identity\/dash\/profiles|graphql|relationships\/(invitationViews|sentInvitationViewsV2)|voyagerMessagingGraphQL\/graphql|voyagerMessagingDashMessengerMessages|voyagerMessagingDashMessengerConversations|voyagerRelationshipsDashMemberRelationships)(\?|$)/.test(
      request.path,
    )
  )
    return { error: "path_denied" };
  const cookie = document.cookie
    .split("; ")
    .find((s) => s.startsWith("JSESSIONID="));
  const csrf = cookie?.slice("JSESSIONID=".length).replace(/^"|"$/g, "");
  if (!guest && !csrf) return { error: "not_logged_in" };
  try {
    const r = await fetch((guest ? "" : "/voyager/api") + request.path, {
      method: request.method ?? "GET",
      credentials: guest ? "omit" : "include",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: guest
        ? { accept: "application/json" }
        : {
            accept: "application/vnd.linkedin.normalized+json+2.1",
            "csrf-token": csrf!,
            "x-restli-protocol-version": "2.0.0",
            "content-type": "application/json",
            ...request.headers,
          },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
    if (!r.ok)
      return {
        error:
          r.status === 429
            ? "rate_limited"
            : !guest && [401, 403, 999].includes(r.status)
              ? "session_blocked"
              : "linkedin_http_" + r.status,
        retry_after: r.headers.get("retry-after"),
      };
    if (r.status === 204) return { data: {} };
    const text = await r.text();
    if (text.length > 4 * 1024 * 1024) return { error: "response_too_large" };
    return { data: JSON.parse(text) };
  } catch {
    return { error: "transport_or_response_error" };
  }
}
