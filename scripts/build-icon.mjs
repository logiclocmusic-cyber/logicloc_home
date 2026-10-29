#!/usr/bin/env node
/** 根据 build/app-icon.png 生成 macOS .icns */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const sourcePath = join(buildDir, 'app-icon.png');
const iconsetDir = join(buildDir, 'icon.iconset');
const icnsPath = join(buildDir, 'icon.icns');

const SIZES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
];

if (!existsSync(sourcePath)) {
  console.error('缺少图标源文件:', sourcePath);
  process.exit(1);
}

if (existsSync(iconsetDir)) rmSync(iconsetDir, { recursive: true });
mkdirSync(iconsetDir, { recursive: true });

for (const [size, name] of SIZES) {
  const png = await sharp(sourcePath)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toBuffer();
  writeFileSync(join(iconsetDir, name), png);
}

execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
console.log('已生成', icnsPath);
