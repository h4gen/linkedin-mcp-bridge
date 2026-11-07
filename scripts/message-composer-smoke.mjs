// Real, isolated Chromium editor and event semantics. Every page request is
// fulfilled locally. No logged-in session, network transmission or real DM.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<main><div class="msg-inmail-compose-form-v2"><div class="msg-compose__inmail-compose-entity-lockup"><a href="/in/example/">Example</a></div><p>Free message | <strong><a href="/help/">Why?</a></strong></p><form><div role="textbox" contenteditable="true"><p><br></p></div><button type="button">Send</button></form></div></main>',
    }),
  );
  await page.goto(
    "https://www.linkedin.com/messaging/compose/?profileUrn=urn:li:fsd_profile:peer&recipient=peer",
  );
  await page.addScriptTag({ path: "dist/extension/page-adapters.js" });
  const result = await page.evaluate(async () => {
    const a = {
      profile_urn: "urn:li:fsd_profile:peer",
      profile_url: "https://www.linkedin.com/in/example/",
      execution_session: "private-local",
      execution_deadline: Date.now() + 5000,
      text: "Hello!\n\nhttps://example.org/path",
    };
    await window.__liBridgeAdapters(
      "session_begin",
      { token: a.execution_session },
      {},
    );
    const observed = await window.__liBridgeAdapters("message_composer", a, {});
    let clicks = 0;
    document.querySelector("button").onclick = () => clicks++;
    const sent = await window.__liBridgeAdapters(
      "message_composer",
      { ...a, dispatch: true },
      {},
    );
    return {
      cost: observed.cost,
      dispatch: sent.dispatch_state,
      clicks,
      paragraphs: [...document.querySelectorAll("[role=textbox] p")].map(
        (p) => p.textContent,
      ),
    };
  });
  assert.deepEqual(result, {
    cost: "free",
    dispatch: "dispatched",
    clicks: 1,
    paragraphs: ["Hello!", "", "https://example.org/path"],
  });
  console.log(
    "Private Chromium composer: confirmed exact paragraphs, link and one click.",
  );
} finally {
  await browser.close();
}
