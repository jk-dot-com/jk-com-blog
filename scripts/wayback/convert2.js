// Unified extractor for every Community Server / .Text skin seen in the archive.
const { parseHTML } = require("linkedom");
const fs = require("fs");
const { convert, slugify, decodeCS, clean } = require("./convert.js");
const T = require("./paths").DATA;
const OUT = T + "/out2";
fs.mkdirSync(OUT, { recursive: true });

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function parseDate(txt) {
	const s2 = txt.match(/[A-Za-z]{3}, ([A-Za-z]{3}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d\d) ([AP]M)/);
	if (s2) {
		const mo = MONTHS.findIndex((x) => x.startsWith(s2[1].toLowerCase()));
		if (mo >= 0) return `${s2[3]}-${String(mo + 1).padStart(2, "0")}-${String(+s2[2]).padStart(2, "0")}T${String(+s2[4] % 12 + (s2[6] === "PM" ? 12 : 0)).padStart(2, "0")}:${s2[5]}:00`;
	}
	// "Tuesday, February 15, 2005 12:32 AM" or "February 02 2004"
	const m = txt.match(/([A-Za-z]+) (\d{1,2}),? (\d{4})(?:\s+(\d{1,2}):(\d\d)\s*([AP]M))?/);
	if (!m) return null;
	const mo = MONTHS.indexOf(m[1].toLowerCase());
	if (mo < 0) return null;
	let h = m[4] ? +m[4] % 12 + (m[6] === "PM" ? 12 : 0) : 12;
	const iso = `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[5] || "00"}:00`;
	return iso;
}

function extract(html, url) {
	const { document } = parseHTML(html);
	document.querySelectorAll("script,style,noscript").forEach((e) => e.remove());
	let root, title, bodyEl, footEl;
	if ((root = document.querySelector(".BlogPostArea"))) {
		title = root.querySelector(".BlogPostHeader")?.textContent;
		bodyEl = root.querySelector(".BlogPostContent");
		footEl = root.querySelector(".BlogPostFooter");
		bodyEl?.querySelectorAll(".shareblock").forEach((e) => e.remove());
	} else if ((root = document.querySelector(".entryview"))) {
		title = root.querySelector(".entryviewheading")?.textContent;
		footEl = root.querySelector(".entryviewfooter, .entrylistfooter");
		const dateEl = root.querySelector(".entryviewdate");
		bodyEl = root.cloneNode(true);
		bodyEl.querySelectorAll(".entryviewheading,.entryviewfooter,.entrylistfooter,.entryviewdate").forEach((e) => e.remove());
		root = { ...root, dateText: dateEl?.textContent };
		root.querySelector = (s) => document.querySelector(s);
	} else if ((root = document.querySelector("div.post"))) {
		const head = root.querySelector(".postsub, .posthead");
		title = root.querySelector(".postTitle, .posthead h2")?.textContent;
		footEl = head;
		bodyEl = root.querySelector(".bodyPost");
		if (!bodyEl) {
			bodyEl = root.cloneNode(true);
			bodyEl.querySelectorAll(".posthead,.postsub,.postTitle,.postfoot,.posteds,.commentPostSub").forEach((e) => e.remove());
		}
	}
	if ((!bodyEl || !title) && (root = document.querySelector("#CommonContentInner .CommonContentBoxContent"))) {
		title = (document.querySelector("title")?.textContent || "").replace(/\s+/g, " ").replace(/ - Jayson.s Blog - jaysonKnight\.com\s*$/i, "").replace(/ - [^-]*$/, (m) => (/jayson/i.test(m) ? "" : m)).trim();
		footEl = root;
		bodyEl = root.cloneNode(true);
		let hit = false;
		for (const n of [...bodyEl.childNodes]) { if (n.nodeType === 1 && n.tagName.toLowerCase() === "hr") hit = true; if (hit) n.remove(); }
	}
	if (!bodyEl || !title) return null;
	const postText = (root.textContent || "") + " " + (footEl?.textContent || "");
	let date = parseDate((footEl?.textContent || "").replace(/\s+/g, " ")) || parseDate((root.dateText || "").replace(/\s+/g, " "));
	const um = url.match(/archive\/(\d{4})\/(\d\d)\/(\d\d)\//);
	if (!date && um && um[1] !== "0001") date = `${um[1]}-${um[2]}-${um[3]}T12:00:00`;
	const cats = [...(footEl ? footEl.querySelectorAll("a") : [])].filter((a) => /category\/\d+|archive\/tags\//.test(a.getAttribute("href") || "")).map((a) => a.textContent.trim()).filter(Boolean);
	return { title: clean(title).trim(), bodyEl, date, cats: [...new Set(cats)] };
}

const sources = [];
for (const f of fs.readdirSync(T + "/wb3").filter((x) => x.endsWith(".html"))) {
	const meta = JSON.parse(fs.readFileSync(T + "/wb3/" + f + ".meta"));
	sources.push({ file: T + "/wb3/" + f, ...meta });
}
// the blog.jaysonknight.com captures from the first pass
for (const [ts, url] of JSON.parse(fs.readFileSync(T + "/posts.json"))) {
	sources.push({ file: T + "/wb/" + url.replace(/[^a-z0-9]/gi, "_").slice(-120) + ".html", ts, url });
}

const byKey = new Map();
const failed = [];
for (const s of sources) {
	if (!fs.existsSync(s.file)) continue;
	const html = fs.readFileSync(s.file, "utf8");
	if (/temporary post used for theme detection/i.test(html)) continue;
	let x;
	try { x = extract(html, s.url); } catch (e) { failed.push([s.url, String(e)]); continue; }
	if (!x || !x.date) { failed.push([s.url, "no title/body/date"]); continue; }
	const imgs = [];
	const content = convert(x.bodyEl, imgs).filter((b) => !(b._type === "block" && /^\s*Share this post\s*:/i.test(b.children.map((c) => c.text).join(""))));
	const text = content.filter((b) => b._type === "block").map((b) => b.children.map((c) => c.text).join("")).join(" ").trim();
	if (!text && !content.length) { failed.push([s.url, "empty body"]); continue; }
	const key = x.title.toLowerCase().replace(/\W+/g, "") + "|" + x.date.slice(0, 10);
	const prev = byKey.get(key);
	// prefer the later capture / longer body
	if (prev && prev.textLen >= text.length) continue;
	const excerpt = text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, "") + "…" : text;
	byKey.set(key, { title: x.title, date: x.date, cats: x.cats, imgs, ts: s.ts, url: s.url, textLen: text.length, data: { title: x.title, content, excerpt } });
}
// unique slugs
const used = new Map();
const recs = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
for (const r of recs) {
	let base = slugify(r.title) || "post";
	let slug = base, n = 2;
	while (used.has(slug)) slug = `${base.slice(0, 76)}-${n++}`;
	used.set(slug, 1);
	r.slug = slug;
	r.oldPaths = [];
}
// every source URL that resolved to a post becomes an old path for redirects
for (const s of sources) {
	const m = s.url.match(/jaysonknight\.com(?::\d+)?(\/(?:blog|jayson)\/archive\/[^?#]+\.aspx)/i);
	if (!m || !fs.existsSync(s.file)) continue;
	const html = fs.readFileSync(s.file, "utf8");
	let x; try { x = extract(html, s.url); } catch { continue; }
	if (!x?.date) continue;
	const r = byKey.get(x.title.toLowerCase().replace(/\W+/g, "") + "|" + x.date.slice(0, 10));
	if (!r) continue;
	r.oldPaths.push(m[1]);
	// id-style permalink (".../2005/02/15/1013.aspx") hidden in the page's share links
	const id = m[1].match(/\/(\d+)\.aspx$/)?.[1];
	if (id) for (const mm of html.matchAll(new RegExp(`/blog/archive/(\\d{4})/(\\d\\d)/(\\d\\d)/${id}\\.aspx`, "g"))) if (mm[1] !== "0001") r.oldPaths.push(mm[0]);
}
for (const r of recs) r.oldPaths = [...new Set(r.oldPaths)];
fs.writeFileSync(OUT + "/_all.json", JSON.stringify(recs));
fs.writeFileSync(OUT + "/_failed.json", JSON.stringify(failed, null, 1));
const cat = {};
recs.forEach((r) => r.cats.forEach((c) => (cat[c] = (cat[c] || 0) + 1)));
const yrs = {};
recs.forEach((r) => (yrs[r.date.slice(0, 4)] = (yrs[r.date.slice(0, 4)] || 0) + 1));
console.log("sources", sources.length, "posts", recs.length, "failed", failed.length);
console.log("by year", yrs);
console.log("categories", cat);
console.log("with images", recs.filter((r) => r.imgs.length).length, "images", recs.reduce((a, r) => a + r.imgs.length, 0), "no-cats", recs.filter((r) => !r.cats.length).length);
console.log("failed sample", failed.slice(0, 8));
