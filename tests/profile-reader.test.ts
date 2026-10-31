import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  profileReader,
  prepareProfile,
  readProfileRelationship,
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
it("reads Connect only from the exact profile's More menu and closes it", async () => {
  profile("<aside><button>Connect</button></aside>");
  document.querySelector("p")!.textContent = "• 3rd";
  const more = document.createElement("button");
  more.textContent = "More";
  more.setAttribute("aria-controls", "own-menu");
  more.onclick = () => {
    if (document.getElementById("own-menu")) {
      document.getElementById("own-menu")!.remove();
      more.setAttribute("aria-expanded", "false");
      return;
    }
    more.setAttribute("aria-expanded", "true");
    const menu = document.createElement("div");
    menu.id = "own-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML =
      '<button role="menuitem" aria-label="Invite Example to connect">Connect</button>';
    document.body.append(menu);
  };
  document.querySelector("section")!.append(more);
  const result = await readProfileRelationship(
    "https://www.linkedin.com/in/example/",
    "urn:li:fsd_profile:example",
  );
  expect(result).toMatchObject({
    connection_degree: "3",
    action_scan: { menu_opened: true, reason: "profile_actions_observed" },
  });
  expect((result as any).evidence).toContainEqual({
    source: "verified_profile_more_menu",
    value: "connect_available",
  });
  expect(document.getElementById("own-menu")).toBeNull();
});
it("explains missing actions on a restricted top card without reading recommendations", async () => {
  profile("<aside><button>Pending</button></aside>");
  document.querySelector("p")!.textContent = "";
  const result = await readProfileRelationship(
    "https://www.linkedin.com/in/example/",
    "urn:li:fsd_profile:example",
  );
  expect(result).toMatchObject({
    status: "unknown",
    connection_degree: "unknown",
    evidence: [],
    action_scan: { reason: "profile_actions_unavailable" },
  });
});
it("records second-degree and accessible Connect action independently", () => {
  profile("");
  document.querySelector("p")!.textContent = "• 2nd";
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Connect with Example");
  document.querySelector("section")!.append(button);
  const relationship = profileReader(
    "https://www.linkedin.com/in/example/",
    "urn:li:fsd_profile:example",
  ).relationship;
  expect(relationship).toMatchObject({ connection_degree: "2" });
  expect(relationship?.evidence).toContainEqual({
    source: "verified_profile_action",
    value: "connect_available",
  });
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
