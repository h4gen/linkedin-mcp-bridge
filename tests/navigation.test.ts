import { expect, it } from "vitest";
import { navigationTargetReached } from "../src/extension/navigation.js";

it("does not accept Chrome's old completed document while a permalink redirect is pending", () => {
  const previous = "https://www.linkedin.com/feed/update/urn:li:activity:123/";
  const short = "https://lnkd.in/p/example";
  expect(
    navigationTargetReached(
      { url: previous, pendingUrl: short },
      short,
      previous,
      true,
    ),
  ).toBe(false);
  expect(
    navigationTargetReached({ url: previous }, short, previous, true),
  ).toBe(false);
  const final = previous + "?dashCommentUrn=parent&dashReplyUrn=reply";
  expect(
    navigationTargetReached(
      { url: final, pendingUrl: short },
      short,
      previous,
      true,
    ),
  ).toBe(false);
  expect(navigationTargetReached({ url: final }, short, previous, true)).toBe(
    true,
  );
  expect(navigationTargetReached({ url: final }, short, previous, false)).toBe(
    false,
  );
  expect(
    navigationTargetReached(
      { url: "https://example.com/posts/x" },
      short,
      previous,
      true,
    ),
  ).toBe(false);
});

it("requires exact non-pending destinations for ordinary navigation", () => {
  const target = "https://www.linkedin.com/in/example/";
  expect(navigationTargetReached({ url: target }, target, target, false)).toBe(
    true,
  );
  expect(
    navigationTargetReached(
      { url: target, pendingUrl: target },
      target,
      target,
      false,
    ),
  ).toBe(false);
  expect(
    navigationTargetReached({ url: target + "other/" }, target, target, false),
  ).toBe(false);
});
