# Content and media tools

These scripts keep the public repository free of portfolio media while preserving a verifiable map from the private legacy checkout to Cloudflare R2.

## Import and verify

```powershell
npm run content:import -- --legacy-root ".."
npm run content:validate -- --legacy-root ".." --deep
```

The import reads the legacy TypeScript project array as syntax data without executing it. It writes 21 JSON content entries and a 197-item media manifest containing dimensions, byte counts, SHA-256 hashes, alt text, media order, and deterministic R2 keys.

`--deep` re-hashes every source file. Run it before and after the originals upload and compare the manifest with the R2 verification download.

## Prepare web media

Install `ffmpeg` locally before preparing the nine videos. Then run:

```powershell
npm run media:prepare -- --legacy-root ".."
```

Prepared files are written under ignored `.media-work/web/`. Images are auto-oriented, converted to sRGB, stripped of source metadata, limited to 3840px, and encoded as quality-82 JPEG or optimized PNG. Videos are limited to 1920×1080 and 60fps, encoded as H.264/yuv420p with CRF 20 and `faststart`, with AAC audio when present and a JPEG poster.

## Create manual R2 upload plans

```powershell
npm run media:upload-plan -- --legacy-root ".."
```

This writes ignored PowerShell plans for the private `jasminjiang-originals` bucket and public `jasminjiang-web-media` bucket. Authenticate interactively with `npx wrangler login`; no API keys or Cloudflare credentials belong in this repository, generated plans, or chat.
