// PWA用アイコン (192x192, 512x512) を生成して public/icons/ に保存。
// 依存追加なしで純粋な Node.js + zlib で PNG を出力する。
//
// 実行: node scripts/generate-pwa-icons.mjs
//
// デザイン: テーマ色 #0b1020 背景 + 中央に白い角丸スクエア(プレースホルダ)。
// 本格的なロゴに差し替えたければ、本ファイルを編集するか
// public/icons/icon-{192,512}.png を直接置き換える。

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// ───────── PNG エンコーダ ─────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 指定サイズの RGBA ピクセル配列から PNG (color type 6 = RGBA) を作る。
 */
function encodePng(width, height, rgba) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type 6 = RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // IDAT: scanline = [filterByte=0] + RGBA*width
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * stride + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ───────── アイコンの中身 ─────────
/**
 * アイコンのRGBA画素配列を作る。
 * 背景: BG (テーマ色)、前景: 中央の白い角丸スクエア。
 */
function makeIcon(size) {
  const BG = [0x0b, 0x10, 0x20]; // theme #0b1020
  const FG = [255, 255, 255];
  // 角丸スクエア: 中央 60% × 60%, 角丸 R=10%
  const inner = size * 0.6;
  const margin = (size - inner) / 2;
  const x0 = margin;
  const y0 = margin;
  const x1 = size - margin;
  const y1 = size - margin;
  const radius = size * 0.1;

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let isFg = false;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        // 角丸判定: 角の領域に居れば中心からの距離で円内チェック
        const cx = x < x0 + radius ? x0 + radius : x >= x1 - radius ? x1 - radius : x;
        const cy = y < y0 + radius ? y0 + radius : y >= y1 - radius ? y1 - radius : y;
        const dx = x - cx;
        const dy = y - cy;
        if (dx === 0 && dy === 0) {
          isFg = true;
        } else {
          const dist2 = dx * dx + dy * dy;
          isFg = dist2 <= radius * radius;
        }
      }
      const c = isFg ? FG : BG;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = 255;
    }
  }
  return buf;
}

// ───────── 実行 ─────────
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const outDir = resolve(projectRoot, "public/icons");
mkdirSync(outDir, { recursive: true });

const sizes = [192, 512];
for (const size of sizes) {
  const rgba = makeIcon(size);
  const png = encodePng(size, size, rgba);
  const outPath = resolve(outDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}
