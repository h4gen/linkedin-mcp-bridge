import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
const r = JSON.parse(await readFile("store/release.json", "utf8"));
const failures = [];
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const version = JSON.parse(await readFile("package.json", "utf8")).version;
if (r.version !== version)
  failures.push("Release version differs from package version");
if (
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim()
)
  failures.push("Release source has uncommitted changes");
for (const field of [
  "developer_name",
  "support_email",
  "homepage_url",
  "privacy_policy_url",
  "store_extension_id",
])
  if (!r[field]) failures.push("Missing " + field);
if (r.store_extension_id && !/^[a-p]{32}$/.test(r.store_extension_id))
  failures.push("Invalid store extension ID");
for (const field of ["homepage_url", "privacy_policy_url"])
  if (r[field] && !r[field].startsWith("https://"))
    failures.push(field + " must use HTTPS");
if (!r.screenshots.length)
  failures.push("Missing actual 1280×800 or 640×400 UI screenshots");
for (const file of r.screenshots) {
  const bytes = await readFile(file).catch(() => null);
  if (!bytes || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    failures.push("Missing or invalid PNG screenshot " + file);
    continue;
  }
  const dimensions = bytes.readUInt32BE(16) + "x" + bytes.readUInt32BE(20);
  if (!["1280x800", "640x400"].includes(dimensions))
    failures.push("Invalid screenshot dimensions " + file);
}
for (const arch of ["arm64", "x64"]) {
  const a = r.signed_companions.find((x) => x.arch === arch);
  if (!a) {
    failures.push("Missing notarized companion " + arch);
    continue;
  }
  try {
    const receipt = JSON.parse(await readFile(a.notary_receipt, "utf8"));
    const bytes = await readFile(a.path);
    if (
      receipt.status !== "Accepted" ||
      a.revision !== revision ||
      a.sha256 !== createHash("sha256").update(bytes).digest("hex")
    )
      throw Error("Evidence mismatch");
    execFileSync("pkgutil", ["--check-signature", a.path], { stdio: "pipe" });
    execFileSync("xcrun", ["stapler", "validate", a.path], { stdio: "pipe" });
    if (
      !a.fresh_install_acceptance ||
      !(await stat(a.fresh_install_acceptance))
    )
      throw Error("Missing fresh-machine acceptance");
  } catch {
    failures.push(
      "Invalid signature, artifact, revision or install evidence " + arch,
    );
  }
}
// Use the same registry as MCP rather than maintaining a second tool list.
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
let acceptance;
try {
  acceptance = JSON.parse(await readFile(r.acceptance_manifest, "utf8"));
} catch {
  failures.push("Missing build-bound capability acceptance manifest");
}
for (const [name, c] of Object.entries(capabilities)) {
  if (!c.required) continue;
  const proof = acceptance?.capabilities?.[name];
  if (!c.enabled) failures.push("Required capability disabled: " + name);
  if (
    acceptance?.revision !== revision ||
    acceptance?.version !== version ||
    proof?.status !== "passed" ||
    !proof?.evidence_path ||
    !(await stat(proof.evidence_path).catch(() => null))
  )
    failures.push("Missing current-build acceptance: " + name);
}
console.log(
  JSON.stringify(
    { ready: failures.length === 0, revision, version, blockers: failures },
    null,
    2,
  ),
);
process.exitCode = failures.length ? 1 : 0;
