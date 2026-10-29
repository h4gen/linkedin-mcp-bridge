import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
export async function acceptanceDefine() {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  const result = { revision, version, passed: [] };
  try {
    const config = JSON.parse(await readFile("store/release.json", "utf8"));
    const proof = JSON.parse(
      await readFile(config.acceptance_manifest, "utf8"),
    );
    const clean = !execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim();
    if (clean && proof.revision === revision && proof.version === version)
      for (const [name, row] of Object.entries(proof.capabilities ?? {}))
        if (
          row.status === "passed" &&
          row.evidence_path &&
          (await stat(row.evidence_path).catch(() => null))
        )
          result.passed.push(name);
  } catch {
    /* No acceptance is asserted without valid local evidence. */
  }
  return JSON.stringify(JSON.stringify(result));
}
