// Audit every imported post as rendered on the live blog.
const fs = require("fs");
const { parseHTML } = require("linkedom");
const T = require("./paths").DATA;
const state = JSON.parse(fs.readFileSync(T + "/out2/_state.json"));
const recs = JSON.parse(fs.readFileSync(T + "/out2/_all.json"));
const titleBySlug = new Map(recs.map((r) => [r.slug, r.title]));
const slugs = Object.keys(state.posts);
const issues = {};
const add = (k, slug, detail) => ((issues[k] ||= []).push(detail ? `${slug}: ${detail}` : slug));
const imgStatus = new Map();
let done = 0;

const MOJIBAKE = new RegExp("Ã[\\u0080-\\u00bf]|â€|\\ufffd|Â[\\u00a0-\\u00bf]");
const ENTITY = /&(nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;
const LEFTOVER_TAG = /<\/?(font|span|div|p|br|b|i|u|a|table|td|tr|img|strong|em|ul|li)\b[^>]*>/i;
const CODEISH = /[;{}]\s*$|^\s*(\/\/|using |namespace |public |private |class |void |return |if \(|foreach \()/;

async function fetchText(url) {
	for (let a = 0; a < 3; a++) {
		try { const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }); return { status: r.status, text: await r.text() }; } catch {}
		await new Promise((s) => setTimeout(s, 1500));
	}
	return { status: 0, text: "" };
}

async function audit(slug) {
	const { status, text } = await fetchText(`https://blog.jaysonknight.com/posts/${slug}`);
	if (status !== 200) return add("http-not-200", slug, String(status));
	const { document } = parseHTML(text);
	const article = document.querySelector(".article-content") || document.querySelector("article");
	if (!article) return add("no-article-element", slug);
	const h1s = document.querySelectorAll("h1");
	if (h1s.length !== 1) add("h1-count-not-1", slug, String(h1s.length));
	const title = (h1s[0]?.textContent || "").trim();
	const want = titleBySlug.get(slug) || "";
	if (title !== want.trim()) add("h1-differs-from-title", slug, JSON.stringify(title.slice(0, 60)) + " vs " + JSON.stringify(want.slice(0, 60)));
	if (MOJIBAKE.test(title)) add("mojibake-title", slug, title.slice(0, 60));
	const clone = article.cloneNode(true);
	clone.querySelectorAll("pre, code, script, style").forEach((e) => e.remove());
	const body = clone.textContent || "";
	if (body.trim().length < 20) add("empty-body", slug, String(body.trim().length));
	if (MOJIBAKE.test(body)) add("mojibake-body", slug, (body.match(MOJIBAKE) || [""])[0] + " near " + JSON.stringify(body.slice(Math.max(0, body.search(MOJIBAKE) - 30), body.search(MOJIBAKE) + 30)));
	if (ENTITY.test(body)) add("literal-entity", slug, JSON.stringify((body.match(new RegExp(".{0,25}" + ENTITY.source + ".{0,25}", "i")) || [""])[0]));
	if (LEFTOVER_TAG.test(body)) add("leftover-markup-in-text", slug, JSON.stringify((body.match(new RegExp(".{0,25}" + LEFTOVER_TAG.source + ".{0,25}", "i")) || [""])[0]));
	if (article.querySelector("font, [style], [face], [color], [size], [align], o\\:p")) add("legacy-markup", slug, [...article.querySelectorAll("font,[style],[align]")].slice(0, 1).map((e) => e.outerHTML.slice(0, 80)).join(""));
	// code blocks
	const pres = [...article.querySelectorAll("pre")];
	for (const p of pres) {
		const t = p.textContent || "";
		const lines = t.split("\n");
		if (lines.filter((l) => /^\s*\d+:(\s|$)/.test(l)).length / Math.max(1, lines.length) > 0.4) add("code-line-numbers", slug);
		if (t.trim().length === 0) add("empty-code-block", slug);
		if (/&lt;|&gt;|&amp;/.test(t)) add("code-double-escaped", slug, JSON.stringify(t.slice(0, 50)));
	}
	// runs of code-looking paragraphs outside pre
	const paras = [...article.querySelectorAll(":scope > p, .article-content > p")].map((p) => (p.textContent || "").trim());
	let run = 0, maxRun = 0;
	for (const p of paras) { if (p && p.length < 200 && CODEISH.test(p)) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
	if (maxRun >= 3) add("unformatted-code-run", slug, String(maxRun));
	const longP = paras.filter((p) => p.length > 2500).length;
	if (longP) add("very-long-paragraph", slug, `${longP} over 2500 chars`);
	// images
	for (const img of article.querySelectorAll("img")) {
		const src = img.getAttribute("src") || "";
		if (!src) add("img-no-src", slug);
		else if (!/^(\/|https?:)/.test(src) && !src.startsWith("data:")) add("img-odd-src", slug, src.slice(0, 60));
		else if (src.startsWith("/")) imgStatus.set(src, null);
		else if (/web\.archive\.org|blog\.jaysonknight\.com\/(resized-image|cfs-file|jayson)|jaysonknight\.com\/(etc|misc)|\.aspx/.test(src)) add("img-points-to-dead-old-host", slug, src.slice(0, 80));
	}
	// links
	for (const a of article.querySelectorAll("a[href]")) {
		const href = a.getAttribute("href") || "";
		if (/^javascript:/i.test(href)) add("js-link", slug, href.slice(0, 40));
		if (/^https?:\/\/(www\.)?(blog\.)?jaysonknight\.com\/(blog|jayson)\/(archive|default|rss)|zerotrilogy\.gotdns\.com/i.test(href)) add("old-internal-link", slug, href.slice(0, 90));
		if (/^\s*$/.test(a.textContent || "") && !a.querySelector("img")) add("empty-link-text", slug, href.slice(0, 60));
	}
	// meta
	if (!document.querySelector('link[rel="canonical"]')) add("no-canonical", slug);
	if (!document.querySelector('meta[name="description"]')) add("no-meta-description", slug);
	if (!document.querySelector('meta[property="og:title"]')) add("no-og-title", slug);
	if (!document.querySelector('script[type="application/ld+json"]')) add("no-jsonld", slug);
}

(async () => {
	let i = 0;
	await Promise.all(Array.from({ length: 8 }, async () => { while (i < slugs.length) { const s = slugs[i++]; await audit(s); if (++done % 100 === 0) console.log("audited", done); } }));
	// local images actually load
	const srcs = [...imgStatus.keys()]; let j = 0; const bad = [];
	await Promise.all(Array.from({ length: 8 }, async () => { while (j < srcs.length) { const s = srcs[j++]; try { const r = await fetch("https://blog.jaysonknight.com" + s, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } }); if (!r.ok) bad.push(`${s} -> ${r.status}`); } catch { bad.push(s + " -> error"); } } }));
	if (bad.length) issues["image-404"] = bad;
	fs.writeFileSync(T + "/audit.json", JSON.stringify(issues, null, 1));
	console.log("posts audited:", done, "| local images checked:", srcs.length);
	const rows = Object.entries(issues).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
	console.log(rows.length ? rows.map(([k, n]) => `${String(n).padStart(4)}  ${k}`).join("\n") : "NO ISSUES");
})();
