import { it, expect } from "vitest";
import { platformPaths, launcherText } from "../src/native/platform.js";
import {
  descriptions,
  schemas,
  serverInstructions,
} from "../src/core/contracts.js";
it("uses Windows user registration and a user-specific pipe, not a Unix socket", () => {
  const a = platformPaths(
    "win32",
    "C:\\Users\\Ada",
    "C:\\Users\\Ada\\AppData\\Local",
    "com.test",
    false,
  );
  const b = platformPaths(
    "win32",
    "C:\\Users\\Other",
    undefined,
    "com.test",
    false,
  );
  expect(a.socketPath).toMatch(/^\\\\\.\\pipe\\linkedin-mcp-/);
  expect(a.socketPath).not.toBe(b.socketPath);
  expect(a.registryKey).toBe(
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.test",
  );
  expect(a.manifestPath).toContain("AppData\\Local");
  expect(
    platformPaths("darwin", "/Users/Ada", undefined, "com.test", false)
      .socketPath,
  ).toContain("/bridge.sock");
  expect(() =>
    platformPaths("linux", "/home/a", undefined, "com.test", false),
  ).toThrow("Supported platforms");
});
it("quotes launcher paths without interpreting shell metacharacters", () => {
  expect(
    launcherText(
      "win32",
      "C:\\Program Files\\node.exe",
      "C:\\ü & ! %USER%\\host.js",
    ),
  ).toContain('"C:\\ü & ! %%USER%%\\host.js"');
  expect(launcherText("win32", "node.exe", "host.js")).toContain(
    "DisableDelayedExpansion",
  );
  expect(launcherText("darwin", "/a'b/node", "/a $(bad)/host.js")).toContain(
    "'/a $(bad)/host.js'",
  );
  expect(() => launcherText("win32", "node\n.exe", "host.js")).toThrow();
});
it("explains every primitive and leaves orchestration with the agent", () => {
  expect(Object.keys(descriptions).sort()).toEqual(Object.keys(schemas).sort());
  expect(serverInstructions).toContain("agent owns prioritization");
  expect(descriptions.conversations_search).toContain(
    "not a full server-side search",
  );
  expect(descriptions.post_comment).toContain("immediate public action");
  expect(descriptions.post_schedule).toContain("Never publishes immediately");
});
