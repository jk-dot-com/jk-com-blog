// Build link-map.json: for every dead external link in the imported posts, the Wayback snapshot closest to the
// post's date, or "" when nothing was archived (the link is then dropped and its text kept).
// usage: node fix-links.js   (reads crawl.json and out2/_all.json)
const fs = require("fs");
const T = require("./paths").DATA;
const crawl = JSON.parse(fs.readFileSync(T + "/crawl.json"));
const recs = JSON.parse(fs.readFileSync(T + "/out2/_all.json"));
const MAP_FILE = T + "/link-map.json";
const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE)) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { "User-Agent": "Mozilla/5.0 (compatible; JKBlogAudit/1.0)" };

// "http://https//host/x" came from markup that lost a colon: the real address is "https://host/x"
const MALFORMED = /^https?:\/\/(https?):?\/\/?/i;
const normalize = (h) => h.replace(MALFORMED, "$1://");
// the crawl sees "http://host" as "http://host/" and drops "#fragments"; keep the map in that form
const canon = (href) => { try { const u = new URL(href); u.hash = ""; return u.href; } catch { return href; } };
const WAYBACK_WRAP = /^https:\/\/web\.archive\.org\/web\/2\//;

async function pool(items, size, fn) {
	let i = 0;
	await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) await fn(items[i++]); }));
}
async function live(url) {
	for (const method of ["HEAD", "GET"]) {
		try {
			const ctl = new AbortController();
			const t = setTimeout(() => ctl.abort(), 15000);
			let r = await fetch(url, { method, headers: UA, redirect: "follow", signal: ctl.signal });
			clearTimeout(t);
			await r.body?.cancel();
			if (r.status < 400) return true;
			if (r.status === 404 || r.status === 410) { if (method === "GET") return false; continue; }
			return true; // 403/5xx etc: blocked or flaky, not provably dead
		} catch (e) { if (method === "GET") return /ENOTFOUND|CERT|ALTNAME|HAS_EXPIRED/.test(String(e.cause?.code || e.message)) ? false : true; }
	}
	return true;
}
async function wayback(url, date) {
	const ts = date.replace(/\D/g, "").slice(0, 8);
	for (let a = 0; a < 4; a++) {
		try {
			const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${ts}`, { headers: UA });
			if (r.status === 429) { await sleep(5000 * (a + 1)); continue; }
			const j = await r.json();
			const s = j.archived_snapshots?.closest;
			if (s?.available && /^[23]/.test(String(s.status))) return s.url.replace(/^http:/, "https:");
			return null;
		} catch { await sleep(2000 * (a + 1)); }
	}
	return undefined; // lookup failed; leave undecided
}

(async () => {
	// every link in the source posts, with the earliest post date that uses it
	const firstDate = new Map();
	for (const r of recs) for (const b of r.data.content) for (const d of b.markDefs || []) if (d._type === "link" && /^https?:/i.test(d.href)) {
		const key = canon(d.href);
		const prev = firstDate.get(key);
		if (!prev || r.date < prev) firstDate.set(key, r.date);
	}
	const crawlDead = (u) => { const e = crawl.external[u]; return e && (e.status === 404 || e.status === 410 || /ENOTFOUND|CERT|ALTNAME/.test(e.error || "")); };
	const uncertain = (u) => { const e = crawl.external[u]; return e && /EAI_AGAIN|ETIMEDOUT|CONNECT_TIMEOUT|aborted/.test(e.error || ""); };

	const candidates = [];
	for (const [href, date] of firstDate) {
		if (map[href] !== undefined) continue;
		if (/^https?:\/\/(www\.)?jaysonknight\.com\/?$/i.test(href)) { map[href] = "https://jaysonknight.com/"; continue; }
		if (/^https?:\/\/(?:www\.)?(?:blog\.)?jaysonknight\.com(?::\d+)?\/(?:blog|jayson)\//i.test(href)) continue; // old posts: handled by the redirect table in fix-content
		const norm = normalize(href);
		const e = crawl.external[href] || crawl.external[norm];
		if (!e) continue; // not seen in the crawl: nothing says it is dead
		if (norm !== href) candidates.push({ href, norm, date, check: true });
		else if (crawlDead(href)) candidates.push({ href, norm, date });
		else if (uncertain(href)) candidates.push({ href, norm, date, check: true });
	}
	// links wrapped to the Wayback Machine earlier that turned out not to be archived
	for (const [u, e] of Object.entries(crawl.external)) if (WAYBACK_WRAP.test(u) && (e.status === 404 || e.status === 410)) {
		const orig = u.replace(WAYBACK_WRAP, "");
		const date = [...firstDate].find(([h]) => h === orig)?.[1] || "2006-01-01";
		if (map[orig] === undefined) candidates.push({ href: orig, norm: orig, date });
	}
	console.log("candidates:", candidates.length);

	let n = 0;
	await pool(candidates, 4, async (c) => {
		if (c.check && (await live(c.norm))) { if (c.norm !== c.href) map[c.href] = c.norm; return; } // alive after fixing the typo
		const snap = await wayback(c.norm, c.date);
		if (snap === undefined) return;
		map[c.href] = snap || "";
		if (++n % 50 === 0) { fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1)); console.log("looked up", n); await sleep(300); }
	});
	fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
	const vals = Object.values(map);
	console.log({ entries: vals.length, archived: vals.filter((v) => v.includes("web.archive.org")).length, dropped: vals.filter((v) => v === "").length, fixedInPlace: vals.filter((v) => v && !v.includes("web.archive.org")).length });
})();
