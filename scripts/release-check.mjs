import { readFile, stat } from "node:fs/promises";
const r = JSON.parse(await readFile("store/release.json", "utf8"));
const failures = [];
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
for (const file of r.screenshots)
  if (!(await stat(file).catch(() => null)))
    failures.push("Missing screenshot " + file);
for (const arch of ["arm64", "x64"]) {
  const artifact = r.signed_companions.find((x) => x.arch === arch);
  if (!artifact) {
    failures.push("Missing notarized companion " + arch);
    continue;
  }
  const receipt = JSON.parse(await readFile(artifact.notary_receipt, "utf8"));
  if (receipt.status !== "Accepted")
    failures.push("Notarization not accepted " + arch);
}
if (!r.live_acceptance_passed) failures.push("Live acceptance is not complete");
console.log(
  JSON.stringify({ ready: failures.length === 0, blockers: failures }, null, 2),
);
process.exitCode = failures.length ? 1 : 0;
