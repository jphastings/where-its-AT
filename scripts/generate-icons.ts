import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(PROJECT_ROOT, "src/icons");
const OUT_DIR = resolve(PROJECT_ROOT, "public/icons");
const SIZES = [16, 32, 48, 128];
const VARIANTS = ["active", "inactive"] as const;

async function rasterize(name: (typeof VARIANTS)[number]): Promise<void> {
  const svgPath = resolve(SRC_DIR, `${name}.svg`);
  const svg = await readFile(svgPath);
  for (const size of SIZES) {
    const png = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const outPath = resolve(OUT_DIR, `${name}-${size}.png`);
    await writeFile(outPath, png);
    console.log(`wrote ${outPath} (${png.byteLength} bytes)`);
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const variant of VARIANTS) {
    await rasterize(variant);
  }
}

await main();
