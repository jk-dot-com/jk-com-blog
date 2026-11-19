// Append redirects for the old blog-host listing pages (/jayson/archive/YYYY/MM.aspx, /jayson/archive/tags/*, /jayson/*.aspx).
const fs = require("fs");
const T = require("./paths").DATA;
const OUT = require("./paths").REDIRECTS;
const rows = JSON.parse(fs.readFileSync(T + "/cdx.json")).slice(1);
const existing = new Set(fs.readFileSync(OUT, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" ")[0]));
const { slugify } = require("./convert.js");

// the old tag names that were merged into other categories during the tidy-up
const MERGE = { "Tech": "Technology", "Technology and Internet": "Technology", "Resources": "Tools and Resources" };
const decodeCS = (s) => s.replace(/_((?:[0-9A-F]{2}00)+)_/g, (_, h) => h.match(/.{4}/g).map((c) => String.fromCharCode(parseInt(c.slice(0, 2), 16))).join(""));
const labels = new Set(JSON.parse(fs.readFileSync(T + "/out2/_all.json")).flatMap((r) => r.cats));

const paths = [...new Set(rows.map((r) => new URL(r[1]).pathname))];
const lines = [];
const add = (src, dst) => { if (!existing.has(src)) { existing.add(src); lines.push(`${src} ${dst} 301`); } };

(async () => {
	const live = new Map();
	const categoryFor = async (label) => {
		const target = MERGE[label] || label;
		if (!labels.has(label) && !labels.has(target)) return null;
		const slug = slugify(target);
		if (!live.has(slug)) live.set(slug, (await fetch(`https://blog.jaysonknight.com/category/${slug}`, { headers: { "User-Agent": "Mozilla/5.0" } })).status === 200);
		return live.get(slug) ? `/category/${slug}` : null;
	};
	for (const p of paths) {
		if (/^\/jayson\/archive\/\d{4}\/\d\d\.aspx$/.test(p)) add(p, "/posts");
		else if (/^\/jayson\/(default|archive)\.aspx$/.test(p)) add(p, "/posts");
		else if (p === "/jayson/about.aspx") add(p, "/pages/about-me");
		else if (p === "/jayson/contact.aspx") add(p, "/");
		else if (p === "/jayson/archive/tags/default.aspx") add(p, "/posts");
		else if (/^\/jayson\/archive\/tags\/.+\/default\.aspx$/.test(p)) {
			const first = p.slice("/jayson/archive/tags/".length).split("/")[0];
			const label = decodeCS(decodeURIComponent(first.replace(/\+/g, " ")));
			add(p, (await categoryFor(label)) || "/posts");
		}
	}
	fs.appendFileSync(OUT, lines.join("\n") + "\n");
	const total = fs.readFileSync(OUT, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).length;
	console.log("added", lines.length, "total rules", total);
	console.log(lines.slice(0, 4).join("\n"));
	console.log(lines.filter((l) => l.includes("/category/")).slice(0, 4).join("\n"));
})();
