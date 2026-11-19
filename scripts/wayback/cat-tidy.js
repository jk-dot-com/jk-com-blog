// Merge/clean categories and tags. usage: node cat-tidy.js [--dry]
const fs = require("fs");
const DRY = process.argv.includes("--dry");
const OUT = require("./paths").DATA + "/out2";
const B = "https://blog.jaysonknight.com/_emdash/api";
const H = { Authorization: "Bearer " + process.env.EMDASH_TOKEN, "Accept-Encoding": "identity", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
	for (let a = 0; a < 4; a++) {
		try {
			const r = await fetch(B + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
			if (r.status === 429 || r.status >= 500) { await sleep(2000 * (a + 1)); continue; }
			const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; }
			return { ok: r.ok, status: r.status, j };
		} catch { await sleep(2000 * (a + 1)); }
	}
	return { ok: false, status: 0, j: {} };
}

// source label -> target label (categories)
const MERGE = {
	"Tech": "Technology",
	"Technology and Internet": "Technology",
	"Resources": "Tools and Resources",
	"CS tips and tricks section of his own": "CS Tidbits",
	"Community Server tips and tricks": "CS Tidbits",
	"Firefox tags for more reading": "Firefox",
};
// posts that had no category in the archive
const MANUAL = {
	"a-closer-look-at-the-language-formerly-known-as-x-xen": ["Technology"],
	"motorola-razr-v3-falling-apart-after-only-nine-months": ["Technology", "Irks"],
	"strongly-typed-enumeration-retrieval-using-generics": ["Technology", ".Net"],
};

(async () => {
	const recs = JSON.parse(fs.readFileSync(OUT + "/_all.json"));
	const state = JSON.parse(fs.readFileSync(OUT + "/_state.json"));
	const tr = await api("GET", "/taxonomies/category/terms");
	const terms = tr.j.data?.terms || [];
	const byLabel = new Map(terms.map((t) => [t.label, t]));
	for (const l of [...Object.values(MERGE), ...Object.values(MANUAL).flat()]) if (!byLabel.has(l)) throw new Error("missing target term " + l);

	// 1) reassign posts
	let touched = 0, failed = 0;
	for (const r of recs) {
		const id = state.posts[r.slug];
		if (!id) continue;
		const orig = r.cats.length ? r.cats : MANUAL[r.slug] || [];
		const mapped = [...new Set(orig.map((c) => MERGE[c] || c))];
		const changed = r.cats.length ? mapped.join("|") !== r.cats.join("|") : mapped.length > 0;
		if (!changed) continue;
		touched++;
		if (DRY) { if (touched <= 5) console.log("DRY", r.slug, r.cats.join("|") || "(none)", "->", mapped.join("|")); continue; }
		const termIds = mapped.map((l) => byLabel.get(l)?.id).filter(Boolean);
		const res = await api("POST", `/content/posts/${id}/terms/category`, { termIds });
		if (!res.ok) { failed++; console.log("FAIL terms", r.slug, res.status, JSON.stringify(res.j).slice(0, 120)); }
		await sleep(80);
	}
	console.log({ postsReassigned: touched, failed });

	// 2) delete merged sources and empty terms (only when verified empty), add redirects for merged categories
	const fresh = DRY ? terms : (await api("GET", "/taxonomies/category/terms")).j.data.terms;
	const del = [];
	for (const t of fresh) {
		const merged = MERGE[t.label];
		if (merged || t.count === 0) del.push({ tax: "category", slug: t.slug, label: t.label, count: t.count, to: merged ? byLabel.get(merged).slug : null });
	}
	const tg = (await api("GET", "/taxonomies/tag/terms")).j.data?.terms || [];
	for (const t of tg) if (t.count === 0) del.push({ tax: "tag", slug: t.slug, label: t.label, count: 0, to: null });
	console.log("to delete:", del.map((d) => `${d.tax}:${d.label}(${d.count})${d.to ? "->" + d.to : ""}`).join(", "));
	if (DRY) return;
	for (const d of del) {
		if (d.to) {
			for (const s of ["", "/"]) await api("POST", "/redirects", { source: `/${d.tax}/${d.slug}${s}`, destination: `/${d.tax}/${d.to}`, type: 301 });
		}
		const res = await api("DELETE", `/taxonomies/${d.tax}/terms/${encodeURIComponent(d.slug)}`);
		if (!res.ok) console.log("FAIL delete", d.tax, d.slug, res.status, JSON.stringify(res.j).slice(0, 120));
		await sleep(80);
	}
	const after = (await api("GET", "/taxonomies/category/terms")).j.data.terms;
	const afterTags = (await api("GET", "/taxonomies/tag/terms")).j.data.terms;
	console.log({ categories: after.length, empty: after.filter((t) => t.count === 0).length, tags: afterTags.length, emptyTags: afterTags.filter((t) => t.count === 0).length });
})();
