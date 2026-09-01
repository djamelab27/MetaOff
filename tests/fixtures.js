function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

const text = (value) => new TextEncoder().encode(value);

function be16(value) { return new Uint8Array([(value >>> 8) & 255, value & 255]); }
function be32(value) { return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]); }
function le32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }

export function makeTiff() {
  const bytes = new Uint8Array(244);
  const view = new DataView(bytes.buffer);
  bytes.set(text("II"), 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 4, true);
  const entry = (index, tag, type, count, value, inlineText = "") => {
    const offset = 10 + index * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (inlineText) bytes.set(text(inlineText), offset + 8);
    else view.setUint32(offset + 8, value, true);
  };
  entry(0, 0x010f, 2, 11, 62);
  entry(1, 0x0110, 2, 10, 80);
  entry(2, 0x0132, 2, 20, 100);
  entry(3, 0x8825, 4, 1, 130);
  view.setUint32(58, 0, true);
  bytes.set(text("OpenAI Cam\0"), 62);
  bytes.set(text("Pocket X\0\0"), 80);
  bytes.set(text("2026:09:01 18:42:10\0"), 100);

  view.setUint16(130, 4, true);
  const gpsEntry = (index, tag, type, count, value, inlineText = "") => {
    const offset = 132 + index * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (inlineText) bytes.set(text(inlineText), offset + 8);
    else view.setUint32(offset + 8, value, true);
  };
  gpsEntry(0, 1, 2, 2, 0, "N\0");
  gpsEntry(1, 2, 5, 3, 184);
  gpsEntry(2, 3, 2, 2, 0, "E\0");
  gpsEntry(3, 4, 5, 3, 208);
  view.setUint32(180, 0, true);
  const rational = (offset, numerator, denominator = 1) => {
    view.setUint32(offset, numerator, true);
    view.setUint32(offset + 4, denominator, true);
  };
  rational(184, 48); rational(192, 51); rational(200, 2376, 100);
  rational(208, 2); rational(216, 21); rational(224, 792, 100);
  return bytes;
}

function jpegSegment(marker, payload) {
  return concat([new Uint8Array([0xff, marker]), be16(payload.length + 2), payload]);
}

export function makeJpeg() {
  const scan = new Uint8Array([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 17, 22, 33, 44, 0xff, 0xd9]);
  return concat([
    new Uint8Array([0xff, 0xd8]),
    jpegSegment(0xe1, concat([text("Exif\0\0"), makeTiff()])),
    jpegSegment(0xe1, concat([text("http://ns.adobe.com/xap/1.0/\0"), text("private xmp") ])),
    jpegSegment(0xe2, concat([text("ICC_PROFILE\0"), new Uint8Array([1, 1, 9, 8, 7])])),
    jpegSegment(0xed, concat([text("Photoshop 3.0\0"), new Uint8Array([7, 6, 5])])),
    jpegSegment(0xfe, text("Taken at home")),
    scan
  ]);
}

function pngChunk(type, data) {
  return concat([be32(data.length), text(type), data, new Uint8Array(4)]);
}

export function makePng() {
  const ihdr = concat([be32(640), be32(480), new Uint8Array([8, 6, 0, 0, 0])]);
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", text("Author\0Alice Example")),
    pngChunk("eXIf", makeTiff()),
    pngChunk("pHYs", new Uint8Array(9)),
    pngChunk("iCCP", text("display profile\0")),
    pngChunk("IDAT", new Uint8Array([1, 2, 3, 4, 5])),
    pngChunk("IEND", new Uint8Array())
  ]);
}

function webpChunk(type, data) {
  return concat([text(type), le32(data.length), data, data.length % 2 ? new Uint8Array(1) : new Uint8Array()]);
}

export function makeWebp() {
  const vp8x = new Uint8Array([0x2c, 0, 0, 0, 0x7f, 0x02, 0, 0xdf, 0x01, 0]);
  const chunks = concat([
    webpChunk("VP8X", vp8x),
    webpChunk("ICCP", new Uint8Array([9, 9, 9])),
    webpChunk("EXIF", concat([text("Exif\0\0"), makeTiff()])),
    webpChunk("XMP ", text("private xmp")),
    webpChunk("VP8 ", new Uint8Array([1, 2, 3, 4]))
  ]);
  return concat([text("RIFF"), le32(chunks.length + 4), text("WEBP"), chunks]);
}
