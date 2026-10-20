// Generates every icon from public/icon.svg (the single source; DESIGN.md
// › Icon):
//   public/favicon.ico            16, 32 and 48 px (PNG entries)
//   public/apple-touch-icon.png   180 px
//   public/icon-192.png, public/icon-512.png
//
//   npm run icons
//
// The 16 px render uses a thicker signature stroke (see SIXTEEN_PX), or the
// stroke breaks up at that size.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const source = readFileSync(pub('icon.svg'), 'utf8');

/** The 16 px variant: only the signature stroke changes. */
const SIXTEEN_PX = source.replace('stroke-width="1.7"', 'stroke-width="2.4"');

async function png(svg, size) {
  // Rasterise well above the target size, then downsample, for clean edges.
  return sharp(Buffer.from(svg), { density: Math.max(72, (size / 32) * 72 * 4) })
    .resize(size, size)
    .png()
    .toBuffer();
}

/** An .ico holding PNG images (supported by every current browser and OS). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colours
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const icoImages = [];
for (const size of [16, 32, 48]) {
  icoImages.push({ size, data: await png(size === 16 ? SIXTEEN_PX : source, size) });
}
writeFileSync(pub('favicon.ico'), ico(icoImages));
writeFileSync(pub('apple-touch-icon.png'), await png(source, 180));
writeFileSync(pub('icon-192.png'), await png(source, 192));
writeFileSync(pub('icon-512.png'), await png(source, 512));

console.log('✓ favicon.ico (16, 32, 48), apple-touch-icon.png (180), icon-192.png, icon-512.png');
