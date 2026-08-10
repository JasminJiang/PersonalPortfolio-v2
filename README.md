# Jasmin Xinjie Jiang — Portfolio

The public source for [jasminjiang.com](https://jasminjiang.com), a static
portfolio built with Astro and a focused React/Three.js island for the project
carousel.

## Architecture

- Astro generates the home page, About page, 22 project routes, and the custom
  404 page as static HTML.
- React and React Three Fiber run only on the interactive home carousel.
- Cloudflare Pages serves the site; R2 and image transformations deliver the
  public media through `assets.jasminjiang.com`.
- Source media binaries are intentionally excluded from Git. A private R2
  bucket retains verified originals, while the public bucket contains prepared
  web derivatives and video posters.
- Poppins and JetBrains Mono are bundled locally. Runtime font CDNs are not
  required.

## Local development

Use Node.js 22 and npm.

```bash
npm ci
npm run dev
```

The application uses the production asset origin by default. Copy
`.env.example` to a local environment file only when a different public asset
origin is required.

## Validation

```bash
npm run lint
npm run check
npm run test:unit
npm run build
npm run test:e2e
npm run audit:repository
```

Media preparation, R2 upload, and restore verification are documented in
[`docs/cloudflare-media-setup.md`](docs/cloudflare-media-setup.md). Deployment
and domain configuration are documented in
[`docs/deployment.md`](docs/deployment.md).

## Licensing

Source code is available under the [MIT License](LICENSE). Portfolio copy,
identity, project work, and media are excluded from that license and remain
All Rights Reserved; see [CONTENT_LICENSE.md](CONTENT_LICENSE.md).
