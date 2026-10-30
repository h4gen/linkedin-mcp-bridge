import { readFile, readdir, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
const files = {};
for (const name of await readdir("dist/extension"))
  files[name] = new Uint8Array(await readFile("dist/extension/" + name));
await writeFile("dist/linkedin-extension.zip", zipSync(files));
console.log("dist/linkedin-extension.zip");
