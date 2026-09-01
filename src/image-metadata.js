const JPEG_MARKERS = {
  0xe1: "APP1",
  0xe2: "APP2",
  0xed: "APP13",
  0xfe: "COM"
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("Expected an ArrayBuffer or Uint8Array");
}

function ascii(bytes, start, length) {
  let value = "";
  const end = Math.min(bytes.length, start + length);
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}

function cleanText(value) {
  return String(value || "").replace(/\0/g, "").replace(/\s+/g, " ").trim();
}

function finding(category, label, value, sensitivity = "low") {
  const cleaned = cleanText(Array.isArray(value) ? value.join(", ") : value);
  return cleaned ? { category, label, value: cleaned, sensitivity } : null;
}

function pushFinding(target, entry) {
  if (entry && !target.some((current) => current.label === entry.label && current.value === entry.value)) target.push(entry);
}

function readUInt32BE(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function writeUInt32BE(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function detectFormat(input) {
  const bytes = toBytes(input);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return "unknown";
}

function parseExif(bytes, start, length) {
  const findings = [];
  if (length < 8) return findings;
  const order = ascii(bytes, start, 2);
  const little = order === "II";
  if (!little && order !== "MM") return findings;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, length);
  const u16 = (offset) => offset >= 0 && offset + 2 <= length ? view.getUint16(offset, little) : 0;
  const u32 = (offset) => offset >= 0 && offset + 4 <= length ? view.getUint32(offset, little) : 0;
  const s32 = (offset) => offset >= 0 && offset + 4 <= length ? view.getInt32(offset, little) : 0;
  if (u16(2) !== 42) return findings;

  const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const readEntry = (entryOffset) => {
    const tag = u16(entryOffset);
    const type = u16(entryOffset + 2);
    const count = u32(entryOffset + 4);
    const size = (typeSizes[type] || 0) * count;
    const valueOffset = size <= 4 ? entryOffset + 8 : u32(entryOffset + 8);
    if (!size || count > 4096 || valueOffset < 0 || valueOffset + size > length) return { tag, value: null };
    const values = [];
    if (type === 2) {
      return { tag, value: cleanText(ascii(bytes, start + valueOffset, count)) };
    }
    for (let index = 0; index < count; index += 1) {
      const offset = valueOffset + index * typeSizes[type];
      if (type === 1 || type === 7) values.push(view.getUint8(offset));
      else if (type === 3) values.push(u16(offset));
      else if (type === 4) values.push(u32(offset));
      else if (type === 9) values.push(s32(offset));
      else if (type === 5) {
        const denominator = u32(offset + 4);
        values.push(denominator ? u32(offset) / denominator : 0);
      } else if (type === 10) {
        const denominator = s32(offset + 4);
        values.push(denominator ? s32(offset) / denominator : 0);
      }
    }
    return { tag, value: values.length === 1 ? values[0] : values };
  };

  const directories = new Map();
  const parseIfd = (offset, namespace = "main") => {
    if (!offset || offset + 2 > length || directories.has(`${namespace}:${offset}`)) return;
    directories.set(`${namespace}:${offset}`, true);
    const count = Math.min(u16(offset), 512);
    const entries = new Map();
    for (let index = 0; index < count; index += 1) {
      const entryOffset = offset + 2 + index * 12;
      if (entryOffset + 12 > length) break;
      const entry = readEntry(entryOffset);
      entries.set(entry.tag, entry.value);
    }
    if (namespace === "main") {
      pushFinding(findings, finding("device", "Camera maker", entries.get(0x010f), "medium"));
      pushFinding(findings, finding("device", "Camera model", entries.get(0x0110), "medium"));
      pushFinding(findings, finding("device", "Lens model", entries.get(0xa434), "low"));
      pushFinding(findings, finding("time", "Captured or edited", entries.get(0x0132), "high"));
      pushFinding(findings, finding("software", "Software", entries.get(0x0131), "medium"));
      pushFinding(findings, finding("identity", "Artist", entries.get(0x013b), "high"));
      pushFinding(findings, finding("identity", "Copyright", entries.get(0x8298), "medium"));
      pushFinding(findings, finding("description", "Image description", entries.get(0x010e), "medium"));
      if (entries.get(0x0112)) pushFinding(findings, finding("technical", "Orientation", entries.get(0x0112), "low"));
      if (entries.get(0x8769)) parseIfd(Number(entries.get(0x8769)), "exif");
      if (entries.get(0x8825)) parseIfd(Number(entries.get(0x8825)), "gps");
    } else if (namespace === "exif") {
      pushFinding(findings, finding("time", "Original capture time", entries.get(0x9003), "high"));
      pushFinding(findings, finding("time", "Digitized time", entries.get(0x9004), "high"));
      pushFinding(findings, finding("device", "Lens model", entries.get(0xa434), "low"));
      if (entries.get(0x8827)) pushFinding(findings, finding("technical", "ISO", entries.get(0x8827), "low"));
      if (entries.get(0xa002) && entries.get(0xa003)) {
        pushFinding(findings, finding("technical", "Recorded dimensions", `${entries.get(0xa002)} × ${entries.get(0xa003)}`, "low"));
      }
      const comment = entries.get(0x9286);
      if (Array.isArray(comment)) {
        const text = cleanText(String.fromCharCode(...comment.slice(8)));
        pushFinding(findings, finding("description", "User comment", text, "high"));
      }
    } else if (namespace === "gps") {
      const lat = gpsCoordinate(entries.get(2), entries.get(1));
      const lon = gpsCoordinate(entries.get(4), entries.get(3));
      if (lat !== null && lon !== null) {
        pushFinding(findings, finding("location", "GPS coordinates", `${lat.toFixed(6)}, ${lon.toFixed(6)}`, "critical"));
      }
      const altitude = Number(entries.get(6));
      if (Number.isFinite(altitude) && entries.has(6)) {
        const signed = Number(entries.get(5)) === 1 ? -altitude : altitude;
        pushFinding(findings, finding("location", "GPS altitude", `${signed.toFixed(1)} m`, "high"));
      }
      pushFinding(findings, finding("time", "GPS date", entries.get(29), "high"));
    }
  };

  parseIfd(u32(4));
  return findings;
}

function gpsCoordinate(value, reference) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const degrees = Number(value[0]) + Number(value[1]) / 60 + Number(value[2]) / 3600;
  if (!Number.isFinite(degrees)) return null;
  return /[SW]/i.test(String(reference || "")) ? -degrees : degrees;
}

function jpegSegments(bytes) {
  const segments = [];
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    let markerOffset = offset;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      segments.push({ marker, start: markerOffset, end: offset });
      break;
    }
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      segments.push({ marker, start: markerOffset, dataStart: offset + 2, end: bytes.length, scanStart: offset + length });
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, start: markerOffset, end: offset });
      continue;
    }
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) break;
    segments.push({ marker, start: markerOffset, dataStart: offset + 2, dataLength: length - 2, end });
    offset = end;
  }
  return segments;
}

function inspectJpeg(bytes) {
  const findings = [];
  const containers = [];
  let width = 0;
  let height = 0;
  for (const segment of jpegSegments(bytes)) {
    const { marker, dataStart = 0, dataLength = 0 } = segment;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && dataLength >= 5) {
      height = (bytes[dataStart + 1] << 8) | bytes[dataStart + 2];
      width = (bytes[dataStart + 3] << 8) | bytes[dataStart + 4];
    }
    const header = ascii(bytes, dataStart, Math.min(64, dataLength));
    if (marker === 0xe1 && header.startsWith("Exif\0\0")) {
      containers.push({ type: "EXIF", bytes: dataLength });
      for (const entry of parseExif(bytes, dataStart + 6, dataLength - 6)) pushFinding(findings, entry);
    } else if (marker === 0xe1 && /xap|xmp/i.test(header)) {
      containers.push({ type: "XMP", bytes: dataLength });
      pushFinding(findings, finding("description", "XMP metadata", "Embedded editing and descriptive metadata", "medium"));
    } else if (marker === 0xed) {
      containers.push({ type: "IPTC", bytes: dataLength });
      pushFinding(findings, finding("identity", "IPTC metadata", "May contain author, caption, location, or rights fields", "high"));
    } else if (marker === 0xe2 && header.startsWith("ICC_PROFILE")) {
      containers.push({ type: "ICC profile", bytes: dataLength });
      pushFinding(findings, finding("technical", "Color profile", "Embedded ICC profile", "low"));
    } else if (marker === 0xfe) {
      const comment = cleanText(ascii(bytes, dataStart, dataLength));
      containers.push({ type: "Comment", bytes: dataLength });
      pushFinding(findings, finding("description", "JPEG comment", comment || "Embedded comment", "high"));
    }
  }
  return { findings, containers, width, height };
}

function sanitizeJpeg(bytes, options) {
  const parts = [bytes.slice(0, 2)];
  const removed = [];
  let cursor = 2;
  for (const segment of jpegSegments(bytes)) {
    if (segment.start > cursor) parts.push(bytes.slice(cursor, segment.start));
    const header = ascii(bytes, segment.dataStart || 0, Math.min(64, segment.dataLength || 0));
    let type = "";
    if (segment.marker === 0xe1 && header.startsWith("Exif\0\0")) type = "EXIF";
    else if (segment.marker === 0xe1 && /xap|xmp/i.test(header)) type = "XMP";
    else if (segment.marker === 0xed) type = "IPTC";
    else if (segment.marker === 0xfe) type = "Comment";
    else if (segment.marker === 0xe2 && header.startsWith("ICC_PROFILE") && options.removeColorProfile) type = "ICC profile";
    if (type) removed.push({ type, bytes: segment.end - segment.start });
    else parts.push(bytes.slice(segment.start, segment.end));
    cursor = segment.end;
    if (segment.marker === 0xda) break;
  }
  if (cursor < bytes.length) parts.push(bytes.slice(cursor));
  return { bytes: concat(parts), removed };
}

function pngChunks(bytes) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUInt32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    chunks.push({ type, start: offset, dataStart: offset + 8, length, end });
    offset = end;
    if (type === "IEND") break;
  }
  return chunks;
}

function inspectPng(bytes) {
  const findings = [];
  const containers = [];
  let width = 0;
  let height = 0;
  for (const chunk of pngChunks(bytes)) {
    if (chunk.type === "IHDR" && chunk.length >= 8) {
      width = readUInt32BE(bytes, chunk.dataStart);
      height = readUInt32BE(bytes, chunk.dataStart + 4);
    }
    if (chunk.type === "eXIf") {
      containers.push({ type: "EXIF", bytes: chunk.length });
      for (const entry of parseExif(bytes, chunk.dataStart, chunk.length)) pushFinding(findings, entry);
    } else if (["tEXt", "zTXt", "iTXt"].includes(chunk.type)) {
      containers.push({ type: `PNG ${chunk.type}`, bytes: chunk.length });
      const keyword = cleanText(ascii(bytes, chunk.dataStart, Math.min(chunk.length, 80)).split("\0")[0]);
      pushFinding(findings, finding("description", "PNG text field", keyword || "Embedded text metadata", "high"));
    } else if (chunk.type === "tIME") {
      containers.push({ type: "PNG timestamp", bytes: chunk.length });
      pushFinding(findings, finding("time", "PNG modification time", "Embedded timestamp", "high"));
    } else if (chunk.type === "iCCP") {
      containers.push({ type: "ICC profile", bytes: chunk.length });
      pushFinding(findings, finding("technical", "Color profile", "Embedded ICC profile", "low"));
    } else if (chunk.type === "pHYs") {
      containers.push({ type: "Pixel density", bytes: chunk.length });
      pushFinding(findings, finding("technical", "Pixel density", "Embedded physical-resolution data", "low"));
    }
  }
  return { findings, containers, width, height };
}

function sanitizePng(bytes, options) {
  const removed = [];
  const parts = [bytes.slice(0, 8)];
  const removeTypes = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME", "pHYs"]);
  if (options.removeColorProfile) removeTypes.add("iCCP");
  for (const chunk of pngChunks(bytes)) {
    if (removeTypes.has(chunk.type)) removed.push({ type: chunk.type === "eXIf" ? "EXIF" : `PNG ${chunk.type}`, bytes: chunk.end - chunk.start });
    else parts.push(bytes.slice(chunk.start, chunk.end));
  }
  return { bytes: concat(parts), removed };
}

function webpChunks(bytes) {
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const end = offset + 8 + size + (size % 2);
    if (size < 0 || end > bytes.length) break;
    chunks.push({ type, start: offset, dataStart: offset + 8, length: size, end });
    offset = end;
  }
  return chunks;
}

function inspectWebp(bytes) {
  const findings = [];
  const containers = [];
  let width = 0;
  let height = 0;
  for (const chunk of webpChunks(bytes)) {
    if (chunk.type === "VP8X" && chunk.length >= 10) {
      width = 1 + bytes[chunk.dataStart + 4] + (bytes[chunk.dataStart + 5] << 8) + (bytes[chunk.dataStart + 6] << 16);
      height = 1 + bytes[chunk.dataStart + 7] + (bytes[chunk.dataStart + 8] << 8) + (bytes[chunk.dataStart + 9] << 16);
    }
    if (chunk.type === "EXIF") {
      containers.push({ type: "EXIF", bytes: chunk.length });
      let start = chunk.dataStart;
      let length = chunk.length;
      if (ascii(bytes, start, 6) === "Exif\0\0") { start += 6; length -= 6; }
      for (const entry of parseExif(bytes, start, length)) pushFinding(findings, entry);
    } else if (chunk.type === "XMP ") {
      containers.push({ type: "XMP", bytes: chunk.length });
      pushFinding(findings, finding("description", "XMP metadata", "Embedded editing and descriptive metadata", "medium"));
    } else if (chunk.type === "ICCP") {
      containers.push({ type: "ICC profile", bytes: chunk.length });
      pushFinding(findings, finding("technical", "Color profile", "Embedded ICC profile", "low"));
    }
  }
  return { findings, containers, width, height };
}

function sanitizeWebp(bytes, options) {
  const removed = [];
  const chunks = webpChunks(bytes);
  const removeTypes = new Set(["EXIF", "XMP "]);
  if (options.removeColorProfile) removeTypes.add("ICCP");
  const kept = [];
  for (const chunk of chunks) {
    if (removeTypes.has(chunk.type)) {
      removed.push({ type: chunk.type.trim() === "XMP" ? "XMP" : chunk.type, bytes: chunk.end - chunk.start });
      continue;
    }
    const copy = bytes.slice(chunk.start, chunk.end);
    if (chunk.type === "VP8X" && copy.length >= 18) {
      copy[8] &= ~(0x08 | 0x04 | (options.removeColorProfile ? 0x20 : 0));
    }
    kept.push(copy);
  }
  const payloadLength = 4 + kept.reduce((sum, chunk) => sum + chunk.length, 0);
  return {
    bytes: concat([
      new TextEncoder().encode("RIFF"),
      new Uint8Array([payloadLength & 255, (payloadLength >>> 8) & 255, (payloadLength >>> 16) & 255, (payloadLength >>> 24) & 255]),
      new TextEncoder().encode("WEBP"),
      ...kept
    ]),
    removed
  };
}

export function inspectImage(input) {
  const bytes = toBytes(input);
  const format = detectFormat(bytes);
  let details;
  if (format === "jpeg") details = inspectJpeg(bytes);
  else if (format === "png") details = inspectPng(bytes);
  else if (format === "webp") details = inspectWebp(bytes);
  else throw new Error("MetaOff supports JPEG, PNG, and WebP images.");
  const sensitiveCount = details.findings.filter((entry) => ["critical", "high", "medium"].includes(entry.sensitivity)).length;
  return {
    format,
    mime: format === "jpeg" ? "image/jpeg" : `image/${format}`,
    size: bytes.length,
    width: details.width,
    height: details.height,
    findings: details.findings,
    containers: details.containers,
    sensitiveCount,
    risk: details.findings.some((entry) => entry.sensitivity === "critical") ? "critical"
      : details.findings.some((entry) => entry.sensitivity === "high") ? "high"
        : details.findings.some((entry) => entry.sensitivity === "medium") ? "medium" : "low"
  };
}

export function sanitizeImage(input, options = {}) {
  const bytes = toBytes(input);
  const format = detectFormat(bytes);
  const normalized = { removeColorProfile: Boolean(options.removeColorProfile) };
  let result;
  if (format === "jpeg") result = sanitizeJpeg(bytes, normalized);
  else if (format === "png") result = sanitizePng(bytes, normalized);
  else if (format === "webp") result = sanitizeWebp(bytes, normalized);
  else throw new Error("MetaOff supports JPEG, PNG, and WebP images.");
  return {
    ...result,
    format,
    originalSize: bytes.length,
    cleanedSize: result.bytes.length,
    savedBytes: bytes.length - result.bytes.length
  };
}

export function mimeForFormat(format) {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

export function extensionForFormat(format) {
  return format === "jpeg" ? "jpg" : format;
}

export function utf8(value) {
  return new TextEncoder().encode(value);
}

export { concat, writeUInt32BE };
