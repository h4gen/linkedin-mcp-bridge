import { expect, it } from "vitest";
import {
  scanRelationshipInvitations,
  resolveRelationship,
} from "../src/core/relationships.js";
import { capabilities } from "../src/core/capabilities.js";
import { Fault } from "../src/core/contracts.js";
const target = "urn:li:fsd_profile:peer";
const profile = (evidence: any[] = [], connection_degree = "2") => ({
  profile_urn: target,
  status: "unknown",
  connection_degree,
  messaging: "allowed",
  messaging_evidence: [
    { source: "verified_profile_compose_link", value: "ui_affordance_only" },
  ],
  observed_at: new Date(0).toISOString(),
  evidence,
  action_scan: { reason: "profile_actions_unavailable", menu_opened: false },
});
const ev = (value: string) => ({ source: "verified_profile_action", value });
it("keeps a >60-row invitation scan incomplete and does not infer no invitation from degree or Connect", async () => {
  let calls = 0;
  const scans = await scanRelationshipInvitations(target, async () => {
    calls++;
    return {
      items: Array.from({ length: 20 }, (_, i) => ({
        profile: { entityUrn: "urn:li:fsd_profile:other" + i },
      })),
      next: { start: calls * 20 },
      partial: true,
    };
  });
  expect(calls).toBe(6);
  expect(scans.sent).toEqual({
    pages: 3,
    checked_count: 60,
    complete: false,
    matched: false,
    stop_reason: "page_limit",
  });
  const result = resolveRelationship(profile([ev("connect_available")]), scans);
  expect(result).toMatchObject({
    status: "unknown",
    reason: "invitation_scan_incomplete",
    connection_degree: "2",
  });
  expect(capabilities.relationship_get.output.safeParse(result).success).toBe(
    true,
  );
});
it("requires exhausted invitations as well as positive Connect evidence", async () => {
  const scans = await scanRelationshipInvitations(target, async () => ({
    items: [],
    partial: false,
  }));
  expect(
    resolveRelationship(profile([ev("connect_available")]), scans),
  ).toMatchObject({ status: "not_connected" });
  expect(resolveRelationship(profile(), scans)).toMatchObject({
    status: "unknown",
    reason: "profile_actions_unavailable",
  });
});
it.each(["sent", "received"] as const)(
  "uses the exact %s invitation identity even under incomplete scan coverage",
  async (direction) => {
    const scans = await scanRelationshipInvitations(target, async (d) => ({
      items: [
        {
          profile: {
            entityUrn:
              d === direction
                ? "urn:li:fs_miniProfile:peer"
                : "urn:li:fsd_profile:other",
            name: "Same name",
          },
        },
      ],
      next: d === direction ? { start: 20 } : undefined,
      partial: d === direction,
    }));
    expect(resolveRelationship(profile(), scans).status).toBe(
      direction === "sent" ? "outgoing_pending" : "incoming_pending",
    );
    expect(scans[direction]).toMatchObject({
      matched: true,
      complete: false,
      stop_reason: "match_found",
    });
  },
);
it("never treats disappearance as acceptance and rejects conflicting evidence", async () => {
  const empty = await scanRelationshipInvitations(target, async () => ({
    items: [],
    partial: false,
  }));
  expect(resolveRelationship(profile(), empty).status).toBe("unknown");
  expect(
    resolveRelationship(profile([ev("connected")], "1"), empty).status,
  ).toBe("connected");
  const pending = await scanRelationshipInvitations(target, async () => ({
    items: [{ profile: { entityUrn: target } }],
    partial: false,
  }));
  expect(
    resolveRelationship(profile([ev("connected")], "1"), pending),
  ).toMatchObject({
    status: "unknown",
    reason: "conflicting_relationship_evidence",
  });
  expect(
    resolveRelationship(profile([ev("connected")], "2"), empty).status,
  ).toBe("unknown");
  for (const pending of ["outgoing_pending", "incoming_pending"])
    expect(
      resolveRelationship(
        profile([ev("connect_available"), ev(pending)]),
        empty,
      ),
    ).toMatchObject({
      status: "unknown",
      reason: "conflicting_relationship_evidence",
    });
});
it("reports unavailable source coverage but propagates account and cancellation failures", async () => {
  const scans = await scanRelationshipInvitations(target, async () => {
    throw new Fault("response_shape_changed");
  });
  expect(scans.sent).toMatchObject({
    complete: false,
    stop_reason: "source_unavailable",
    error_code: "response_shape_changed",
  });
  await expect(
    scanRelationshipInvitations(target, async () => {
      throw new Fault("account_changed");
    }),
  ).rejects.toThrow("account_changed");
});
