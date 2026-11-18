---
name: upgrade-emdash-site
description: Upgrade this EmDash site end to end — update packages, apply release-note changes, regenerate types, typecheck, build, commit, push, wait for the Cloudflare Workers Build, and verify the live site. Use when asked to "upgrade EmDash", "run the upgrade", or "update and deploy".
---

# Upgrade and deploy jk-com-blog

Invoking this skill (or asking "upgrade emdash") authorizes the commit, push to `main`, and the
resulting Cloudflare deploy. A database backup or migration still needs a stop-and-ask (step 6).

Deploy mechanism: Cloudflare Workers Builds, triggered by a push to `origin/main`
(build `pnpm build`, deploy `pnpm wrangler deploy`). Live site: https://blog.jaysonknight.com.
Do not run `wrangler deploy` locally unless Workers Builds is broken.

## Steps

1. **Preflight.** `git status` must be clean (or only contain the user's intended work). Kill stray
   `astro dev` / `workerd` node processes first — low free RAM makes `astro check` crash with
   `memory allocation ... failed`. Never run `astro check` and `astro dev` at the same time.
2. **Plan.** `npx upgrade-emdash@latest --dry-run`. If nothing changes, say so and skip to step 8
   (still verify the live site).
3. **Upgrade.** `npx upgrade-emdash@latest --yes`, then read `.emdash/UPGRADE.md` completely.
   `.emdash/UPGRADE.md` is a generated work order; do not commit it.
4. **Apply release entries.** Assess each entry against this project; change only surfaces we use.
   Compare `wrangler.jsonc`, `src/worker.ts`, and `astro.config.mjs` against the current
   Cloudflare deploy guide (`mcp__emdash-docs__search_docs`: "deploy to Cloudflare") — the bindings
   and Worker exports change between releases (e.g. `EMDASH_ROOMS` / `EmDashRoom`).
   Constraints: no Workers Paid features (no sandboxed plugins, no `LOADER` binding, no
   `sandboxRunner`); D1/R2 resource names in `wrangler.jsonc` must not be renamed.
5. **Regenerate and verify locally** (one at a time):
   - `pnpm install`
   - `npx wrangler types` (rewrites `worker-configuration.d.ts`)
   - `pnpm dev`, wait for `http://localhost:4321/`, then stop it — starting it regenerates
     `emdash-env.d.ts` (`npx emdash types` needs the local setup wizard and may fail; that is OK)
   - `pnpm verify` (`astro check` must report 0 errors, then `astro build` must pass)
6. **Migrations.** Run `npx emdash migrate --check` if credentials allow (it needs the deployed DB).
   If the work order lists added core migrations or a data-changing step, STOP and ask the user:
   a restorable D1 backup, a separate R2 backup, and the encryption keys are required first
   (https://docs.emdashcms.com/guides/backups/). Migrations are forward-only; roll back by restoring
   the DB and the matching build together.
7. **Commit and push.** Stage by name, not `git add -A` blindly — never commit `.env*`, `.dev.vars`,
   `.claude/settings.local.json`, `dist`, `.wrangler`, or `.emdash/UPGRADE.md`. One commit, message
   describing the version bump and config changes. `git push origin main`.
8. **Wait for the build.** Poll with a Monitor until-loop (no sleep chains):
   `gh api repos/jk-dot-com/jk-com-blog/commits/<sha>/check-runs --jq '.check_runs[]|select(.name|startswith("Workers Builds"))|{status,conclusion,output:.output.summary}'`
   Report build and version IDs. On failure, read the build log link, fix, and repeat from step 5.
9. **Verify live.** `pnpm verify:live` must print `all checks passed`.
10. **Report** what changed, what was verified, and what the user must check by hand: sign in at
    `/_emdash/admin`, edit and publish a disposable entry (also tests co-editing), upload a
    disposable media file. Say plainly anything skipped (e.g. migrate check without credentials).
