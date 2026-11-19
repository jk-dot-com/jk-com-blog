// For each dropped image, look for ANY archived 200 capture in the Wayback CDX index. Writes recoverable.json.
const fs = require("fs");
const T = require("./paths").DATA;
const state = JSON.parse(fs.readFileSync(T + "/out2/_state.json"));
const recs = JSON.parse(fs.readFileSync(T + "/out2/_all.json"));
const tsBySlug = new Map(recs.map((r) => [r.slug, r.ts]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostsFor = (src) => {
	try {
		const u = new URL(src, "http://jaysonknight.com/");
		return { u, hosts: u.host.startsWith("blog.") || /zerotrilogy/.test(u.host) ? [u.host.replace(/:\d+$/, "")] : ["jaysonknight.com", "www.jaysonknight.com", "zerotrilogy.gotdns.com"] };
	} catch { return null; }
};
(async () => {
	const out = [], none = [];
	const seen = new Set();
	for (const m of state.missingImages) {
		if (seen.has(m.src)) continue; seen.add(m.src);
		const info = hostsFor(m.src);
		if (!info) { none.push(m); continue; }
		let found = null;
		for (const host of info.hosts) {
			const target = `${host}${decodeURIComponent(info.u.pathname)}${info.u.search}`;
			for (const mode of ["exact", "prefix"]) {
				try {
					const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&matchType=${mode}&output=json&fl=timestamp,original,mimetype,statuscode&filter=statuscode:200&limit=5`;
					const r = await fetch(url);
					const j = await r.json().catch(() => []);
					const row = j.slice(1).find((x) => /^image\//.test(x[2]));
					if (row) { found = { src: m.src, slug: m.slug, ts: row[0], original: row[1], mime: row[2] }; break; }
				} catch {}
				await sleep(400);
			}
			if (found) break;
		}
		found ? out.push(found) : none.push(m);
	}
	fs.writeFileSync(T + "/recoverable.json", JSON.stringify(out, null, 1));
	console.log("recoverable", out.length, "| still missing", none.length);
	out.forEach((o) => console.log("  OK ", o.slug.slice(0, 36).padEnd(38), o.original.slice(0, 80)));
	none.forEach((o) => console.log("  NO ", o.slug.slice(0, 36).padEnd(38), o.src.slice(0, 80)));
})();
