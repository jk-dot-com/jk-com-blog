# jk-com-blog

Personal blog built with [EmDash](https://github.com/emdash-cms/emdash) (Astro) and deployed on Cloudflare Workers with D1 and R2.

## Stack

- **Runtime:** Cloudflare Workers (`@astrojs/cloudflare`)
- **Database:** D1 (`DB` binding)
- **Media:** R2 (`MEDIA` binding)
- **Plugins:** forms
- **Co-editing:** Durable Object rooms (`EMDASH_ROOMS`)

## Local development

```bash
pnpm install
pnpm dev
```

Admin UI: `http://localhost:4321/_emdash/admin`

## Checks

```bash
pnpm typecheck
pnpm build
```

Regenerate collection types from a running site with `npx emdash types`.

## Deploying

Pushes to GitHub are built by Cloudflare Workers Builds:

- Build command: `pnpm build`
- Deploy command: `pnpm wrangler deploy`

Manual deploy: `pnpm deploy`. Secrets go in `wrangler secret put`, never in `wrangler.jsonc`.

## Upgrading EmDash

Run `npx upgrade-emdash@latest`, then follow the generated `.emdash/UPGRADE.md`. Check migrations with `npx emdash migrate --check` before deploying.
