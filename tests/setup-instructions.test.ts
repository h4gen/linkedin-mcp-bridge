import { it, expect } from "vitest";
import { agentInstructions, RELEASE_REF } from "../src/setup.js";
import { VERSION } from "../src/version.js";
import fs from "node:fs/promises";
it("pins both client prompts and keeps repair/uninstall scoped", () => {
  for (const client of ["codex", "claude"] as const) {
    const p = agentInstructions(client, "a".repeat(32));
    expect(p).toContain("Required release: v" + VERSION);
    expect(p).toContain("a".repeat(32));
    expect(p).toContain("docs/INSTALL_AGENT.md");
    expect(p).toContain("32 tools");
    expect(agentInstructions(client, "a".repeat(32), "repair")).toContain(
      "repair or update",
    );
    expect(agentInstructions(client, "a".repeat(32), "uninstall")).toContain(
      "Remove only this installation",
    );
  }
  expect(RELEASE_REF).toBe("v" + VERSION);
});
it("documents both entry orders, no main drift, selected user-scope clients and read-only acceptance", async () => {
  const d = await fs.readFile("docs/INSTALL_AGENT.md", "utf8");
  for (const text of [
    "published_version",
    "Do not substitute current",
    "--scope user",
    "codex mcp get linkedin",
    "Claude Code",
    "No extra consent checkbox",
    "No setup acceptance sends",
    "actual selected client",
  ])
    expect(d).toContain(text);
});
