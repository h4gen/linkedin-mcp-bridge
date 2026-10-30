import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
export async function runtimeFingerprint(base = ".") {
  const files = ["package.json", "package-lock.json", "tsconfig.json"];
  async function walk(dir) {
    for (const entry of await readdir(join(base, dir), {
      withFileTypes: true,
    })) {
      const name = dir + "/" + entry.name;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  for (const dir of ["src", "assets", "scripts"]) await walk(dir);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file + "\0");
    hash.update(await readFile(join(base, file)));
    hash.update("\0");
  }
  const release = JSON.parse(
    await readFile(join(base, "store/release.json"), "utf8"),
  );
  hash.update(
    JSON.stringify({ store_extension_id: release.store_extension_id }),
  );
  return hash.digest("hex");
}
