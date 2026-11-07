import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  attributedActivity,
  reactionPage,
} from "../src/extension/reactions.js";

const post = "urn:li:share:10",
  activity = "urn:li:activity:12";
function response(target: string, actors: string[], start: number) {
  const included = actors.map((name) => {
    const actorUrn = "urn:li:fsd_profile:" + name;
    return {
      actorUrn,
      entityUrn: `urn:li:fsd_reaction:(${actorUrn},${target},0)`,
      reactorLockup: {
        navigationUrl: "https://www.linkedin.com/in/" + name,
        title: { text: name },
      },
      reactionType: "LIKE",
    };
  });
  return {
    data: {
      data: {
        socialDashReactionsByReactionType: {
          paging: { start, total: 4 },
          "*elements": included.map((row) => row.entityUrn),
        },
      },
    },
    included,
  };
}

describe("read reactions for the exact activity", () => {
  it("binds the attributed post on one card even when recommendations are present", () => {
    const doc = new JSDOM(
      '<main><article data-attributed-urn="urn:li:share:10" data-activity-urn="urn:li:activity:12"></article><article data-attributed-urn="urn:li:share:11" data-activity-urn="urn:li:activity:13"></article></main>',
    ).window.document;
    expect(attributedActivity(doc, post)).toBe(activity);
    expect(attributedActivity(doc, "urn:li:share:12")).toBeNull();
    doc
      .querySelector("article")!
      .after(doc.querySelector("article")!.cloneNode());
    expect(attributedActivity(doc, post)).toBeNull();
  });
  it("validates each reaction, deduplicates overlap, advances by raw offset, and rejects another post", () => {
    const first = reactionPage(
      response(activity, ["alice", "bob"], 0),
      activity,
      2,
      0,
      new Set(),
    );
    expect(first.next?.reaction_offset).toBe(2);
    const second = reactionPage(
      response(activity, ["bob", "carol"], 2),
      activity,
      2,
      2,
      new Set(first.next!.seen),
    );
    expect(second.items.map((row) => row.name)).toEqual(["carol"]);
    expect(second.next).toBeUndefined();
    expect(() =>
      reactionPage(
        response("urn:li:activity:99", ["alice"], 0),
        activity,
        2,
        0,
        new Set(),
      ),
    ).toThrow("reaction_target_unverified");
    expect(() =>
      reactionPage(response(activity, ["alice"], 0), activity, 2, 2, new Set()),
    ).toThrow("reaction_response_shape_changed");
  });
});
