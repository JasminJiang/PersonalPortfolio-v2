# Cloudflare media setup

The public site reads immutable web media from `https://assets.jasminjiang.com`. Original source files remain in a separate private R2 bucket and are never referenced by browser code.

## 1. Create the buckets

In **Cloudflare Dashboard → R2 Object Storage → Create bucket**, create:

- `jasminjiang-web-media` for prepared JPEG, PNG, MP4, and poster files.
- `jasminjiang-originals` for the untouched source files.

Leave the originals bucket private. Do not enable its `r2.dev` URL or connect a custom domain.

## 2. Connect the public media domain

Open `jasminjiang-web-media`, then go to **Settings → Public access → Custom Domains → Connect Domain**. Connect `assets.jasminjiang.com` and allow Cloudflare to create the DNS record. The custom domain is the production endpoint; the `r2.dev` development URL is not required.

Under **Settings → CORS Policy**, paste the JSON from `cloudflare/r2-web-cors.json`. This bucket contains only public read-only media, so wildcard origin access is intentional; the allowed methods remain limited to `GET` and `HEAD`.

## 3. Enable Cloudflare Images Transformations

Go to **Images → Transformations**, select the `jasminjiang.com` zone, and enable transformations. Keep source access restricted to the same zone. The site uses URLs in this form:

```text
https://assets.jasminjiang.com/cdn-cgi/image/width=1280,quality=82,format=auto,fit=scale-down/projects/example/image.jpg
```

The fixed responsive widths are `480`, `768`, `1280`, `1920`, `2560`, and `3840`. At 207 manifest entries, this stays comfortably within the normal transformation matrix while avoiding arbitrary one-off widths.

## 4. Prepare and upload

Authenticate interactively; never create or paste an R2 API token into the repository or chat.

```powershell
npm exec wrangler login
npm run media:prepare -- --legacy-root ".." --ffmpeg "C:\path\to\ffmpeg.exe"
npm run media:upload-plan -- --legacy-root ".."
```

Run the generated ignored plans in `.media-work/upload-plan/`:

```powershell
& .\.media-work\upload-plan\upload-originals.ps1
& .\.media-work\upload-plan\upload-web.ps1
```

The expected upload counts are:

- Manifest originals: `207` objects.
- Public web media: `216` objects (`207` web objects plus `9` video posters).

Every public upload carries `Cache-Control: public, max-age=31536000, immutable`. Object keys include a source content hash, so changed files receive new URLs rather than overwriting cached content.

## 5. Verify before deployment

After the uploads and custom-domain certificate are ready, run:

```powershell
npm run media:verify-public
npm run media:verify-originals
npm run media:verify-web-r2
```

The public verifier checks all manifest-derived public objects, immutable cache headers, CORS needed by WebGL textures, content types, and a representative set of Cloudflare image transformations. The originals verifier downloads every private object through your interactive Wrangler session, compares it with the manifest SHA-256, and preserves one restored sample. Reports and the restore sample stay under ignored `.media-work/` directories.

The Web R2 verifier independently downloads every prepared object through the authenticated R2 API and compares each object byte-for-byte with the local prepared derivative. This proves upload integrity even before the public custom domain is active; the public verifier remains required for the CDN and transformation layer.

Do not delete the legacy repository or local LFS checkout until the separate full originals SHA-256 verification and restore test have completed.
