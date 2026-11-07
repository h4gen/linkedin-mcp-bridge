// Live read-only acceptance. Never starts Chrome, drives the UI or attaches a debugger.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
const mode = process.argv[2];
assert(
  ["background_tab", "separate_window"].includes(mode),
  "Specify background_tab or separate_window",
);
const build = JSON.parse(await readFile("dist/build.json", "utf8"));
const report = {
  fingerprint: build.fingerprint,
  version: build.version,
  platform: process.platform,
  mode,
  started: new Date().toISOString(),
  status: "incomplete",
  idle_ms: 0,
  runs: [],
};
const safe = new Set([
  "health",
  "conversations_list",
  "messages_list",
  "posts_search",
  "post_resolve",
  "post_get",
  "comments_list",
  "reactions_list",
  "profile_get",
  "profile_posts_list",
]);
const client = new Client({
  name: "workspace-readonly-acceptance",
  version: build.version,
});
const knownPost =
  "https://www.linkedin.com/posts/dotunogunrinde_we-sit-down-to-prospect-next-thing-we-know-share-7515697692363161600-hXIQ/";
let account,
  rows,
  lastSequence = -1;
async function call(op, args = {}) {
  assert(safe.has(op));
  const result = await client.callTool(
    {
      name: "linkedin_" + op,
      arguments: op === "health" ? {} : { account_urn: account, ...args },
    },
    undefined,
    { timeout: 75000 },
  );
  assert(
    !result.isError,
    op + ": " + (result.structuredContent?.error?.code ?? "tool_error"),
  );
  return result.structuredContent;
}
async function health() {
  const h = await call("health");
  assert(
    h.connected &&
      h.account_urn &&
      h.version === build.version &&
      h.capabilities[0]?.acceptance_fingerprint === build.fingerprint,
    "matching connected build required; no DOM calls executed",
  );
  assert(
    h.workspace?.mode === mode && h.workspace?.measurement_active,
    "select the requested mode and start focus measurement in Dev settings",
  );
  if (account) assert.equal(h.account_urn, account, "account changed");
  account = h.account_urn;
  return h;
}
async function read(op, args = {}) {
  const result = await call(op, args);
  const m = (await health()).workspace.last;
  assert(m && m.sequence > lastSequence, "missing fresh measurement");
  lastSequence = m.sequence;
  rows.push({ op, count: result.items?.length, partial: result.partial, ...m });
  assert(
    m?.op === op && m.complete && m.ok,
    "incomplete focus measurement: " + op,
  );
  assert(
    !m.work_foreground &&
      !m.document_focused &&
      !m.activations &&
      !m.window_focus_events,
    "focus change during " +
      op +
      "; repeat the measurement without manual switches",
  );
  assert(m.selection_stable, "front selection changed during " + op);
  if (mode === "background_tab")
    assert.deepEqual(m.visibility, ["hidden"], "background tab was visible");
  return result;
}
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js", "mcp"],
    }),
  );
  await health();
  for (let i = 0; i < 3; i++) {
    if (i === 2) {
      console.log("Six-minute idle interval; no polling.");
      const t = Date.now();
      await delay(360000);
      report.idle_ms = Date.now() - t;
    }
    rows = [];
    report.runs.push(rows);
    const inbox = await read("conversations_list", { limit: 1 });
    assert(inbox.items[0], "empty inbox fixture");
    const messages = await read("messages_list", {
      conversation_urn: inbox.items[0].entityUrn,
      limit: 2,
    });
    assert(messages.items.length, "empty message fixture");
    const query = { query: "LinkedIn MCP", limit: 2, sort: "relevance" };
    const first = await read("posts_search", query);
    assert(first.next_cursor && first.items.length);
    const second = await read("posts_search", {
      ...query,
      cursor: first.next_cursor,
    });
    assert(second.items.length);
    const seen = new Set(first.items.map((p) => p.entityUrn ?? p.scan_key));
    assert(second.items.every((p) => !seen.has(p.entityUrn ?? p.scan_key)));
    const post = await read("post_resolve", { url: knownPost });
    assert(post.entityUrn);
    const target = { post_urn: post.entityUrn };
    const full = await read("post_get", target);
    assert(full.text && full.entityUrn === post.entityUrn);
    for (const op of ["comments_list", "reactions_list"])
      assert(
        (await read(op, { ...target, limit: 2 })).items.length,
        op + " had no evidence",
      );
    const person = post.author_identity;
    const { profile } = await read(
      "profile_get",
      person.entityUrn
        ? { profile_urn: person.entityUrn }
        : { public_identifier: person.public_identifier },
    );
    assert(profile.entityUrn);
    assert(
      (
        await read("profile_posts_list", {
          profile_urn: profile.entityUrn,
          limit: 2,
        })
      ).items.length,
    );
    console.log("Read pass " + (i + 1) + " verified.");
  }
  report.status = "passed";
} finally {
  await client.close();
  const dir = "artifacts/workspace-" + build.version;
  await mkdir(dir, { recursive: true });
  const file = dir + "/" + mode + "-" + Date.now() + ".json";
  await writeFile(file, JSON.stringify(report, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(file);
}
