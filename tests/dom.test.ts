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
  ).resolves.toEqual({ bridge_error: "post_target_not_unique" });
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

it("does not collapse identical comments without source IDs", async () => {
  const { extractionOperation } = await import(
    "../src/extension/extraction.js"
  );
  const comment =
    '<div class="comments-comment-item"><a href="/in/author"><p>Author</p></a><div data-testid="expandable-text-box">Same text</div></div>';
  page(
    '<main><div data-mcp-post-urn="urn:li:share:1">' +
      comment +
      comment +
      "</div></main>",
  );
  const result = await extractionOperation(
    "comments_list",
    { post_urn: "urn:li:share:1", limit: 2 },
    {},
  );
  expect(result.items).toHaveLength(2);
  expect(new Set(result.items.map((x: any) => x.id)).size).toBe(2);
  expect(result.items.every((x: any) => x.identity_quality === "session")).toBe(
    true,
  );
});

it("keeps an owned reaction dialog open across cursor pages", async () => {
  const { extractionOperation } = await import(
    "../src/extension/extraction.js"
  );
  const dom = page(
    '<main><div data-mcp-post-urn="urn:li:share:1"></div></main><div role="dialog" data-bridge-post="urn:li:share:1"><h2>Reactions</h2><div data-testid="lazy-column">' +
      Array.from(
        { length: 8 },
        (_, i) =>
          `<a href="https://www.linkedin.com/in/person-${i}/"><p>Person ${i}</p><p>Founder</p></a>`,
      ).join("") +
      '<button aria-label="Dismiss">Close</button></div></div>',
  );
  vi.stubGlobal(
    "getComputedStyle",
    dom.window.getComputedStyle.bind(dom.window),
  );
  const dialog = dom.window.document.querySelector('[role="dialog"]')!;
  Object.defineProperty(dialog, "getClientRects", { value: () => [{}] });
  const dismiss = vi.fn();
  dialog.querySelector("button")!.addEventListener("click", dismiss);
  const args = { post_urn: "urn:li:share:1", limit: 4 };
  const first = await extractionOperation("reactions_list", args, {
    dom_session: "owned",
  });
  const second = await extractionOperation("reactions_list", args, {
    ...first.next,
    dom_session: "owned",
  });
  expect([...first.items, ...second.items]).toHaveLength(8);
  expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(
    8,
  );
  expect(dismiss).not.toHaveBeenCalled();
});

it("checks both exact profile identity and visible first-degree evidence", async () => {
  const { firstDegreeConnection } = await import(
    "../src/extension/profile-state.js"
  );
  const dom = page(
    '<section><h2>Ada</h2><p id="degree">· 1st</p><a href="https://www.linkedin.com/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3Aada">Message</a></section>',
  );
  dom.reconfigure({ url: "https://www.linkedin.com/in/ada/" });
  const degree = dom.window.document.querySelector("#degree")!;
  Object.defineProperty(degree, "getClientRects", { value: () => [{}] });
  expect(
    firstDegreeConnection(
      "https://www.linkedin.com/in/ada/",
      "urn:li:fsd_profile:ada",
    ),
  ).toBe(true);
  expect(
    firstDegreeConnection(
      "https://www.linkedin.com/in/ada/",
      "urn:li:fsd_profile:other",
    ),
  ).toBe(false);
  degree.textContent = "· 2nd";
  expect(
    firstDegreeConnection(
      "https://www.linkedin.com/in/ada/",
      "urn:li:fsd_profile:ada",
    ),
  ).toBe(false);
});

it("returns missing scan targets as serializable errors across executeScript", async () => {
  page("<main></main>");
  const result = await domOperation(
    "post_resolve",
    { scan_key: "local:gone" },
    {},
  );
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    bridge_error: "post_target_not_unique",
  });
});
