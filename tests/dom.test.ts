import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { domOperation } from "../src/extension/dom.js";
function page(html: string) {
  const dom = new JSDOM(html, { url: "https://www.linkedin.com/feed/" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("innerHeight", 800);
  return dom;
}
afterEach(() => vi.unstubAllGlobals());
it("reads modern SDUI cards without legacy class names", async () => {
  page(
    '<div role="listitem" componentkey="postContentUrn:urn:li:activity:123"><h2>Feed post</h2><button aria-label="Open control menu for post by Example Author"></button><div data-testid="expandable-text-box">A useful post</div><button aria-label="Comment"></button><button aria-label="Repost"></button></div>',
  );
  const result = await domOperation("feed_list", { limit: 1 }, {});
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    entityUrn: "urn:li:activity:123",
    text: "A useful post",
    author: "Example Author",
  });
  const detail = await domOperation(
    "post_get",
    { post_urn: "urn:li:activity:123" },
    {},
  );
  expect(detail.text).toBe("A useful post");
});
it("retains readable SDUI posts with a local scan key when LinkedIn omits their URN", async () => {
  page(
    '<div role="listitem"><button aria-label="Open control menu for post by Example"></button><div data-testid="expandable-text-box">No visible permalink</div></div>',
  );
  const result = await domOperation("feed_list", { limit: 1 }, {});
  expect(result.items[0].entityUrn).toBeNull();
  expect(result.items[0].scan_key).toMatch(/^local:/);
  expect(result.partial).toBe(true);
});
it("rejects duplicate post targets instead of choosing the first", async () => {
  page(
    '<div data-urn="urn:li:activity:123"></div><div data-urn="urn:li:activity:123"></div>',
  );
  await expect(
    domOperation("post_get", { post_urn: "urn:li:activity:123" }, {}),
  ).rejects.toThrow("post_target_not_unique");
});

it("scrolls the nearest actual overflow container to discover another page", async () => {
  const dom = page(
    '<div id="scroller" style="overflow-y:auto"><main><div role="listitem"><button aria-label="Open control menu for post by One"></button><div data-testid="expandable-text-box">First</div></div></main></div>',
  );
  const scroller = dom.window.document.querySelector("#scroller")!;
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  Object.defineProperty(scroller, "clientHeight", { value: 500 });
  const scroll = vi.fn(() => {
    scroller.innerHTML +=
      '<div role="listitem"><button aria-label="Open control menu for post by Two"></button><div data-testid="expandable-text-box">Second</div></div>';
  });
  Object.defineProperty(scroller, "scrollBy", { value: scroll });
  const result = await domOperation("feed_list", { limit: 2 }, {});
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(result.items.map((x: any) => x.text)).toEqual(["First", "Second"]);
});

it("reads only the resolved post's comments and excludes controls from comment text", async () => {
  const { extractionOperation } = await import(
    "../src/extension/extraction.js"
  );
  page(
    '<main><div data-mcp-post-urn="urn:li:share:1"><div componentkey="replaceableComment_one"><a href="/in/author"><p>Author</p><p>Founder</p></a><button aria-label="View more options for Author’s comment."></button><div data-testid="expandable-text-box">Useful comment<button>more</button></div></div></div><div componentkey="replaceableComment_other"><a href="/in/unrelated"><p>Unrelated</p></a><p>Do not extract me</p></div></main>',
  );
  const result = await extractionOperation(
    "comments_list",
    { post_urn: "urn:li:share:1", limit: 3 },
    {},
  );
  expect(result.items).toHaveLength(1);
  expect(result.items[0].text).toBe("Useful comment");
  expect(result.items[0].truncated).toBe(true);
  const next = await extractionOperation(
    "comments_list",
    { post_urn: "urn:li:share:1", limit: 3 },
    result.next,
  );
  expect(next.items).toEqual([]);
  expect(next.partial).toBe(true);
});
