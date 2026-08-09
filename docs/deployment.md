# Cloudflare Pages deployment

## Pages project

Connect the GitHub repository `JasminJiang/PersonalPortfolio-v2` to Cloudflare
Pages with these settings:

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `22`
- Environment variable: `PUBLIC_ASSET_ORIGIN=https://assets.jasminjiang.com`

Preview deployments should remain enabled for pull requests. The site is fully
static and does not need a server adapter, runtime binding, or R2 credential.

## Production domains

Attach `jasminjiang.com` as the production custom domain. Attach
`www.jasminjiang.com` to the Pages project, then create a Cloudflare Redirect
Rule that sends `www.jasminjiang.com/*` to the equivalent path on
`https://jasminjiang.com` with status `301`. Preserve the incoming path and
query string.

Keep `assets.jasminjiang.com` connected only to the public media bucket. The
private originals bucket must not have a custom domain or development URL.

## Release order

1. Upload and verify all public and private media.
2. Confirm the pull-request preview at desktop, tablet, and mobile sizes.
3. Run the complete CI and Lighthouse checks.
4. Merge the draft pull request with a merge commit. Do not squash it.
5. Bind the production domains and confirm the canonical host redirect.
6. Review the repository for credentials and restricted media before changing
   its visibility to public.

Deleting the legacy repository is a separate, manual operation. It must happen
only after the production site, private-original restore test, and clean clone
have all been verified and the owner explicitly confirms deletion.
