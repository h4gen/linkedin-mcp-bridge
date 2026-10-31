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
