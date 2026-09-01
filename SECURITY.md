# Security Policy

## Supported version

The latest release receives security fixes.

## Reporting a vulnerability

Open a GitHub issue containing a minimal technical description. Do not upload private photos, personal metadata, or proof-of-concept files containing sensitive information to a public issue.

## Security boundaries

- MetaOff processes untrusted image bytes with explicit bounds checks.
- Unsupported containers are rejected.
- It makes no network requests and runs no remote or dynamically generated code.
- It requests zero Chrome permissions.
- It never overwrites an original file.
- Output is rescanned before being marked clean.

Metadata standards have vendor-specific extensions. A “verified clean” result means MetaOff found no supported sensitive metadata after sanitization; it is not a forensic guarantee about arbitrary steganography, visual content, filenames, or unsupported container extensions.
