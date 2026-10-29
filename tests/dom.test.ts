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
