import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeFingerprint } from "../scripts/runtime-fingerprint.mjs";
it("binds acceptance to runtime and store identity but not documentation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "li-fingerprint-"));
  try {
    for (const folder of ["src", "assets", "scripts", "store", "docs"]) await mkdir(join(dir, folder));
    for (const file of ["package.json", "package-lock.json", "tsconfig.json", "src/main.ts"]) await writeFile(join(dir, file), "{}");
    await writeFile(join(dir, "store/release.json"), JSON.stringify({store_extension_id:null}));
    const first = await runtimeFingerprint(dir);
    await writeFile(join(dir, "docs/report.md"), "new report");
    expect(await runtimeFingerprint(dir)).toBe(first);
    await writeFile(join(dir, "src/main.ts"), "changed code");
    const second = await runtimeFingerprint(dir);
    expect(second).not.toBe(first);
    await writeFile(join(dir, "store/release.json"), JSON.stringify({store_extension_id:"a".repeat(32)}));
    expect(await runtimeFingerprint(dir)).not.toBe(second);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
