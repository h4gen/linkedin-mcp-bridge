import fs from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { root } from "./paths.js";
export const tokenPath = join(root, "transport-token");
export async function prepareAccess() {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    const identity = execFileSync(
      "whoami.exe",
      ["/user", "/fo", "csv", "/nh"],
      { encoding: "utf8", windowsHide: true },
    );
    const sid = identity.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw Error("Cannot determine Windows user SID");
    execFileSync(
      "icacls.exe",
      [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`],
      { stdio: "pipe", windowsHide: true },
    );
    try {
      await fs.writeFile(tokenPath, randomBytes(32).toString("hex"), {
        flag: "wx",
      });
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
    }
    await transportToken();
  } else await fs.chmod(root, 0o700);
}
export async function transportToken() {
  if (process.platform !== "win32") return undefined;
  const token = await fs.readFile(tokenPath, "utf8");
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Invalid transport credential; reinstall the native host.");
  return token;
}
