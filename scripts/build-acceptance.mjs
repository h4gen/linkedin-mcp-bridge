import { readFile, stat } from "node:fs/promises";
import { runtimeFingerprint } from "./runtime-fingerprint.mjs";
export async function acceptanceDefine() {
  const fingerprint = await runtimeFingerprint();
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  const result = { fingerprint, version, passed: [] };
  try {
    const config = JSON.parse(await readFile("store/release.json", "utf8"));
    const proof = JSON.parse(
      await readFile(config.acceptance_manifest, "utf8"),
    );
    if (proof.fingerprint === fingerprint && proof.version === version)
      for (const [name, row] of Object.entries(proof.capabilities ?? {}))
        if (
          row.status === "passed" &&
          row.evidence_path &&
          (await stat(row.evidence_path).catch(() => null))
        )
          result.passed.push(name);
  } catch {
    /* No acceptance without evidence matching executable source. */
  }
  return JSON.stringify(JSON.stringify(result));
}
