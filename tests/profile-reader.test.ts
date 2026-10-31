import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  profileReader,
  prepareProfile,
} from "../src/extension/profile-reader.js";
function profile(body: string) {
  const dom = new JSDOM(
    `<main><section><h2>Example</h2><p>· 1st</p><p>Founder</p><p>Berlin</p><p>·</p><p><a href="/in/example/overlay/contact-info/">Contact info</a></p><a href="/messaging/compose/?profileUrn=urn:li:fsd_profile:example">Message</a></section>${body}</main>`,
    { url: "https://www.linkedin.com/in/example/" },
  );
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  dom.window.Element.prototype.getClientRects = () => [{}] as any;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("reads scoped profile sections without confusing headings and current roles", () => {
  profile(
    '<section><h2>About</h2><div data-testid="expandable-text-box"><p>Builds tools.</p></div></section><section><h2>Experience</h2><article><p>Founder</p><p>Example Co</p><p>2023 - Present</p></article><article><p>Engineer</p><p>Other Co</p><p>2020 - 2022</p></article></section>',
  );
  const r = profileReader(
    "https://www.linkedin.com/in/example/",
    "urn:li:fsd_profile:example",
  );
  expect(r.about).toEqual({ status: "available", text: "Builds tools." });
  expect(r.current_positions?.text).toBe("Founder\nExample Co\n2023 - Present");
  expect(r.relationship).toMatchObject({
    status: "connected",
    messaging: "allowed",
  });
  expect(r.location?.text).toBe("Berlin");
});
it("missing sections are unavailable, not invented from the headline", () => {
  profile("");
  expect(
    profileReader(
      "https://www.linkedin.com/in/example/",
      "urn:li:fsd_profile:example",
    ).current_positions,
  ).toEqual({ status: "unavailable", text: null });
});
it("fails closed when profile route changed", () => {
  profile("");
  expect(
    profileReader(
      "https://www.linkedin.com/in/other/",
      "urn:li:fsd_profile:other",
    ).bridge_error,
  ).toBe("profile_navigation_changed");
});

it("loads the profile's lazy post link even when Experience is already present", async () => {
  vi.useFakeTimers();
  profile("<section><h2>Experience</h2></section>");
  const main = document.querySelector("main")!;
  Object.defineProperty(document, "scrollingElement", { value: main });
  const scroll = vi.fn(() => {
    if (scroll.mock.calls.length === 2) {
      const link = document.createElement("a");
      link.href = "/in/example/recent-activity/all/";
      link.textContent = "Show all posts";
      main.append(link);
    }
  });
  Object.defineProperty(main, "scrollBy", { value: scroll });
  const pending = prepareProfile(
    "https://www.linkedin.com/in/example/",
    "posts",
  );
  await vi.runAllTimersAsync();
  await pending;
  expect(scroll).toHaveBeenCalledTimes(2);
  expect(
    profileReader(
      "https://www.linkedin.com/in/example/",
      "urn:li:fsd_profile:example",
    ).posts_url,
  ).toBe("https://www.linkedin.com/in/example/recent-activity/all/");
});
