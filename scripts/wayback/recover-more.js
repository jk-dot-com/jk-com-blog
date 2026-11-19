// Second, wider hunt for the images the first pass could not find: other hosts, other letter case, other CS URL
// shapes (cfs-file.ashx vs resized-image.ashx), and the live web. Writes recoverable2.json in recoverable.json's format.
const fs = require("fs");
const T = require("./paths").DATA;
const state = JSON.parse(fs.readFileSync(T + "/out2/_state.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0 (compatible; JKBlogAudit/1.0)" };

const OUR_HOSTS = ["jaysonknight.com", "www.jaysonknight.com", "blog.jaysonknight.com", "zerotrilogy.gotdns.com"];
const MAGIC = [[/^\xff\xd8\xff/, "image/jpeg"], [/^\x89PNG/, "image/png"], [/^GIF8/, "image/gif"], [/^RIFF.{4}WEBP/s, "image/webp"]];
const sniff = (buf) => { const s = buf.subarray(0, 12).toString("latin1"); return MAGIC.find(([re]) => re.test(s))?.[1]; };

async function cdx(params) {
	for (let a = 0; a < 3; a++) {
		try {
			const r = await fetch("https://web.archive.org/cdx/search/cdx?" + new URLSearchParams({ output: "json", fl: "timestamp,original,mimetype", filter: "statuscode:200", ...params }), { headers: UA });
			if (r.status === 429) { await sleep(6000); continue; }
			if (!r.ok) return [];
			const rows = await r.json();
			return rows.slice(1);
		} catch { await sleep(2000); }
	}
	return [];
}
async function fetchImage(ts, original) {
	for (const url of [`https://web.archive.org/web/${ts}im_/${original}`]) {
		try {
			const r = await fetch(url, { headers: UA });
			if (!r.ok) continue;
			const buf = Buffer.from(await r.arrayBuffer());
			const mime = sniff(buf);
			if (mime && buf.length > 200) return { buf, mime };
		} catch {}
	}
	return null;
}
const candidatesFor = (abs) => {
	const u = new URL(abs);
	const out = new Set([abs]);
	const hosts = OUR_HOSTS.includes(u.hostname) ? OUR_HOSTS : [u.hostname, u.hostname.replace(/^www\./, ""), "www." + u.hostname.replace(/^www\./, "")];
	const paths = new Set([u.pathname, u.pathname.toLowerCase(), u.pathname.replace(/\/misc\//i, "/Misc/"), u.pathname.replace(/\/misc\//i, "/misc/")]);
	for (const h of hosts) for (const p of paths) for (const proto of ["http", "https"]) out.add(`${proto}://${h}${p}${u.search}`);
	return [...out];
};

(async () => {
	const missing = [...new Set(state.missingImages.map((m) => m.src))];
	const slugBySrc = new Map(state.missingImages.map((m) => [m.src, m.slug]));
	const wanted = Object.entries(state.media).filter(([k, v]) => !v).map(([k]) => k);
	// absolute form of every missing source, with the posts that use it
	const targets = new Map();
	for (const m of state.missingImages) targets.set(new URL(m.src, "http://jaysonknight.com/").href, m.slug);
	for (const k of wanted) if (!targets.has(k)) targets.set(k, null);
	console.log("targets:", targets.size);

	const found = [];
	const notFound = [];
	for (const [abs, slug] of targets) {
		let hit = null;
		for (const cand of candidatesFor(abs)) {
			const rows = await cdx({ url: cand, limit: "3" });
			if (rows.length) { hit = rows[rows.length - 1]; break; }
			await sleep(250);
		}
		// Community Server file URLs: the same upload under any size or shape, matched on its id.guid file name
		if (!hit) {
			const file = decodeURIComponent(abs).match(/(\d+\.[0-9A-F]{8}[^/?]*\.(?:png|jpe?g|gif))/i)?.[1] || decodeURIComponent(abs).match(/(\d+\.clip[^/?]*\.(?:png|jpe?g|gif))/i)?.[1];
			if (file) {
				const stem = file.replace(/\.[a-z]+$/i, "").replace(/[()]/g, ".");
				const rows = await cdx({ url: "blog.jaysonknight.com/*", filter: ["statuscode:200", "original:.*" + stem.replace(/[.+?^${}()|[\]\\]/g, "\\$&") + ".*"].join("&filter="), limit: "5" }).catch(() => []);
				if (rows.length) hit = rows[rows.length - 1];
			}
		}
		const img = hit && (await fetchImage(hit[0], hit[1]));
		if (img) { found.push({ src: abs, slug, ts: hit[0], original: hit[1], mime: img.mime }); console.log("FOUND", abs, "->", hit[1], img.buf.length); continue; }
		// the live web, for third-party images that may still be up
		if (!OUR_HOSTS.includes(new URL(abs).hostname)) {
			try {
				const r = await fetch(abs, { headers: UA });
				const buf = Buffer.from(await r.arrayBuffer());
				if (r.ok && sniff(buf) && buf.length > 200) { found.push({ src: abs, slug, live: true, original: abs, mime: sniff(buf) }); console.log("LIVE", abs, buf.length); continue; }
			} catch {}
		}
		notFound.push(abs);
		console.log("none", abs);
	}
	fs.writeFileSync(T + "/recoverable2.json", JSON.stringify(found, null, 1));
	console.log("found", found.length, "of", targets.size);
})();
