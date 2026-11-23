// 同梱するKlee Oneのcmapから、字形を持つ文字の範囲を生成する。
// フォントを差し替えた場合は node scripts/generate-font-coverage.cjs を実行する。
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const font = fs.readFileSync(path.join(root, "fonts/klee-one/KleeOne-Regular.ttf"));
let cmap;
for (let i = 0; i < font.readUInt16BE(4); i++) {
  const table = 12 + i * 16;
  if (font.toString("ascii", table, table + 4) === "cmap") cmap = font.readUInt32BE(table + 8);
}
if (!cmap) throw new Error("cmapがありません。");
const supported = new Set();
for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
  const entry = cmap + 4 + i * 8;
  if (![0, 3].includes(font.readUInt16BE(entry))) continue;
  const base = cmap + font.readUInt32BE(entry + 4);
  const format = font.readUInt16BE(base);
  if (format === 12) {
    for (let j = 0; j < font.readUInt32BE(base + 12); j++) {
      const group = base + 16 + j * 12;
      const start = font.readUInt32BE(group), end = font.readUInt32BE(group + 4);
      for (let code = start; code <= end; code++) {
        if (font.readUInt32BE(group + 8) + code - start !== 0) supported.add(code);
      }
    }
  } else if (format === 4) {
    const count = font.readUInt16BE(base + 6) / 2;
    const ends = base + 14, starts = ends + count * 2 + 2;
    const deltas = starts + count * 2, offsets = deltas + count * 2;
    for (let j = 0; j < count; j++) {
      const start = font.readUInt16BE(starts + j * 2), end = font.readUInt16BE(ends + j * 2);
      const delta = font.readInt16BE(deltas + j * 2), offset = font.readUInt16BE(offsets + j * 2);
      for (let code = start; code <= end; code++) {
        const glyph = offset ? font.readUInt16BE(offsets + j * 2 + offset + (code - start) * 2) : code;
        if ((!offset || glyph) && ((glyph + delta) & 0xffff)) supported.add(code);
      }
    }
  }
}
const ranges = [];
for (const code of [...supported].sort((a, b) => a - b)) {
  if (ranges.length && ranges.at(-1)[1] + 1 === code) ranges.at(-1)[1] = code;
  else ranges.push([code, code]);
}
const output = `"use strict";\n\n// 同梱フォントから自動生成。更新方法: node scripts/generate-font-coverage.cjs\nconst FontCharacters = (() => {\n  const ranges = ${JSON.stringify(ranges)};\n  function supports(character) {\n    if (typeof character !== "string" || Array.from(character).length !== 1 || /[\\p{C}\\p{M}\\p{Z}]/u.test(character)) return false;\n    const code = character.codePointAt(0);\n    return ranges.some(([start, end]) => start <= code && code <= end);\n  }\n  return { supports };\n})();\n`;
fs.writeFileSync(path.join(root, "js/font-characters.js"), output);
