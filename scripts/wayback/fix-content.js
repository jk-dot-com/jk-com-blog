// Regenerate every imported post's body from the recovered source, with all cleanups applied, and update/publish
// only the posts whose live content differs. usage: node fix-content.js [--dry] [--limit N] [--slug s]
const fs = require("fs");
const T = require("./paths").DATA;
const OUT = T + "/out2";
const { polishContent } = require("./polish.js");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIMIT = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : Infinity;
const ONLY = args.includes("--slug") ? new Set(args[args.indexOf("--slug") + 1].split(",")) : null;
const BASE = "https://blog.jaysonknight.com/_emdash/api";
const H = { Authorization: "Bearer " + process.env.EMDASH_TOKEN, "Accept-Encoding": "identity", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = JSON.parse(fs.readFileSync(OUT + "/_state.json"));
const recs = JSON.parse(fs.readFileSync(OUT + "/_all.json"));

// the redirect table that is deployed with the site: old URL path (lowercased) -> new path
const redirects = new Map();
for (const line of fs.readFileSync(require("./paths").REDIRECTS, "utf8").split("\n")) {
	if (!line || line.startsWith("#")) continue;
	const [src, dst] = line.split(" ");
	redirects.set(src.toLowerCase(), dst);
}

const OLD_HOST = /^https?:\/\/(?:www\.)?(?:blog\.)?jaysonknight\.com(?::\d+)?(\/(?:blog|jayson|files)\/[^?#]*)(\?[^#]*)?(#.*)?$/i;
// dead external links (fix-links.js): the Wayback snapshot nearest the post's date, or "" to drop the link and keep its text
const LINKMAP_FILE = T + "/link-map.json";
const LINKMAP = fs.existsSync(LINKMAP_FILE) ? JSON.parse(fs.readFileSync(LINKMAP_FILE)) : {};
// alt text written by hand for imported images that had none (source URL -> description)
const ALT_FILE = T + "/alt-text.json";
const ALT_TEXT = fs.existsSync(ALT_FILE) ? JSON.parse(fs.readFileSync(ALT_FILE)) : {};
// the crawl sees "http://host" as "http://host/" and drops "#fragments", so look links up in that form
const canon = (href) => { try { const u = new URL(href); u.hash = ""; return u.href; } catch { return href; } };
const LINKMAP_CANON = new Map(Object.entries(LINKMAP).map(([k, v]) => [canon(k), v]));
const fragmentOf = (href) => { try { return new URL(href).hash; } catch { return ""; } };
const OLD_RELATIVE = /^\/(blog|jayson|files)\//i;
const ZERO = /^https?:\/\/zerotrilogy\.gotdns\.com\//i;

/** New home of an old link, or null to leave it alone. */
function rewriteHref(raw) {
	const href = OLD_RELATIVE.test(raw) ? "http://jaysonknight.com" + raw : raw;
	const mapped = LINKMAP_CANON.get(canon(href));
	if (mapped !== undefined) return mapped && mapped.includes("web.archive.org") ? mapped + fragmentOf(href) : mapped;
	if (ZERO.test(href)) return `https://web.archive.org/web/2/${href}`;
	const m = href.match(OLD_HOST);
	if (!m) return null;
	const path = m[1];
	if (/^\/(blog|jayson)\/(rss\.aspx|rss\.ashx)$/i.test(path)) return "/rss.xml";
	const hit = redirects.get(path.toLowerCase());
	if (hit) return hit + (m[3] || "");
	if (/^\/(blog|jayson)\/(default\.aspx)?$/i.test(path) || /^\/(blog|jayson)\/archive\/(category|tags)\//i.test(path) || /^\/(blog|jayson)\/archive\/\d{4}\/\d\d\.aspx$/i.test(path)) return "/posts";
	// an old post that was never recovered: its archived copy, if the Wayback Machine has one
	return `https://web.archive.org/web/2/${href}`;
}

function splitLongBlocks(blocks) {
	const out = [];
	const LIMIT_CHARS = 1800, TARGET = 1000;
	for (const b of blocks) {
		const text = b._type === "block" && b.style === "normal" && !b.listItem ? b.children.map((c) => c.text).join("") : "";
		if (text.length <= LIMIT_CHARS) { out.push(b); continue; }
		const ABBREV = /\b(e\.g|i\.e|vs|approx|mr|mrs|dr|inc|no)\.\s*$/i;
		const pick = (re) => {
			const cuts = [];
			let m;
			while ((m = re.exec(text))) { const at = m.index + m[0].length; if (!ABBREV.test(text.slice(Math.max(0, at - 9), at))) cuts.push(at); }
			const chosen = [];
			let last = 0;
			for (const c of cuts) { if (c - last >= TARGET && text.length - c >= 300) { chosen.push(c); last = c; } }
			return chosen;
		};
		// sentence ends followed by a capital; failing that (all-lowercase writers) followed by any letter
		const chosen = pick(/[.!?]["\u201d')\]]?\s+(?=["\u201c(]?[A-Za-z0-9])/g);
		if (!chosen.length) { out.push(b); continue; }
		const bounds = [0, ...chosen, text.length];
		for (let i = 0; i < bounds.length - 1; i++) {
			const [from, to] = [bounds[i], bounds[i + 1]];
			const children = [];
			let pos = 0;
			for (const c of b.children) {
				const s = Math.max(from, pos), e = Math.min(to, pos + c.text.length);
				if (e > s) children.push({ ...c, text: c.text.slice(s - pos, e - pos) });
				pos += c.text.length;
			}
			if (children.length) { children[0] = { ...children[0], text: children[0].text.replace(/^\s+/, "") }; const l = children.length - 1; children[l] = { ...children[l], text: children[l].text.replace(/\s+$/, "") }; }
			const used = new Set(children.flatMap((c) => c.marks));
			out.push({ ...b, _key: b._key + "s" + i, children: children.filter((c) => c.text.length), markDefs: (b.markDefs || []).filter((d) => used.has(d._key)) });
		}
	}
	return out;
}

function buildContent(rec) {
	const blocks = [];
	for (const b of rec.data.content) {
		if (b._type === "image" && b._pendingSrc) {
			let abs; try { abs = new URL(b._pendingSrc, "http://jaysonknight.com/").href; } catch { continue; }
			const url = state.media[abs];
			if (!url) continue;
			blocks.push({ _type: "image", _key: b._key, asset: { _type: "reference", _ref: url, url }, alt: b.alt || ALT_TEXT[abs] || "" });
		} else if (b._type === "block") {
			const nb = JSON.parse(JSON.stringify(b));
			// the old HTML export dropped the "</" of this closing tag
			if (rec.slug === "httphandler-custom-isapi-extension-mapping") for (const c of nb.children) if (c.text === "httpHandlers>") c.text = "</httpHandlers>";
			for (const d of nb.markDefs || []) if (d._type === "link") { const n = rewriteHref(d.href); if (n !== null) d.href = n; }
			// drop link marks that wrap nothing visible
			for (const d of [...(nb.markDefs || [])]) {
				const spans = nb.children.filter((c) => c.marks.includes(d._key));
				if (d._type === "link" && (d.href === "" || spans.every((c) => !c.text.trim()))) { nb.children.forEach((c) => (c.marks = c.marks.filter((k) => k !== d._key))); nb.markDefs = nb.markDefs.filter((x) => x._key !== d._key); }
			}
			blocks.push(nb);
		} else blocks.push(b);
	}
	let content = polishContent(splitLongBlocks(blocks)).blocks;
	return content;
}

const NOTES = {
	"scobles-leaving-microsoft": {
		note: "The cartoon that originally appeared in this post (from gapingvoid.com) is no longer available.",
		excerpt: "Scoble's Leaving Microsoft. The original post was a single cartoon from gapingvoid.com, which is no longer available.",
	},
};

async function api(method, path, body) {
	for (let a = 0; a < 4; a++) {
		try {
			const r = await fetch(BASE + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
			if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
			const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; }
			return { ok: r.ok, status: r.status, j };
		} catch { await sleep(2000 * (a + 1)); }
	}
	return { ok: false, status: 0, j: {} };
}
const textOf = (blocks) => blocks.filter((b) => b._type === "block").map((b) => b.children.map((c) => c.text).join("")).join(" ").replace(/\s+/g, " ").trim();

(async () => {
	let checked = 0, changed = 0, failed = 0, wordsDiff = [];
	const stats = { links: 0, split: 0 };
	for (const rec of recs) {
		const id = state.posts[rec.slug];
		if (!id || (ONLY && !ONLY.has(rec.slug))) continue;
		if (checked >= LIMIT) break;
		checked++;
		let content = buildContent(rec);
		let excerpt = rec.data.excerpt;
		const note = NOTES[rec.slug];
		if (note && !textOf(content)) {
			content = [...content, { _type: "block", _key: "note1", style: "normal", children: [{ _type: "span", _key: "note1s", text: note.note, marks: ["em"] }], markDefs: [] }];
			excerpt = note.excerpt;
		}
		const live = await api("GET", `/content/posts/${id}`);
		const item = live.j?.data?.item;
		if (!item) { console.log("skip (read failed)", rec.slug); continue; }
		const liveContent = item.data.content;
		// the server normalizes an image's asset reference to its media id on save; keep the stored form
		const liveAssets = new Map(liveContent.filter((b) => b._type === "image").map((b) => [b.asset?.url, b.asset]));
		content = content.map((b) => (b._type === "image" && liveAssets.has(b.asset?.url) ? { ...b, asset: liveAssets.get(b.asset.url) } : b));
		// words must be identical apart from whitespace, and apart from deliberate notes
		if (!note && textOf(liveContent) !== textOf(content)) wordsDiff.push(rec.slug);
		const sameContent = JSON.stringify(liveContent) === JSON.stringify(content);
		const sameExcerpt = (item.data.excerpt || "") === (excerpt || "");
		if (sameContent && sameExcerpt) continue;
		changed++;
		if (DRY && process.env.EXPLAIN && ONLY) {
			const k = liveContent.findIndex((b, i) => JSON.stringify(b) !== JSON.stringify(content[i]));
			console.log("first difference at block", k, "\n LIVE:", JSON.stringify(liveContent[k]).slice(0, 400), "\n NEW: ", JSON.stringify(content[k]).slice(0, 400), "\n excerpt same:", sameExcerpt);
		}
		if (DRY) { if (changed <= 8) console.log("WOULD UPDATE", rec.slug, `blocks ${liveContent.length}->${content.length}`); continue; }
		const put = await api("PUT", `/content/posts/${id}`, { data: { content, excerpt }, _rev: live.j.data._rev || item._rev });
		if (!put.ok) { failed++; console.log("FAIL put", rec.slug, put.status, JSON.stringify(put.j).slice(0, 140)); continue; }
		const pub = await api("POST", `/content/posts/${id}/publish`);
		if (!pub.ok) { failed++; console.log("FAIL publish", rec.slug, pub.status); }
		await sleep(120);
	}
	console.log({ checked, changed, failed, dry: DRY });
	console.log("posts whose WORDS would change (must be empty apart from intended notes):", wordsDiff.length, wordsDiff.slice(0, 10));
})();
