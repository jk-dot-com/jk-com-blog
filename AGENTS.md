This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
pnpm dev              # Start the Astro dev server
npx emdash types      # Regenerate TypeScript types from a running site
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.
- **upgrade-emdash-site** -- Full upgrade, deploy, and verification runbook for this site.

## Upgrading and deploying

To upgrade EmDash and deploy, say "upgrade emdash" (or load the **upgrade-emdash-site** skill). It runs the whole
process: `upgrade-emdash`, config changes, type generation, `pnpm verify`, commit, push, wait for the Cloudflare
Workers Build, then `pnpm verify:live`. Deploys happen through Workers Builds on push to `main`, not local
`wrangler deploy`. The Cloudflare account is on Workers Paid, so sandboxed plugins are enabled (`sandboxed: []` + `sandbox()` + the `LOADER` binding; `PluginBridge` is exported from `src/worker.ts`). `emdash-better-auth` is installed but intentionally NOT registered, because it would change sign-in. Don't rename the D1/R2 resources in `wrangler.jsonc`.

Cloudflare WAF and bot rules live in the dashboard, not the repo. Verified search engines, feed fetchers, link previews and the Claude and OpenAI crawlers are allowed; other known bots are challenged, and the remaining AI crawlers (rule ref `[CF AI Audit]`) are blocked by user agent. The goal is an open site that isn't abused. Ask before changing those rules.

## Documentation

**Always check the EmDash docs MCP server (`mcp__emdash-docs__search_docs`) before changing EmDash config, bindings, Worker entry points, plugins, deployment, or upgrade steps -- without being asked.** Don't rely on memory or training data.

There are two separate MCP servers: `emdash-docs` (documentation, project `.mcp.json`) and `emdash-site` (this live site's own MCP server at `https://blog.jaysonknight.com/_emdash/api/mcp`, user-scope, OAuth; reads and edits live content and schema). Prefer `emdash-site` over raw D1 queries for content work, since it goes through EmDash's revision and validation layer.

The EmDash docs are available as an MCP server at `https://docs.emdashcms.com/mcp`. When you need to verify an API, hook, config option, field type, or pattern, call `search_docs` against the live documentation rather than relying on training-data recall. The docs reflect current behaviour; assumptions may not.

This template ships with `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json` so Claude Code, Cursor, and VS Code auto-discover the docs server. Other tools (OpenCode, Windsurf, etc.) need a manual one-time setup -- see [docs.emdashcms.com/docs-mcp](https://docs.emdashcms.com/docs-mcp).

## Live data and content repair

- Remote D1 id is in `wrangler.jsonc`; tables: `ec_posts` (content is Portable Text JSON), `media`, `revisions`. Read-only inspection works via the Cloudflare MCP `d1_database_query`.
- Code blocks are `{_type:"code", code, language?, filename?}`; images are `{provider,id,src,alt}` with src `/_emdash/api/media/file/<storage_key>`.
- WordPress import flattened some posts (stray CSS/script text, whole articles in one paragraph, code newlines lost). Check for blocks over 3000 chars before trusting imported content.

## Windows gotchas

- Git Bash rewrites args starting with `/` (curl paths); use `MSYS_NO_PATHCONV=1` or a node script.
- Stray `astro dev`/`workerd` processes exhaust RAM and crash `astro check`; stop them with PowerShell `Stop-Process`.

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## This Template

A blog with posts, pages, categories, tags, full-text search, and RSS. Designed for personal writing, technical writing, indie newsletters, and anything where the writing is the product. Editorial-tech aesthetic: confident sans-serif, restrained accent, real article structure with bylines and reading time.

## Pages

| Page        | Path               | What it shows                                                                                          |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Home        | `/`                | Featured post hero (large image + excerpt), latest posts grid                                          |
| All posts   | `/posts`           | Article count, full post list with excerpts and tag chips                                              |
| Post detail | `/posts/[slug]`    | Featured image, title, body, left meta column (authors + date), right TOC + search + categories gutter |
| Search      | `/search`          | Full-text search UI                                                                                    |
| Page        | `/pages/[slug]`    | Static page content (Portable Text)                                                                    |
| Category    | `/category/[slug]` | Posts filtered by category                                                                             |
| Tag         | `/tag/[slug]`      | Posts filtered by tag                                                                                  |
| RSS         | `/rss.xml`         | Generated feed                                                                                         |

## Schema

- `posts` collection: `title`, `featured_image`, `content` (Portable Text), `excerpt` (text).
- `pages` collection: `title`, `content` (Portable Text). Used for `/about` etc.
- Taxonomies: `category`, `tag`.
- Single `primary` menu (Home, About, Posts by default).

Site settings have `title` and `tagline` -- both render in the header / footer.

## Visual character

The theme is **Phosphorous**, the JK.com design language: a dark-only, CRT-flavoured look (near-black grounds, electric cyan as the main accent, azure as the structural accent, neon red/pink/purple used sparingly). **There is no light mode and none is planned**; the theme switcher is hidden and `color-scheme` is pinned to dark. Headings and UI use **Space Grotesk**, code and labels use **JetBrains Mono**, body copy uses the system-ui stack. Depth is neon glow, not gray drop shadows. See the design guide in `node_modules/@jk-dot-com/phosphorous/readme.md`.

The article layout is still the standout feature: a three-column reading view with a left meta column (author bylines, date), centred 680px body column, and a right gutter for search, table of contents, and categories. Don't flatten that into one column on desktop.

## Design system and customisation

- Tokens come from the **@jk-dot-com/phosphorous** package (repo `jk-dot-com/jk.com-design-system`), pinned to a commit in `package.json`. It is the single source of truth: change tokens in that repo, never copy values into this one.
- `src/styles/theme.css` imports the Phosphorous token files (not `fonts.css`, which loads Google Fonts at runtime) and maps the EmDash token names onto them. Shared names (`--color-bg`, `--color-surface`, `--color-text`, `--color-border`, `--font-heading`) flow through unchanged. Don't edit `tokens.css`.
- To pick up a design-system change: `pnpm add "@jk-dot-com/phosphorous@github:jk-dot-com/jk.com-design-system#<new commit sha>"`, then `pnpm verify`, commit, push. The repo has no release tags yet, so pin by SHA.
- Webfonts are self-hosted through Astro in `astro.config.mjs` under `fonts:` (Space Grotesk on `--font-heading`, JetBrains Mono on `--font-mono`), and `Base.astro` renders them with `<Font>`. Body copy has no webfont.
- `src/components/ArticleCode.astro` owns code-block and mermaid rendering so it can use Phosphorous tokens.
- Accessibility: Phosphorous's "ghost" text colour is too faint for small meta text, so `--color-muted` is mapped to a lighter mix. Keep body and meta text at WCAG AA contrast.

## What not to do

- Don't add a light mode or colour-scheme switcher. The site is dark by design.
- Don't fork or hand-edit Phosphorous values in this repo; change the design system and bump the pin.
- Don't import `@jk-dot-com/phosphorous/styles.css` or `tokens/fonts.css` (runtime Google Fonts request); import the individual token files as `theme.css` does.
- Don't collapse the article gutter on desktop; it's part of the reading experience.
- Don't use stock blog copy ("Welcome to my blog", "Stay tuned for more"). Write a real tagline that says what this blog is about.
- Don't seed the home page with three identical placeholder posts. If you only have one real post, show one real post.
- Don't enable comments without a plan to moderate them.
