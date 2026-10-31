import { Fault, type Args } from "./contracts.js";
export type InvitationScan = {
  pages: number;
  checked_count: number;
  complete: boolean;
  matched: boolean;
  stop_reason:
    | "match_found"
    | "source_exhausted"
    | "page_limit"
    | "source_incomplete"
    | "source_unavailable";
  error_code?: string;
};
export async function scanRelationshipInvitations(
  profileUrn: string,
  read: (direction: "received" | "sent", cursor: Args) => Promise<Args>,
) {
  const scans = {} as Record<"received" | "sent", InvitationScan>;
  for (const direction of ["received", "sent"] as const) {
    const scan: InvitationScan = {
      pages: 0,
      checked_count: 0,
      complete: false,
      matched: false,
      stop_reason: "page_limit",
    };
    let cursor: Args = {};
    for (let n = 0; n < 3; n++) {
      let page: Args;
      try {
        page = await read(direction, cursor);
      } catch (error) {
        if (
          error instanceof Fault &&
          /account|cancel|session|login|rate_limited|disconnected|transport|native_host/.test(
            error.code,
          )
        )
          throw error;
        scan.stop_reason = "source_unavailable";
        scan.error_code =
          error instanceof Fault ? error.code : "invitation_read_failed";
        break;
      }
      scan.pages++;
      scan.checked_count += page.items.length;
      scan.matched = page.items.some(
        (item: Args) =>
          item.profile?.entityUrn?.replace("fs_miniProfile", "fsd_profile") ===
          profileUrn,
      );
      scan.complete = !page.next && !page.partial;
      if (scan.matched) {
        scan.stop_reason = "match_found";
        break;
      }
      if (!page.next) {
        scan.stop_reason = scan.complete
          ? "source_exhausted"
          : "source_incomplete";
        break;
      }
      cursor = page.next;
    }
    scans[direction] = scan;
  }
  return scans;
}
export function resolveRelationship(
  profile: Args,
  invitation_scan: Record<"received" | "sent", InvitationScan>,
) {
  const evidence = [...profile.evidence];
  const outgoing =
    invitation_scan.sent.matched ||
    evidence.some((e) => e.value === "outgoing_pending");
  const incoming =
    invitation_scan.received.matched ||
    evidence.some((e) => e.value === "incoming_pending");
  for (const [direction, value] of [
    ["sent", "outgoing_pending"],
    ["received", "incoming_pending"],
  ] as const)
    if (invitation_scan[direction].matched)
      evidence.push({ source: "exact_invitation_profile", value });
  const connected = evidence.some((e) => e.value === "connected");
  const connect = evidence.some((e) => e.value === "connect_available");
  const nonFirst = ["2", "3"].includes(profile.connection_degree);
  const complete =
    invitation_scan.sent.complete && invitation_scan.received.complete;
  let status = "unknown",
    reason = "relationship_evidence_unavailable";
  if (
    evidence.some((e) => e.value === "degree_conflict") ||
    (outgoing && incoming) ||
    (connect && (outgoing || incoming)) ||
    (connected && (outgoing || incoming || nonFirst || connect))
  )
    reason = "conflicting_relationship_evidence";
  else if (connected) {
    status = "connected";
    reason = "positive_connection_evidence";
  } else if (outgoing) {
    status = "outgoing_pending";
    reason = "positive_invitation_evidence";
  } else if (incoming) {
    status = "incoming_pending";
    reason = "positive_invitation_evidence";
  } else if (!complete) reason = "invitation_scan_incomplete";
  else if (connect) {
    status = "not_connected";
    reason = "connect_available_and_invitations_exhausted";
  } else if (profile.action_scan?.reason) reason = profile.action_scan.reason;
  return { ...profile, status, reason, evidence, invitation_scan };
}
