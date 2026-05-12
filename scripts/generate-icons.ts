import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(PROJECT_ROOT, "src/icons");
const OUT_DIR = resolve(PROJECT_ROOT, "public/icons");
const SIZES = [16, 32, 48, 128];
const VARIANTS = ["detected", "inactive", "engaged"] as const;

// Fraction of the centred-glyph canvas to leave as transparent margin on all
// sides. Smaller numbers push the glyph closer to the icon edge.
const MARGIN_RATIO = 0.06;

// Resolution we trim/center at before resizing — high enough that downscaling
// produces crisp glyphs at every requested size.
const WORK_SIZE = 1024;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

// Bluesky-ish blue used for the active glyph + engaged background.
const BLUE = "#0085FF";

interface Centroid {
  x: number;
  y: number;
}

function findCentroid(pixels: Buffer, width: number, height: number, channels: number): Centroid {
  // Alpha-weighted centroid: the optical "center of mass" of the painted pixels.
  // Bounding-box centering misplaces glyphs like "@" whose tail pulls the
  // bounding box away from where the eye expects the visual center.
  let sumX = 0;
  let sumY = 0;
  let weight = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      const alpha = pixels[row + x * channels + (channels - 1)];
      if (!alpha) continue;
      sumX += x * alpha;
      sumY += y * alpha;
      weight += alpha;
    }
  }
  if (weight === 0) return { x: width / 2, y: height / 2 };
  return { x: sumX / weight, y: sumY / weight };
}

async function renderCentered(svg: Buffer): Promise<Buffer> {
  // 1) Rasterize SVG into a large transparent square.
  const raster = await sharp(svg, { density: 1024 })
    .resize(WORK_SIZE, WORK_SIZE, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  // 2) Trim transparent edges so centroid is computed only over painted pixels.
  const trimmed = await sharp(raster)
    .trim({ background: TRANSPARENT, threshold: 5 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;

  // 3) Compute alpha-weighted centroid of the trimmed glyph.
  const rawPixels = await sharp(trimmed.data)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const centroid = findCentroid(
    rawPixels.data,
    rawPixels.info.width,
    rawPixels.info.height,
    rawPixels.info.channels,
  );

  // 4) Pad asymmetrically so the centroid lands at the geometric center of the
  //    resulting square canvas.
  const halfX = Math.max(centroid.x, width - centroid.x);
  const halfY = Math.max(centroid.y, height - centroid.y);
  const half = Math.max(halfX, halfY);

  const padLeft = Math.round(half - centroid.x);
  const padTop = Math.round(half - centroid.y);
  const square = Math.round(half * 2);
  const padRight = square - width - padLeft;
  const padBottom = square - height - padTop;

  const centered = await sharp(trimmed.data)
    .extend({
      top: padTop,
      bottom: padBottom,
      left: padLeft,
      right: padRight,
      background: TRANSPARENT,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  // 5) Add uniform margin around the centered glyph.
  const margin = Math.round(centered.info.width * MARGIN_RATIO);
  return sharp(centered.data)
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();
}

async function renderEngaged(): Promise<Buffer> {
  // Re-use the detected @ but recoloured white, composited onto a blue rounded
  // square so the visually-engaged state reads as inverted.
  const detectedSvgPath = resolve(SRC_DIR, "detected.svg");
  const detectedSvg = await readFile(detectedSvgPath, "utf8");
  const whiteSvg = Buffer.from(detectedSvg.replace(/#0085FF/gi, "#FFFFFF"));

  const whiteAt = await renderCentered(whiteSvg);
  const meta = await sharp(whiteAt).metadata();
  const canvasSize = meta.width ?? WORK_SIZE;

  const radius = Math.round(canvasSize * 0.18);
  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}">` +
      `<rect width="${canvasSize}" height="${canvasSize}" rx="${radius}" ry="${radius}" fill="${BLUE}"/>` +
      `</svg>`,
  );
  const blueBg = await sharp(bgSvg)
    .resize(canvasSize, canvasSize, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  return sharp(blueBg)
    .composite([{ input: whiteAt, blend: "over" }])
    .png()
    .toBuffer();
}

async function rasterize(name: (typeof VARIANTS)[number]): Promise<void> {
  let centered: Buffer;
  if (name === "engaged") {
    centered = await renderEngaged();
  } else {
    const svgPath = resolve(SRC_DIR, `${name}.svg`);
    const svg = await readFile(svgPath);
    centered = await renderCentered(svg);
  }

  for (const size of SIZES) {
    const png = await sharp(centered)
      .resize(size, size, { fit: "contain", background: TRANSPARENT })
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
