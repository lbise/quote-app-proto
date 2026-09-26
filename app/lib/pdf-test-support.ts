import { crc32, deflateSync } from "node:zlib";

import { extractText, getDocumentProxy } from "unpdf";

/** The text of each PDF page, with whitespace collapsed. For tests only. */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: false });
  return text.map((page) => page.replace(/\s+/g, " "));
}

/** A plain grey PNG of the given size. For tests only. */
export function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; // 8-bit greyscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row += 1) rows[row * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
