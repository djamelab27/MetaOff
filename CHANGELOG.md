# Changelog

## 1.0.0 — 2026-09-01

- Inspect JPEG, PNG, and WebP metadata locally.
- Decode common EXIF/TIFF device, timestamp, identity, and GPS fields.
- Remove EXIF, XMP, IPTC, comments, PNG text/time/density chunks, and optional ICC profiles without recompressing image pixels.
- Batch-clean up to 100 photos in a Web Worker.
- Rescan every output and generate SHA-256 privacy reports.
- Download individual files or a single ZIP with CRC-32 checksums.
- Ship as Manifest V3 with zero requested Chrome permissions.
