// Import rebuilt posts into the live EmDash site. Idempotent: state in out2/_state.json.
// usage: node import.js [--limit N] [--dry]
const fs = require("fs");
const T = require("./paths").DATA;
const OUT = T + "/out2";
const BASE = "https://blog.jaysonknight.com/_emdash/api";
const TOKEN = process.env.EMDASH_TOKEN;
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : Infinity;
const DRY = args.includes("--dry");
const H = { Authorization: "Bearer " + TOKEN, "Accept-Encoding": "identity" };
const J = { ...H, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statePath = OUT + "/_state.json";
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : { posts: {}, media: {}, missingImages: [], redirects: {} };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));

async function api(method, path, body, headers = J) {
	for (let a = 0; a < 4; a++) {
		let r;
		try { r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }); }
		catch { await sleep(3000 * (a + 1)); continue; }
		if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
		const t = await r.text();
		let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
		return { status: r.status, ok: r.ok, j };
	}
	return { status: 0, ok: false, j: {} };
}

// wall-clock America/New_York -> ISO UTC
function nyToIso(wall) {
	const [d, t] = wall.split("T");
	const [y, mo, da] = d.split("-").map(Number), [h, mi] = t.split(":").map(Number);
	const guess = Date.UTC(y, mo - 1, da, h, mi);
	const off = (ms) => {
		const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms)).reduce((o, x) => ((o[x.type] = x.value), o), {});
		return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms;
	};
	let ms = guess - off(guess);
	ms = guess - off(ms);
	return new Date(ms).toISOString();
}

async function uploadImage(src, rec) {
	let abs;
	try { abs = new URL(src, "http://jaysonknight.com/").href; } catch { return null; }
	if (state.media[abs] !== undefined) return state.media[abs];
	let result = null;
	for (const target of [`https://web.archive.org/web/${rec.ts}im_/${abs}`, `https://web.archive.org/web/2im_/${abs}`]) {
		try {
			const r = await fetch(target);
			const ct = r.headers.get("content-type") || "";
			if (r.ok && /^image\//.test(ct)) {
				const buf = Buffer.from(await r.arrayBuffer());
				if (buf.length < 200) continue;
				const ext = ct.split("/")[1].split(";")[0].replace("jpeg", "jpg").replace("svg+xml", "svg");
				let name = decodeURIComponent(new URL(abs).pathname.split("/").pop() || "image").replace(/[^\w.-]+/g, "_");
				if (!/\.\w{2,4}$/.test(name)) name += "." + ext;
				const fd = new FormData();
				fd.append("file", new Blob([buf], { type: ct.split(";")[0] }), name);
				const up = await api("POST", "/media", fd, H);
				const item = up.j?.data?.item;
				if (up.ok && item?.storageKey) { result = `/_emdash/api/media/file/${item.storageKey}`; break; }
				console.log("  upload failed", up.status, JSON.stringify(up.j).slice(0, 150));
			}
		} catch {}
		await sleep(500);
	}
	state.media[abs] = result;
	return result;
}

(async () => {
	const recs = JSON.parse(fs.readFileSync(OUT + "/_all.json"));
	// categories
	const tr = await api("GET", "/taxonomies/category/terms");
	const terms = new Map((tr.j.data?.terms || []).map((t) => [t.label.toLowerCase(), t.id]));
	const { slugify } = require("./convert.js");
	let done = 0, skipped = 0, failed = 0;
	for (const rec of recs) {
		if (done >= LIMIT) break;
		if (state.posts[rec.slug]) { skipped++; continue; }
		const content = [];
		for (const b of rec.data.content) {
			if (b._type === "image" && b._pendingSrc) {
				const url = DRY ? "dry" : await uploadImage(b._pendingSrc, rec);
				if (!url) { state.missingImages.push({ slug: rec.slug, src: b._pendingSrc }); continue; }
				content.push({ _type: "image", _key: b._key, asset: { _type: "reference", _ref: url, url }, alt: b.alt || "" });
			} else content.push(b);
		}
		const publishedAt = nyToIso(rec.date);
		if (DRY) { console.log("DRY", rec.date, publishedAt, rec.slug, rec.cats.join("|")); done++; continue; }
		const res = await api("POST", "/content/posts", { slug: rec.slug, data: { title: rec.title, content, excerpt: rec.data.excerpt }, publishedAt, createdAt: publishedAt });
		let item = res.j?.data?.item;
		if (!res.ok) {
			// created just before an earlier crash? adopt it instead of failing
			const ex = await api("GET", `/content/posts/${encodeURIComponent(rec.slug)}`);
			const e = ex.j?.data?.item;
			if (ex.ok && e?.id && e.data?.title === rec.title) item = e;
		}
		if (!item?.id) { console.log("FAIL create", rec.slug, res.status, JSON.stringify(res.j).slice(0, 200)); failed++; continue; }
		const id = item.id;
		// publish
		const pub = await api("POST", `/content/posts/${id}/publish`);
		if (!pub.ok) console.log("  publish issue", rec.slug, pub.status, JSON.stringify(pub.j).slice(0, 160));
		// categories
		const termIds = [];
		for (const c of rec.cats) {
			let id2 = terms.get(c.toLowerCase());
			if (!id2) {
				const cr = await api("POST", "/taxonomies/category/terms", { slug: slugify(c), label: c });
				id2 = cr.j?.data?.term?.id || cr.j?.data?.id;
				if (id2) terms.set(c.toLowerCase(), id2); else console.log("  term create failed", c, cr.status, JSON.stringify(cr.j).slice(0, 150));
			}
			if (id2) termIds.push(id2);
		}
		if (termIds.length) {
			const tt = await api("POST", `/content/posts/${id}/terms/category`, { termIds });
			if (!tt.ok) console.log("  terms failed", rec.slug, tt.status, JSON.stringify(tt.j).slice(0, 150));
		}
		state.posts[rec.slug] = id;
		done++;
		if (done % 10 === 0) { save(); console.log("imported", done); }
		await sleep(150);
	}
	save();
	console.log({ done, skipped, failed, missingImages: state.missingImages.length });
})();
