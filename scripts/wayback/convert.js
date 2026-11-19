const { parseHTML } = require("linkedom");
const fs = require("fs");
const T = require("./paths").DATA;
const posts = JSON.parse(fs.readFileSync(T + "/posts.json"));
fs.mkdirSync(T + "/out", { recursive: true });

let k = 0;
const key = () => "k" + (k++).toString(36);
const decodeCS = (s) =>
	s.replace(/_((?:[0-9A-F]{2}00)+)_/g, (_, h) => h.match(/.{4}/g).map((c) => String.fromCharCode(parseInt(c.slice(0, 2), 16))).join(""));
const slugify = (s) =>
	s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "");
const clean = (t) => t.replace(/ /g, " ").replace(/[ \t\r\n]+/g, " ");

function convert(root, imgs) {
	const blocks = [];
	let cur = null;
	const newBlock = (style = "normal", extra = {}) => ({ _type: "block", _key: key(), style, children: [], markDefs: [], ...extra });
	const flush = () => {
		if (cur) {
			const kids = cur.children;
			if (kids.length) {
				kids[0].text = kids[0].text.replace(/^\s+/, "");
				kids[kids.length - 1].text = kids[kids.length - 1].text.replace(/\s+$/, "");
			}
			if (kids.some((c) => c.text.trim())) blocks.push(cur);
		}
		cur = null;
	};
	const ensure = (style, extra) => (cur ||= newBlock(style, extra));
	const addText = (text, marks) => {
		if (!text) return;
		const b = ensure("normal");
		const last = b.children[b.children.length - 1];
		if (last && last.marks.join() === marks.join()) last.text += text;
		else b.children.push({ _type: "span", _key: key(), text, marks: [...marks] });
	};
	function walk(node, marks, ctx) {
		if (node.nodeType === 3) {
			let t = clean(node.nodeValue);
			if (!cur && !t.trim()) return;
			addText(t, marks);
			return;
		}
		if (node.nodeType !== 1) return;
		const tag = node.tagName.toLowerCase();
		const kids = () => [...node.childNodes].forEach((c) => walk(c, marks, ctx));
		switch (tag) {
			case "script": case "style": case "form": return;
			case "br": if (ctx.level > 0) { if (cur) addText(" ", marks); } else flush(); return;
			case "hr": flush(); return;
			case "b": case "strong": return void [...node.childNodes].forEach((c) => walk(c, [...new Set([...marks, "strong"])], ctx));
			case "i": case "em": return void [...node.childNodes].forEach((c) => walk(c, [...new Set([...marks, "em"])], ctx));
			case "u": return void [...node.childNodes].forEach((c) => walk(c, [...new Set([...marks, "underline"])], ctx));
			case "code": case "tt": return void [...node.childNodes].forEach((c) => walk(c, [...new Set([...marks, "code"])], ctx));
			case "a": {
				const href = node.getAttribute("href");
				if (!href || href.startsWith("javascript:")) return kids();
				const b = ensure("normal");
				const id = key();
				b.markDefs.push({ _type: "link", _key: id, href });
				[...node.childNodes].forEach((c) => walk(c, [...marks, id], ctx));
				return;
			}
			case "img": {
				flush();
				const src = node.getAttribute("src");
				if (src) {
					imgs.push(src);
					blocks.push({ _type: "image", _key: key(), _pendingSrc: src, alt: node.getAttribute("alt") || "" });
				}
				return;
			}
			case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
				flush();
				cur = newBlock(tag === "h1" || tag === "h2" ? "h2" : tag === "h3" ? "h3" : "h4");
				kids(); flush(); return;
			}
			case "p": case "div": case "center": case "span": case "font": case "small": case "big": case "section": case "article": {
				const isBlock = ["p", "div", "center", "section", "article"].includes(tag);
				if (isBlock) flush();
				kids();
				if (isBlock) flush();
				return;
			}
			case "blockquote": {
				flush();
				const before = blocks.length;
				kids(); flush();
				for (let i = before; i < blocks.length; i++) if (blocks[i]._type === "block") blocks[i].style = "blockquote";
				return;
			}
			case "pre": {
				flush();
				const clone = node.cloneNode(true);
				clone.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
				const code = clone.textContent.replace(/ /g, " ").replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
				if (code.trim()) {
					const cls = (node.getAttribute("class") || "").toLowerCase();
					const blk = { _type: "code", _key: key(), code };
					if (/csharp|c#/.test(cls)) blk.language = "csharp";
					blocks.push(blk);
				}
				return;
			}
			case "ul": case "ol": {
				flush();
				const type = tag === "ul" ? "bullet" : "number";
				[...node.children].forEach((li) => {
					if (li.tagName.toLowerCase() !== "li") return;
					flush();
					cur = newBlock("normal", { listItem: type, level: ctx.level + 1 });
					// inline content of li; nested lists handled recursively
					[...li.childNodes].forEach((c) => {
						const t = c.nodeType === 1 ? c.tagName.toLowerCase() : "";
						if (t === "ul" || t === "ol") { flush(); walk(c, marks, { level: ctx.level + 1 }); }
						else walk(c, marks, { level: ctx.level + 1 });
					});
					flush();
				});
				return;
			}
			case "table": case "tbody": case "tr": case "td": case "th": case "thead": return kids();
			default: return kids();
		}
	}
	[...root.childNodes].forEach((c) => walk(c, [], { level: 0 }));
	flush();
	// merge adjacent code blocks (the old code formatter emitted one <pre> per line) and strip "  12:" line numbers
	const merged = [];
	for (const b of blocks) {
		const prev = merged[merged.length - 1];
		if (b._type === "code" && prev && prev._type === "code") prev.code += "\n" + b.code;
		else merged.push(b);
	}
	for (const b of merged) {
		if (b._type !== "code") continue;
		const lines = b.code.split("\n");
		const numbered = lines.filter((l) => /^\s*\d+:(\s|$)/.test(l)).length;
		if (numbered / lines.length > 0.6) b.code = lines.map((l) => l.replace(/^\s*\d+:\s?/, "")).join("\n");
	}
	return merged;
}

if (require.main !== module) { module.exports = { convert, slugify, decodeCS, clean }; return; }
const index = [];
const skipped = [];
for (const [ts, url] of posts) {
	const f = T + "/wb/" + url.replace(/[^a-z0-9]/gi, "_").slice(-120) + ".html";
	const html = fs.readFileSync(f, "utf8");
	const m = html.match(/<h1 class="entryviewheading">([\s\S]*?)<\/h1>([\s\S]*?)<div class="entrylistfooter">([\s\S]*?)<\/div>\s*<\/div>/);
	const [, y, mo, d, rawSlug] = url.match(/archive\/(\d{4})\/(\d\d)\/(\d\d)\/([^/]+?)\.aspx/);
	if (!m || /temporary post used for theme/i.test(html)) { skipped.push(url); continue; }
	const { document } = parseHTML("<div id=t>" + m[1] + "</div><div id=b>" + m[2] + "</div><div id=f>" + m[3] + "</div>");
	const title = clean(document.getElementById("t").textContent).trim();
	const imgs = [];
	const content = convert(document.getElementById("b"), imgs);
	const tags = [...document.getElementById("f").querySelectorAll('a[rel="tag"]')].map((a) => a.textContent.trim());
	const plain = content.filter((b) => b._type === "block" && !b.listItem).map((b) => b.children.map((c) => c.text).join("")).join(" ");
	const excerpt = plain.length > 220 ? plain.slice(0, 217).replace(/\s+\S*$/, "") + "…" : plain;
	const slug = slugify(decodeCS(rawSlug));
	const rec = { slug, title, date: `${y}-${mo}-${d}`, ts, oldPath: new URL(url).pathname, tags, imgs, data: { title, content, excerpt } };
	fs.writeFileSync(T + `/out/${y}-${mo}-${d}-${slug}.json`, JSON.stringify(rec));
	index.push({ slug, title, date: rec.date, blocks: content.length, code: content.filter((b) => b._type === "code").length, imgs: imgs.length, tags: tags.join("|"), chars: plain.length });
}
fs.writeFileSync(T + "/index.json", JSON.stringify(index, null, 1));
console.log("converted", index.length, "skipped", skipped.length);
const slugs = {}; index.forEach((i) => (slugs[i.slug] = (slugs[i.slug] || 0) + 1));
console.log("dup slugs:", Object.entries(slugs).filter(([, n]) => n > 1));
console.table(index.map((i) => ({ d: i.date, slug: i.slug.slice(0, 45), blk: i.blocks, code: i.code, img: i.imgs, ch: i.chars })));
