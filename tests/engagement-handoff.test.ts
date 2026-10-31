import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { domOperation } from "../src/extension/dom.js";
import { extractionOperation } from "../src/extension/extraction.js";
import { postContext, postUrlIdentity } from "../src/extension/post-context.js";
afterEach(() => vi.unstubAllGlobals());
it("distinguishes nested markers from independent duplicate cards and ignores quoted links", () => {
  const dom = new JSDOM(
    '<main><div data-urn="urn:li:activity:123"><div data-id="urn:li:activity:123"><div data-testid="expandable-text-box">Discussing <a href="https://www.linkedin.com/feed/update/urn:li:activity:999/">another post</a></div></div></div></main>',
    { url: "https://www.linkedin.com/feed/update/urn:li:activity:123/" },
  );
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  Object.defineProperty(document, "readyState", { value: "complete" });
  expect(postContext("urn:li:activity:123").identities).toEqual([
    "urn:li:activity:123",
  ]);
  expect(() => postContext("urn:li:activity:999")).toThrow(
    "post_target_not_found",
  );
  const duplicate = document.createElement("article");
  duplicate.setAttribute("data-urn", "urn:li:activity:123");
  document.querySelector("main")!.append(duplicate);
  expect(() => postContext("urn:li:activity:123")).toThrow(
    "post_target_ambiguous",
  );
  expect(postUrlIdentity("")).toBeNull();
  expect(postUrlIdentity("#")).toBeNull();
  expect(
    postUrlIdentity("https://foreign.invalid/feed/update/urn:li:activity:123/"),
  ).toBeNull();
});
it("accepts multiple identities only when the same scoped card exposes them", () => {
  const dom = new JSDOM(
    '<div componentkey="pagedCommentsContainer"><div data-urn="urn:li:activity:123"><button aria-label="Open control menu for post by Author"></button><a href="https://www.linkedin.com/posts/example_topic-ugcPost-456-id/">Send</a></div></div>',
    { url: "https://www.linkedin.com/feed/update/urn:li:activity:123/" },
  );
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  expect(postContext("urn:li:activity:123").root).toBe(
    postContext("urn:li:ugcPost:456").root,
  );
});
it.each(["share", "ugcPost"])(
  "hands a resolved native %s post to its comment reader",
  async (kind) => {
    const url = `https://www.linkedin.com/posts/example_topic-${kind}-123-abcd/`;
    const dom = new JSDOM(
      `<main><div componentkey="pagedCommentsContainer"><div role="listitem"><button aria-label="Open control menu for post by Author"></button><p data-testid="expandable-text-box">Relevant post</p><a href="${url}">Send</a></div><div componentkey="replaceableComment_urn:li:comment:(${kind}:123,456)"><a href="/in/commenter/"><p>Commenter</p></a><button aria-label="View more options for Commenter’s comment."></button><p data-testid="expandable-text-box">How can I use this integration?</p></div></div></main>`,
      { url },
    );
    for (const key of ["window", "document", "location"])
      vi.stubGlobal(key, (dom.window as any)[key] ?? dom.window);
    dom.window.Element.prototype.getClientRects = () => [{}] as any;
    const post = await domOperation("post_resolve", { url }, {});
    expect(post.entityUrn).toBe(`urn:li:${kind}:123`);
    const comments = await extractionOperation(
      "comments_list",
      { post_urn: post.entityUrn, limit: 1 },
      {},
    );
    expect(comments.bridge_error).toBeUndefined();
    expect(comments.items[0]).toMatchObject({
      text: "How can I use this integration?",
      identity_quality: "source",
    });
  },
);
