import type { Template } from "./templates.js";

export async function renderTemplate(template: Template, _data: Record<string, string>): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  // Create base image
  let image = sharp({
    create: {
      width: template.width,
      height: template.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  });

  const composites: Array<{ input: Buffer; top: number; left: number }> = [];

  for (const layer of template.layers) {
    if (layer.type === "shape" && layer.width && layer.height) {
      const fill = layer.fill ?? "#000000";
      const r = parseInt(fill.slice(1, 3), 16);
      const g = parseInt(fill.slice(3, 5), 16);
      const b = parseInt(fill.slice(5, 7), 16);
      const rect = await sharp({
        create: { width: layer.width, height: layer.height, channels: 4, background: { r, g, b, alpha: 255 } },
      })
        .png()
        .toBuffer();
      composites.push({ input: rect, top: layer.y, left: layer.x });
    } else if (layer.type === "text" && layer.content) {
      const fontSize = layer.fontSize ?? 24;
      const color = layer.color ?? "#ffffff";
      const text = layer.content;
      const svg = `<svg width="${template.width - layer.x}" height="${fontSize * 2}">
        <text x="0" y="${fontSize}" font-size="${fontSize}" fill="${color}" font-family="sans-serif">${escapeXml(text)}</text>
      </svg>`;
      const textBuf = await sharp(Buffer.from(svg)).png().toBuffer();
      composites.push({ input: textBuf, top: layer.y, left: layer.x });
    }
  }

  if (composites.length > 0) {
    image = image.composite(composites);
  }

  return image.png().toBuffer();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
