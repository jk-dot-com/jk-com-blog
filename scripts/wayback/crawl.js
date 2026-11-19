// Crawl blog.jaysonknight.com from its sitemaps: every page, every internal link/asset, every external link.
// usage: node crawl.js [--no-external]   -> writes crawl.json
const fs = require("fs");
const { parseHTML } = require("linkedom");
const ORIGIN = "https://blog.jaysonknight.com";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; JKBlogAudit/1.0)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_EXTERNAL = process.argv.includes("--no-external");

async function pool(items, size, fn) {
	let i = 0;
	await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}

async function get(url, opts = {}) {
	for (let a = 0; a < 3; a++) {
		try {
			const ctl = new AbortController();
			const t = setTimeout(() => ctl.abort(), opts.timeout || 20000);
			const r = await fetch(url, { headers: UA, redirect: "manual", method: opts.method || "GET", signal: ctl.signal });
			const ct = r.headers.get("content-type") || "";
			const text = opts.body === false ? (await r.body?.cancel(), "") : ct.includes("text") || ct.includes("xml") || ct.includes("json") ? await r.text() : (await r.arrayBuffer(), "");
			clearTimeout(t);
			return { status: r.status, location: r.headers.get("location"), ct, text };
		} catch (e) { if (a === 2) return { status: 0, error: String(e.cause?.code || e.message || e).slice(0, 60), text: "" }; await sleep(1000 * (a + 1)); }
	}
}

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

(async () => {
	const result = { pages: {}, internalLinks: {}, external: {}, problems: [] };
	const prob = (type, page, detail) => result.problems.push({ type, page, detail });

	// seeds
	const seeds = new Set([ORIGIN + "/", ORIGIN + "/posts", ORIGIN + "/search", ORIGIN + "/pages/about-me"]);
	for (const s of ["sitemap-posts.xml", "sitemap-pages.xml"]) {
		const r = await get(`${ORIGIN}/${s}`);
		if (r.status !== 200) prob("sitemap-unreachable", s, String(r.status));
		locs(r.text).forEach((u) => seeds.add(u));
	}
	console.log("seeds:", seeds.size);

	const queue = [...seeds];
	const seen = new Set(queue);
	const isPageUrl = (u) => u.origin === ORIGIN && !/^\/(_emdash\/api\/media|cdn-cgi|_astro|fonts)\//.test(u.pathname) && !/\.(png|jpe?g|gif|svg|webp|ico|css|js|xml|txt|woff2?|pdf|zip)$/i.test(u.pathname);
	const assetSet = new Set();
	let done = 0;

	async function visit(url) {
		const r = await get(url);
		done++;
		if (done % 100 === 0) console.log("pages crawled", done, "queue", queue.length);
		const path = url.replace(ORIGIN, "");
		result.pages[path] = { status: r.status };
		if (r.status !== 200) { prob("page-not-200", path, String(r.status) + (r.location ? " -> " + r.location : "")); return; }
		const { document } = parseHTML(r.text);
		const meta = (sel, attr = "content") => document.querySelector(sel)?.getAttribute(attr) || "";
		if (!document.title?.trim()) prob("no-title", path);
		if (!meta('meta[name="description"]')) prob("no-meta-description", path);
		if (!meta('link[rel="canonical"]', "href")) prob("no-canonical", path);
		if (!meta('meta[property="og:title"]')) prob("no-og-title", path);
		if (!document.documentElement.getAttribute("lang")) prob("no-html-lang", path);
		if (!meta('meta[name="viewport"]')) prob("no-viewport", path);
		const h1 = document.querySelectorAll("h1").length;
		if (h1 !== 1) prob("h1-count", path, String(h1));
		if (/<img[^>]+src="http:\/\//i.test(r.text) || /<(script|link)[^>]+(src|href)="http:\/\/(?!web\.archive\.org)[^"]*\.(js|css)/i.test(r.text)) prob("mixed-content", path);
		const noAlt = [...document.querySelectorAll("article img, .article-content img")].filter((i) => !(i.getAttribute("alt") || "").trim()).length;
		if (noAlt) prob("img-missing-alt", path, String(noAlt));

		const refs = [
			...[...document.querySelectorAll("a[href]")].map((e) => ["a", e.getAttribute("href")]),
			...[...document.querySelectorAll("img[src], source[src], script[src], iframe[src]")].map((e) => ["asset", e.getAttribute("src")]),
			...[...document.querySelectorAll('link[href][rel~="stylesheet"], link[href][rel~="icon"], link[rel="alternate"][href]')].map((e) => ["asset", e.getAttribute("href")]),
		];
		for (const [kind, raw] of refs) {
			if (!raw || /^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) continue;
			let u; try { u = new URL(raw, url); } catch { prob("malformed-url", path, raw.slice(0, 80)); continue; }
			u.hash = "";
			if (u.origin === ORIGIN) {
				if (kind === "a" && isPageUrl(u)) {
					const key = u.href;
					(result.internalLinks[u.pathname + u.search] ||= []).push(path);
					if (!seen.has(key)) { seen.add(key); queue.push(key); }
				} else assetSet.add(u.pathname + u.search);
			} else if (/^https?:$/.test(u.protocol)) {
				const key = u.href;
				const e = (result.external[key] ||= { pages: [], kind });
				if (e.pages.length < 6) e.pages.push(path);
				e.count = (e.count || 0) + 1;
			}
		}
	}

	let idx = 0;
	const workers = Array.from({ length: 6 }, async () => {
		while (true) {
			if (idx >= queue.length) { await sleep(300); if (idx >= queue.length) return; continue; }
			await visit(queue[idx++]);
		}
	});
	await Promise.all(workers);
	console.log("pages crawled:", done);

	// internal assets
	const assets = [...assetSet];
	console.log("internal assets:", assets.length);
	await pool(assets, 6, async (p) => {
		const r = await get(ORIGIN + p, { body: false });
		if (r.status !== 200) prob("asset-broken", p, String(r.status) + (r.location ? " -> " + r.location : ""));
	});

	// every internal page link already crawled: report redirects/404s with who links to them
	for (const [p, from] of Object.entries(result.internalLinks)) {
		const rec = result.pages[p];
		if (rec && rec.status !== 200) prob("internal-link-" + rec.status, p, `linked from ${[...new Set(from)].slice(0, 3).join(", ")}`);
	}

	// external links
	const exts = Object.keys(result.external);
	console.log("external links:", exts.length);
	if (!NO_EXTERNAL) {
		let n = 0;
		await pool(exts, 14, async (u) => {
			let r = await get(u, { method: "HEAD", timeout: 12000, body: false });
			if (r.status === 0 || r.status === 405 || r.status === 403 || r.status === 400 || r.status === 501) r = await get(u, { timeout: 15000, body: false });
			// follow up to 5 redirects
			let hops = 0, cur = r, curUrl = u;
			while (cur.status >= 300 && cur.status < 400 && cur.location && hops < 5) { curUrl = new URL(cur.location, curUrl).href; cur = await get(curUrl, { timeout: 12000, body: false }); hops++; }
			result.external[u].status = cur.status;
			result.external[u].error = cur.error;
			result.external[u].final = hops ? curUrl : undefined;
			if (++n % 200 === 0) console.log("external checked", n);
		});
	}
	fs.writeFileSync(require("./paths").DATA + "/crawl.json", JSON.stringify(result));
	const byType = {};
	for (const p of result.problems) byType[p.type] = (byType[p.type] || 0) + 1;
	console.log("PROBLEMS BY TYPE", byType);
	const st = {};
	for (const e of Object.values(result.external)) { const k = e.status || e.error || "?"; st[k] = (st[k] || 0) + 1; }
	console.log("EXTERNAL BY STATUS", st);
})();
