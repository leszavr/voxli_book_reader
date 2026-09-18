import { parseFb2 } from "./fb2.js";
import { parseEpub } from "./epub.js";

async function detectFormat(file) {
  const buf = await file.slice(0, 4).arrayBuffer();
  const b = new Uint8Array(buf);
  // ZIP signature → EPUB
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return "epub";
  // UTF-8 BOM + '<' → FB2
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF && b[3] === 0x3C) return "fb2";
  // '<' → XML/FB2
  if (b[0] === 0x3C) return "fb2";
  return null;
}

export async function parseBookFile(file) {
  const format = await detectFormat(file);
  if (format === "fb2") return parseFb2(file);
  if (format === "epub") return parseEpub(file);
  throw new Error("unsupportedFormat");
}
