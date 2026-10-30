import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { runtimeFingerprint } from "./runtime-fingerprint.mjs";
const store = process.argv.includes("--store");
const r = JSON.parse(await readFile("store/release.json", "utf8"));
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const fingerprint = await runtimeFingerprint();
const failures = [];
if (r.version !== version)
  failures.push("Release version differs from package version");
const manifest = JSON.parse(
  await readFile("dist/extension/manifest.json", "utf8").catch(() => "{}"),
);
if (manifest.version !== version)
  failures.push("Build extension first; version does not match");
for (const file of ["dist/cli.js", "dist/host.js"])
  if (!(await stat(file).catch(() => null)))
    failures.push("Missing build artifact " + file);
const built = JSON.parse(
  await readFile("dist/build.json", "utf8").catch(() => "{}"),
);
if (built.fingerprint !== fingerprint)
  failures.push("Build artifacts do not match current runtime fingerprint");
if (store) {
  if (
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      encoding: "utf8",
    }).trim()
  )
    failures.push("Commit release source before submission");
  if (!/^[a-p]{32}$/.test(r.store_extension_id ?? ""))
    failures.push("Missing valid Chrome Web Store extension ID");
  if (built.channel !== "pilot")
    failures.push("Build with BRIDGE_CHANNEL=pilot for Chrome Web Store");
  if (!r.privacy_policy_url?.startsWith("https://"))
    failures.push("Missing public privacy policy URL");
  if (r.visibility !== "public")
    failures.push("Store visibility must be public");
  if (!r.screenshots.length) failures.push("Missing actual UI screenshots");
  for (const file of r.screenshots) {
    const bytes = await readFile(file).catch(() => null);
    if (
      !bytes ||
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      !["1280x800", "640x400"].includes(
        bytes.readUInt32BE(16) + "x" + bytes.readUInt32BE(20),
      )
    )
      failures.push("Invalid screenshot: " + file);
  }
  let proof;
  try {
    proof = JSON.parse(await readFile(r.acceptance_manifest, "utf8"));
  } catch {
    failures.push("Missing current runtime acceptance manifest");
  }
  const bundle = await build({
    entryPoints: ["src/core/capabilities.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  const { capabilities } = await import(
    "data:text/javascript;base64," +
      Buffer.from(bundle.outputFiles[0].text).toString("base64")
  );
  for (const name of Object.keys(capabilities)) {
    const row = proof?.capabilities?.[name];
    if (
      proof?.fingerprint !== fingerprint ||
      proof?.version !== version ||
      row?.status !== "passed" ||
      !row?.evidence_path ||
      !(await stat(row.evidence_path).catch(() => null))
    )
      failures.push("Missing runtime-bound capability acceptance: " + name);
  }
  for (const platform of ["darwin", "win32"]) {
    const row = proof?.installation?.[platform];
    if (
      proof?.fingerprint !== fingerprint ||
      row?.status !== "passed" ||
      !row?.evidence_path ||
      !(await stat(row.evidence_path).catch(() => null))
    )
      failures.push("Missing installation acceptance: " + platform);
  }
}
console.log(
  JSON.stringify(
    {
      ready: !failures.length,
      scope: store ? "store_submission" : "local_build",
      version,
      fingerprint,
      blockers: failures,
    },
    null,
    2,
  ),
);
process.exitCode = failures.length ? 1 : 0;
