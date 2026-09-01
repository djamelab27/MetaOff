# MetaOff

**Share the photo. Not its hidden history.**

MetaOff is a privacy-first Chrome extension that reveals and removes hidden metadata from JPEG, PNG, and WebP photos. Everything happens locally in the browser: no upload, account, analytics, remote code, or network request.

## The problem

A harmless-looking photo can still expose:

- exact GPS latitude, longitude, and altitude;
- original capture and editing timestamps;
- camera, phone, lens, and software details;
- author names, copyright fields, comments, and captions;
- EXIF, XMP, IPTC, PNG text chunks, and embedded thumbnails.

Social platforms often remove some metadata, but not every sharing route does. Marketplace attachments, forums, cloud links, documents, and direct file transfers may preserve it.

## What makes MetaOff different

- **Visible before cleaning.** MetaOff shows the fields and values it found instead of offering a blind “clean” button.
- **Lossless by default.** It removes metadata containers without decoding or recompressing encoded pixels.
- **Verified output.** Every cleaned file is scanned again before MetaOff marks it clean.
- **Batch workflow.** Inspect and clean up to 100 photos, then download one ZIP.
- **Auditable report.** The ZIP contains a JSON report with before/after SHA-256 hashes and removed container types.
- **Zero Chrome permissions.** The extension asks for no browser, website, storage, or network permission.

## Supported formats

| Format | Inspected | Removed without recompression |
| --- | --- | --- |
| JPEG | EXIF/TIFF, GPS, XMP, IPTC, comments, ICC | EXIF, XMP, IPTC, comments; ICC optional |
| PNG | eXIf, tEXt, zTXt, iTXt, tIME, pHYs, iCCP | All listed chunks; iCCP optional |
| WebP | EXIF, XMP, ICCP, VP8X flags | EXIF, XMP; ICCP optional |

Color profiles are preserved by default because they can affect how colors render. Users can explicitly remove them for maximum metadata minimization.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this directory.
5. Click MetaOff and open the private cleaner.

## Development

MetaOff has no runtime or development dependencies beyond Node.js 20+.

```bash
npm test
npm run check
npm run package
```

`npm test` exercises the binary parsers and sanitizers with synthetic JPEG, PNG, and WebP fixtures containing GPS, timestamps, device information, XMP, IPTC, comments, and ICC profiles.

## Technical design

The UI sends an `ArrayBuffer` to a module Web Worker. The worker identifies the container and parses metadata with bounded reads. Sanitization copies only permitted segments/chunks into a new byte array. It never invokes `eval`, loads remote code, or makes a network request.

The generated ZIP uses the standard store method and includes CRC-32 checksums. SHA-256 hashes are calculated with Web Crypto.

## Privacy and security

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). MetaOff never guarantees that an unsupported or malformed file contains no hidden information; unsupported files are rejected rather than modified.

## License

MIT
