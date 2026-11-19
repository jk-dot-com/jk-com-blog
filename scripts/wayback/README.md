# Wayback import and audit tools

These scripts rebuilt the blog's 2003–2020 posts from the Internet Archive (834 posts) and keep the result healthy:
they convert archived Community Server pages to Portable Text, import them through the EmDash API, repair formatting
and links, and crawl the live site to prove nothing is broken. They are one person's tools for one site, kept so the
work can be repeated or extended, not a product.

## Setup

```bash
cd scripts/wayback
npm install                 # linkedom, the only dependency
```

Scripts that write to the blog need an admin API token. Put it in the repo's gitignored `.env` as `EMDASH_TOKEN=...`
(it lives in the 1Password **Claude** environment as `JKBLOG_CLAUDETOKEN_CLAUDE`) and run them with
`node --env-file=../../.env <script>.js`. Delete the `.env` when you are done.

Working files live in `data/` (override with `WAYBACK_DATA=/some/dir`). Four are committed because they are expensive to
rebuild; the rest are regenerated and gitignored:

| File                  | What it is                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `data/out2/_all.json` | The 834 recovered posts: title, date, categories, old URLs and Portable Text body (the source)    |
| `data/out2/_state.json` | Slug to EmDash id map, uploaded-media map, and the images that could not be recovered             |
| `data/link-map.json`  | Dead external link to its nearest Wayback snapshot, or `""` to drop the link and keep its text     |
| `data/recoverable.json` | Images the Wayback index revealed, as input to `recover-upload.js`                                |

## What each script does

Pipeline, in the order it was first run:

1. `convert.js`, `convert2.js` turn archived post HTML into the records in `_all.json` (dates, categories, images, code).
2. `import.js` creates the posts through the REST API and writes `_state.json`.
3. `polish.js` formatting rules: merges code lines into code blocks, guesses the language (mostly C#), re-indents.
4. `cat-tidy.js`, `redirects-old.js`, `gen-listing-redirects.js` produce the category cleanup and `public/_redirects`.

Maintenance, any time:

| Script                    | Use                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `crawl.js [--no-external]` | Crawls every page from the sitemaps; checks internal links, assets, meta tags and every external link. Writes `crawl.json`. |
| `fix-links.js`            | Reads `crawl.json`, looks up Wayback snapshots for dead external links and writes `link-map.json`.                          |
| `fix-content.js [--dry] [--slug a,b] [--limit N]` | Rebuilds every imported post body from `_all.json` (polish, long-paragraph splitting, link rewrites via `public/_redirects` and `link-map.json`) and updates only posts whose live content differs. **It overwrites edits made in the admin to imported posts**, so use `--slug` or `--dry` first. |
| `audit.js`                | Audits each imported post as rendered: mojibake, leftover markup, code blocks, images, old internal links. Writes `audit.json`. |
| `smoke.js`                | A 20-odd point check of the live site (pages, pagination, redirects, sitemaps, feed).                                        |
| `find-images.js`, `recover-more.js`, `recover-upload.js` | Hunt for images that were never recovered, then upload them (`node recover-upload.js [file]`).        |

## Gotchas

- **Cloudflare's WAF** returns a 403 page for a content write whose body mentions ASP.NET paths ("DotNetNuke - File
  Inclusion"). The Free plan can only skip the whole managed phase, so add a narrow, temporary skip rule for the run
  and remove it straight after. Ask first.
- **Bot Fight Mode** blocks headless browsers, not these scripts (they send an ordinary `User-Agent`).
- `PUT /content/posts/:id` saves a draft revision; the scripts also `POST .../publish`. The server rewrites an image's
  `asset._ref` to the media id on save, so `fix-content.js` reuses the live `asset` objects to avoid false diffs.
- Wayback lookups are rate limited (HTTP 429); the scripts back off and retry.
- About 35 images referenced by old posts were never archived and cannot be recovered from here.
