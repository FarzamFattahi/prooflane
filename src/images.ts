import type { Comparison, LoadedImage } from "./types";

export const MAX_PIXELS = 12_000_000;
export async function loadImage(file: File): Promise<LoadedImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > 25 * 1024 * 1024)
    throw new Error(
      "This file exceeds 25 MB. Export a smaller screenshot and try again.",
    );
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This image could not be decoded. Try exporting it again as PNG.",
    );
  }
  try {
    if (
      bitmap.width * bitmap.height > MAX_PIXELS ||
      bitmap.width > 8192 ||
      bitmap.height > 8192
    )
      throw new Error(
        "Images may contain up to 12 megapixels, with no side above 8,192 pixels.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error(
        "Your browser does not support image processing. Try a current desktop browser.",
      );
    context.drawImage(bitmap, 0, 0);
    return {
      name: file.name,
      width: canvas.width,
      height: canvas.height,
      data: context.getImageData(0, 0, canvas.width, canvas.height).data,
      url: canvas.toDataURL("image/png"),
    };
  } finally {
    bitmap.close();
  }
}

export function diffImage(
  baseline: LoadedImage,
  candidate: LoadedImage,
  comparison: Comparison,
): string {
  const { width, height, mask } = comparison;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x,
        out = index * 4;
      if (mask[index]) {
        pixels.data.set([204, 73, 25, 255], out);
        continue;
      }
      const image =
        x < candidate.width && y < candidate.height ? candidate : baseline;
      if (x < image.width && y < image.height) {
        const source = (y * image.width + x) * 4,
          a = image.data[source + 3] / 255;
        const gray =
          (image.data[source] * 0.2126 +
            image.data[source + 1] * 0.7152 +
            image.data[source + 2] * 0.0722) *
            a +
          255 * (1 - a);
        const shade = Math.round(gray * 0.42 + 255 * 0.58);
        pixels.data.set([shade, shade, shade, 255], out);
      } else pixels.data.set([243, 244, 246, 255], out);
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

// Original deterministic fixtures: these are example inputs, processed by the real engine.
export function exampleImages(): [LoadedImage, LoadedImage] {
  function draw(candidate: boolean): LoadedImage {
    const c = document.createElement("canvas");
    c.width = 1120;
    c.height = 730;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const box = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
      r = 0,
    ) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    };
    const text = (
      value: string,
      x: number,
      y: number,
      size = 16,
      color = "#27362e",
      weight = 400,
    ) => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px Arial`;
      ctx.fillText(value, x, y);
    };
    box(0, 0, 1120, 730, "#f7f8f4");
    box(0, 0, 1120, 70, "#fff");
    text("FORM / FIELD", 36, 42, 21, "#27362e", 700);
    text("Collection", 445, 41, 15);
    text("Our materials", 553, 41, 15);
    text("Journal", 700, 41, 15);
    text("Bag (2)", 1008, 41, 15);
    text("YOUR BAG", 54, 119, 12, "#647066", 600);
    text("Good things, made to last.", 54, 168, 31, "#27362e", 600);
    box(54, 208, 640, 184, "#fff", 12);
    box(78, 232, 144, 136, "#eaeee6", 8);
    // Product fixture geometry is intentionally reproducible, with no external image assets.
    box(119, 252, 62, 96, "#718071", 8);
    box(113, 252, 74, 12, "#526553", 4);
    text("Everyday carafe", 248, 262, 21, "#27362e", 600);
    text("Sage / 750 ml", 248, 290, 15, "#647066");
    text("01", 248, 344, 16);
    text("$48.00", 585, 267, 18, "#27362e", 600);
    box(54, 410, 640, 184, "#fff", 12);
    box(78, 434, 144, 136, "#eee9df", 8);
    box(104, 463, 94, 43, "#bca17d", 20);
    box(112, 498, 78, 18, "#bca17d", 5);
    text("Gather bowl", 248, 464, 21, "#27362e", 600);
    text("Sand / Set of two", 248, 492, 15, "#647066");
    text("01", 248, 547, 16);
    text("$36.00", 585, 469, 18, "#27362e", 600);
    box(730, 208, 336, 416, "#e9eee4", 12);
    text("Order summary", 758, 252, 23, "#27362e", 600);
    text("Subtotal", 758, 304);
    text("$84.00", 977, 304, 16);
    text("Shipping", 758, 347);
    text(candidate ? "$12.00" : "Free", 977, 347, 16);
    box(758, 377, 280, 1, "#c7cec2");
    text("Total", 758, 420, 18, "#27362e", 600);
    text(candidate ? "$96.00" : "$84.00", 961, 420, 21, "#27362e", 600);
    box(758, 450, 280, 58, candidate ? "#b25a35" : "#334d3b", 8);
    text("Continue to checkout", 794, 486, 18, "#fff", 600);
    text("Secure checkout", 807, 548, 14, "#526553");
    text("Free returns within 30 days", 778, 575, 14, "#526553");
    box(54, 636, 640, 48, "#eef0e9", 8);
    text(
      candidate
        ? "Dispatching within 3–5 business days"
        : "Dispatching within 1–2 business days",
      76,
      666,
      15,
      "#526553",
    );
    return {
      name: candidate ? "checkout-after.png" : "checkout-before.png",
      width: c.width,
      height: c.height,
      data: ctx.getImageData(0, 0, c.width, c.height).data,
      url: c.toDataURL("image/png"),
    };
  }
  return [draw(false), draw(true)];
}
