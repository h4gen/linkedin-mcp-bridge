import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  replyPermalink,
  visibleCommentProof,
} from "../src/extension/comment-proof.js";

afterEach(() => vi.unstubAllGlobals());
it("requires native permalink proof of the exact parent, reply and post", () => {
  const parent = "replaceableComment_urn:li:comment:(activity:123,456)";
  const reply = "replaceableComment_urn:li:comment:(activity:123,789)";
  const url = new URL(
    "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  );
  url.searchParams.set(
    "dashCommentUrn",
    "urn:li:fsd_comment:(456,urn:li:activity:123)",
  );
  url.searchParams.set(
    "dashReplyUrn",
    "urn:li:fsd_comment:(789,urn:li:activity:123)",
  );
  expect(replyPermalink(url.href, parent, reply)).toBe(true);
  expect(replyPermalink(url.href, reply, parent)).toBe(false);
  expect(replyPermalink(url.href, parent, parent)).toBe(false);
  expect(
    replyPermalink(
      url.href.replace("www.linkedin.com", "example.com"),
      parent,
      reply,
    ),
  ).toBe(false);
  expect(
    replyPermalink(
      url.href.replace("activity:123/", "activity:999/"),
      parent,
      reply,
    ),
  ).toBe(false);
  url.searchParams.delete("dashCommentUrn");
  expect(replyPermalink(url.href, parent, reply)).toBe(false);
});

it("rechecks the unique reply text and exact author on the resolved document", () => {
  const dom = new JSDOM(
    '<div componentkey="replaceableComment_urn:li:comment:(activity:123,789)"><a href="/in/me/">Me</a><span data-testid="expandable-text-box">Reply</span></div>',
    { url: "https://www.linkedin.com/feed/" },
  );
  vi.stubGlobal("document", dom.window.document);
  const id = "replaceableComment_urn:li:comment:(activity:123,789)";
  expect(
    visibleCommentProof(id, "Reply", "https://www.linkedin.com/in/me/"),
  ).toBe(true);
  expect(
    visibleCommentProof(id, "Reply", "https://www.linkedin.com/in/other/"),
  ).toBe(false);
  expect(
    visibleCommentProof(id, "Different", "https://www.linkedin.com/in/me/"),
  ).toBe(false);
  document.body.append(document.body.firstElementChild!.cloneNode(true));
  expect(
    visibleCommentProof(id, "Reply", "https://www.linkedin.com/in/me/"),
  ).toBe(false);
});

import {
  commentText,
  commentHash,
  freshComment,
  commentCreatedAt,
} from "../src/core/comment-proof.js";
it("matches presentation whitespace but preserves URL and text content", async () => {
  expect(await commentHash("Hello\n\nhttps://example.com/a")).toBe(
    await commentHash("Hello \u00a0https://example.com/a"),
  );
  expect(await commentHash("Hello https://example.com/a")).not.toBe(
    await commentHash("Hello https://example.com/b"),
  );
  expect(commentText(" Héllo\n世界 ")).toBe("Héllo 世界");
});
it("requires fresh native comment identity, excludes older and previously seen IDs", () => {
  const id =
    "replaceableComment_urn:li:comment:(activity:7513342471389573120,7523339271555158016)";
  const time = Date.parse("2026-11-03T11:04:19.223Z");
  expect(commentCreatedAt(id)).toBe(time);
  expect(
    freshComment(id, { before_ids: [], observed_at: time - 1000 }, time + 1000),
  ).toBe(true);
  expect(
    freshComment(id, { before_ids: [], observed_at: time + 1 }, time + 1000),
  ).toBe(false);
  expect(
    freshComment(
      id,
      {
        before_ids: [id.replace("replaceableComment_", "")],
        observed_at: time - 1000,
      },
      time + 1000,
    ),
  ).toBe(false);
  expect(
    freshComment(
      "urn:li:comment:unknown",
      { before_ids: [], observed_at: time - 1000 },
      time + 1000,
    ),
  ).toBe(false);
});
