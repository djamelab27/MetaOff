import assert from "node:assert/strict";
import test from "node:test";
import { detectFormat, inspectImage, sanitizeImage } from "../src/image-metadata.js";
import { makeJpeg, makePng, makeWebp } from "./fixtures.js";

test("detects all supported image containers", () => {
  assert.equal(detectFormat(makeJpeg()), "jpeg");
  assert.equal(detectFormat(makePng()), "png");
  assert.equal(detectFormat(makeWebp()), "webp");
  assert.equal(detectFormat(new Uint8Array([1, 2, 3])), "unknown");
});

test("reads sensitive EXIF fields including GPS coordinates", () => {
  const report = inspectImage(makeJpeg());
  assert.equal(report.format, "jpeg");
  assert.equal(report.risk, "critical");
  assert.ok(report.findings.some((entry) => entry.label === "Camera maker" && entry.value === "OpenAI Cam"));
  assert.ok(report.findings.some((entry) => entry.label === "Captured or edited" && entry.value.includes("2026:09:01")));
  assert.ok(report.findings.some((entry) => entry.label === "GPS coordinates" && entry.value.startsWith("48.856600, 2.352200")));
  assert.ok(report.containers.some((entry) => entry.type === "IPTC"));
});

test("cleans JPEG metadata without touching compressed scan bytes", () => {
  const original = makeJpeg();
  const scan = original.slice(original.indexOf(17));
  const result = sanitizeImage(original);
  const report = inspectImage(result.bytes);
  assert.equal(report.sensitiveCount, 0);
  assert.ok(report.findings.some((entry) => entry.label === "Color profile"));
  assert.ok(result.removed.some((entry) => entry.type === "EXIF"));
  assert.ok(result.removed.some((entry) => entry.type === "XMP"));
  assert.ok(result.removed.some((entry) => entry.type === "IPTC"));
  assert.deepEqual(result.bytes.slice(result.bytes.indexOf(17)), scan);
});

test("optionally removes the JPEG color profile", () => {
  const result = sanitizeImage(makeJpeg(), { removeColorProfile: true });
  assert.equal(inspectImage(result.bytes).findings.length, 0);
  assert.ok(result.removed.some((entry) => entry.type === "ICC profile"));
});

test("cleans PNG metadata while preserving dimensions and image data", () => {
  const original = makePng();
  const before = inspectImage(original);
  assert.equal(before.width, 640);
  assert.equal(before.height, 480);
  assert.ok(before.findings.some((entry) => entry.label === "PNG text field"));
  const result = sanitizeImage(original);
  const after = inspectImage(result.bytes);
  assert.equal(after.width, 640);
  assert.equal(after.height, 480);
  assert.equal(after.sensitiveCount, 0);
  assert.ok(after.findings.some((entry) => entry.label === "Color profile"));
  assert.ok(Buffer.from(result.bytes).includes(Buffer.from([1, 2, 3, 4, 5])));
});

test("cleans WebP EXIF and XMP and updates container flags and size", () => {
  const original = makeWebp();
  assert.equal(inspectImage(original).risk, "critical");
  const result = sanitizeImage(original, { removeColorProfile: true });
  const report = inspectImage(result.bytes);
  assert.equal(report.findings.length, 0);
  const declaredSize = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength).getUint32(4, true);
  assert.equal(declaredSize, result.bytes.length - 8);
  assert.equal(result.bytes[20] & (0x20 | 0x08 | 0x04), 0);
  assert.ok(Buffer.from(result.bytes).includes(Buffer.from([1, 2, 3, 4])));
});

test("rejects unsupported files clearly", () => {
  assert.throws(() => inspectImage(new Uint8Array([1, 2, 3])), /supports JPEG, PNG, and WebP/);
  assert.throws(() => sanitizeImage(new Uint8Array([1, 2, 3])), /supports JPEG, PNG, and WebP/);
});
