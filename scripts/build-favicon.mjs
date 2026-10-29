#!/usr/bin/env node
/** 从 logo 生成带圆角透明边的 favicon / apple-touch-icon */
import { writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const sourcePath = join(publicDir, 'logo-dark.png');

/** iOS 风格约 22% 圆角 */
const CORNER_RATIO = 0.22;

const OUTPUTS = [
  { file: 'favicon.png', size: 64 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'apple-touch-icon.png', size: 180 },
];

if (!existsSync(sourcePath)) {
  console.error('缺少源文件:', sourcePath);
  process.exit(1);
}

async function roundedPng(source, size) {
  const r = Math.max(2, Math.round(size * CORNER_RATIO));
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/>
    </svg>`
  );
  return sharp(source)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

for (const { file, size } of OUTPUTS) {
  const buf = await roundedPng(sourcePath, size);
  const out = join(publicDir, file);
  writeFileSync(out, buf);
  console.log('已生成', out, `${size}x${size}`);
}
