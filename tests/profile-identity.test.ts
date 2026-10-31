import { expect, it } from "vitest";
import {
  mergeIdentity,
  profileReference,
} from "../src/core/profile-identity.js";
import { personRef } from "../src/core/read-models.js";
import { readApi } from "../src/core/api.js";
import { Fault } from "../src/core/contracts.js";
const id = "ACo" + "x".repeat(36),
  urn = "urn:li:fsd_profile:" + id;
const verified = {
  entityUrn: urn,
  name: "Alex Example",
  public_identifier: "alex-example",
  profile_url: "https://www.linkedin.com/in/alex-example/",
  posts_url: "https://www.linkedin.com/in/alex-example/recent-activity/all/",
};
it.each(["profileUrl", "profile_url", "publicIdentifier", "public_identifier"])(
  "does not promote an opaque member reference from %s",
  (field) => {
    const p = personRef({
      entityUrn: urn,
      [field]: field.includes("profile")
        ? `https://www.linkedin.com/in/${id}/`
        : id,
    });
    expect(p).toMatchObject({
      entityUrn: urn,
      public_identifier: null,
      profile_url: null,
      identity_status: "resolved",
    });
  },
);
it("keeps member IDs and public slugs separate, without a length heuristic", () => {
  expect(
    profileReference({ profileUrl: `https://www.linkedin.com/in/${id}/` })
      .identity_status,
  ).toBe("unresolved");
  expect(
    personRef({
      publicIdentifier: "a-long-but-valid-public-profile-name-123456789",
    }).public_identifier,
  ).toBe("a-long-but-valid-public-profile-name-123456789");
  expect(
    personRef({
      entityUrn: "urn:li:fsd_profile:plain",
      profileUrl: "https://www.linkedin.com/in/plain/",
    }).public_identifier,
  ).toBeNull();
});
it("never downgrades verified profile references and invalidates dependent hints on verified rename", () => {
  const initial = mergeIdentity(undefined, verified, "profile_verified");
  for (const candidate of [
    {
      entityUrn: urn,
      profileUrl: `https://www.linkedin.com/in/${id}/`,
      name: "Updated Name",
    },
    {
      ...verified,
      public_identifier: "different",
      profile_url: "https://www.linkedin.com/in/different/",
    },
    { entityUrn: urn, name: "" },
  ]) {
    const next = mergeIdentity(initial, candidate);
    expect(next).toMatchObject({
      public_identifier: "alex-example",
      profile_url: verified.profile_url,
      identity_source: "profile_verified",
      posts_url: verified.posts_url,
    });
  }
  const renamed = mergeIdentity(
    initial,
    { entityUrn: urn, name: "Alex", public_identifier: "renamed" },
    "profile_verified",
  );
  expect(renamed.public_identifier).toBe("renamed");
  expect(renamed.posts_url).toBeUndefined();
  expect(
    mergeIdentity(initial, {
      entityUrn: "urn:li:fsd_profile:other",
      name: "Other",
    }).public_identifier,
  ).toBeNull();
});
it("uses the exact requested URN even when a lookup hint differs from the returned public identifier", async () => {
  const requests: string[] = [];
  const result = await readApi(
    "profile_get",
    { profile_urn: urn, public_identifier: id },
    {},
    async (r) => {
      requests.push(r.path);
      return {
        data: {
          elements: [{ entityUrn: urn, publicIdentifier: "alex-example" }],
        },
      };
    },
  );
  expect(result.profile.entityUrn).toBe(urn);
  expect(requests).toHaveLength(1);
  expect(
    new URLSearchParams(requests[0].split("?")[1]).get("memberIdentity"),
  ).toBe(id);
});
it.each(["missing", "wrong", "404"])(
  "recovers a stale hint once by exact member ID: %s",
  async (kind) => {
    const locators: string[] = [];
    const r = await readApi(
      "profile_get",
      { profile_urn: urn, public_identifier: "old-name" },
      {},
      async (req) => {
        const locator = new URLSearchParams(req.path.split("?")[1]).get(
          "memberIdentity",
        )!;
        locators.push(locator);
        if (locator === "old-name") {
          if (kind === "404") throw new Fault("linkedin_http_404");
          return {
            data: {
              elements:
                kind === "missing"
                  ? []
                  : [
                      {
                        entityUrn: "urn:li:fsd_profile:other",
                        publicIdentifier: "old-name",
                      },
                    ],
            },
          };
        }
        return {
          data: {
            elements: [{ entityUrn: urn, publicIdentifier: "alex-example" }],
          },
        };
      },
    );
    expect(locators).toEqual(["old-name", id]);
    expect(r.profile.entityUrn).toBe(urn);
  },
);
it.each([
  "account_changed",
  "cancelled",
  "session_unavailable",
  "rate_limited",
  "response_shape_changed",
])("does not replace failure %s with a fallback request", async (code) => {
  let calls = 0;
  await expect(
    readApi(
      "profile_get",
      { profile_urn: urn, public_identifier: "old-name" },
      {},
      async () => {
        calls++;
        throw new Fault(code);
      },
    ),
  ).rejects.toMatchObject({ code });
  expect(calls).toBe(1);
});
it("rejects ambiguous candidates and enforces an explicit public identifier", async () => {
  let calls = 0;
  await expect(
    readApi(
      "profile_get",
      { profile_urn: urn, public_identifier: "hint" },
      {},
      async () => {
        calls++;
        return {
          data: {
            elements: [
              { entityUrn: urn, publicIdentifier: "one" },
              { entityUrn: urn, publicIdentifier: "two" },
            ],
          },
        };
      },
    ),
  ).rejects.toMatchObject({ code: "profile_not_unique" });
  expect(calls).toBe(1);
  await expect(
    readApi(
      "profile_get",
      { public_identifier: "requested" },
      {},
      async () => ({
        data: { elements: [{ entityUrn: urn, publicIdentifier: "different" }] },
      }),
    ),
  ).rejects.toMatchObject({ code: "profile_not_unique" });
});

it("retains a legitimate slug that merely starts with ACo", () => {
  expect(
    personRef({ profileUrl: "https://www.linkedin.com/in/ACorn-studio/" })
      .public_identifier,
  ).toBe("ACorn-studio");
});
it("does not verify a profile slug based only on a URL hint", async () => {
  await expect(
    readApi("profile_get", { profile_urn: urn }, {}, async () => ({
      data: {
        elements: [
          {
            entityUrn: urn,
            profileUrl: "https://www.linkedin.com/in/alex-example/",
          },
        ],
      },
    })),
  ).rejects.toMatchObject({ code: "profile_shape_changed" });
});
