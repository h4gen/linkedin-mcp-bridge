export function errorDetails(code: string) {
  const reconcile = /unknown_outcome/.test(code);
  const restart = /cursor_|pagination_stalled/.test(code);
  const connect =
    /session_|account_|connection_paused|disconnected|not_logged_in|bridge_unavailable|tab_unavailable|version_mismatch/.test(
      code,
    );
  return {
    code,
    recovery: reconcile
      ? "inspect_receipt"
      : restart
        ? "restart_query"
        : connect
          ? "repair_connection"
          : /timeout|transport|loading|rate_limited|native_host_unavailable|browser_execution_failed|work_tab_create_failed/.test(
                code,
              )
            ? "retry_read"
            : "inspect_input_or_source",
    retry_safe:
      !reconcile &&
      /timeout|loading|rate_limited|native_host_unavailable|browser_execution_failed|work_tab_create_failed/.test(
        code,
      ),
  };
}
// Only bounded adapter diagnostics cross the public error boundary; never raw DOM,
// source payloads, URLs or session tokens.
export function adapterDiagnostics(details: Record<string, unknown> = {}) {
  const allowed = new Set([
    "composer_route_mismatch",
    "composer_dialog_blocked",
    "composer_unavailable",
    "composer_body_not_unique",
    "composer_recipient_unverified",
    "recipient_mismatch",
    "composer_send_control_not_unique",
    "profile_compose_link_unavailable",
    "verified_recipient_composer",
    "premium_subscription_required",
    "reaction_list_empty_while_hidden",
    "reaction_list_empty",
    "reaction_rows_unrecognized",
    "reaction_dialog_replaced",
    "tab_changed",
    "document_changed",
    "path_changed",
    "user_interaction",
    "session_marker_missing",
    "session_changed",
    "filters_changed",
    "context_version_mismatch",
  ]);
  const result: Record<string, string | number> = {};
  if (typeof details.reason === "string" && allowed.has(details.reason))
    result.reason = details.reason;
  if (
    typeof details.structured_source === "string" &&
    /^(?:reaction_(?:activity_unresolved|response_shape_changed|target_unverified|profile_unresolved)|linkedin_http_[45]\d\d|transport_or_response_error|response_too_large)$/.test(
      details.structured_source,
    )
  )
    result.structured_source = details.structured_source;
  for (const key of ["candidate_count", "matching_count"])
    if (
      typeof details[key] === "number" &&
      Number.isSafeInteger(details[key]) &&
      details[key] >= 0
    )
      result[key] = details[key];
  return result;
}
export function retryAt(value: string | null | undefined, now: number): number {
  const seconds = value?.trim() && Number(value);
  const parsed =
    seconds !== undefined &&
    seconds !== null &&
    seconds !== "" &&
    Number.isFinite(seconds)
      ? now + Number(seconds) * 1000
      : Date.parse(value ?? "");
  return Math.max(
    now + 60000,
    Number.isFinite(parsed) ? parsed : now + 3600000,
  );
}
