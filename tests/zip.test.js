import assert from "node:assert/strict";
import test from "node:test";
import { crc32, createZip } from "../src/zip.js";

test("calculates the standard CRC-32 check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("creates a UTF-8 store-only ZIP containing every clean file", () => {
  const zip = createZip([
    { name: "photo-clean.jpg", bytes: new Uint8Array([1, 2, 3]) },
    { name: "rapport-privé.json", bytes: new TextEncoder().encode("{}") }
  ]);
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual([...zip.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
  const decoded = new TextDecoder().decode(zip);
  assert.ok(decoded.includes("photo-clean.jpg"));
  assert.ok(decoded.includes("rapport-privé.json"));
});
