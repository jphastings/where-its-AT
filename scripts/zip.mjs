// Bundles dist/{chrome,firefox} into dist/{chrome,firefox}.zip for store/listing uploads.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const targets = ["chrome", "firefox"];
for (const target of targets) {
  const dir = resolve("dist", target);
  if (!existsSync(dir)) {
    console.warn(`skip ${target}: ${dir} not built`);
    continue;
  }
  const zipPath = resolve("dist", `${target}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync("zip", ["-r", "-X", zipPath, "."], { cwd: dir, stdio: "inherit" });
  console.log(`wrote ${zipPath}`);
}
