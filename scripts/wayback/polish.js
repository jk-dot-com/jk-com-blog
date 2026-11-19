// Formatting-only polish of imported posts: code language, unformatted code -> code blocks, tidy whitespace.
// usage: node polish.js [--dry] [--limit N]
const fs = require("fs");
const T = require("./paths").DATA;
const OUT = T + "/out2";
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIMIT = args.includes("--limit") ? +args[args.indexOf("--limit") + 1] : Infinity;

function guessLang(code) {
	const c = code;
	const score = {
		csharp: 0, sql: 0, xml: 0, javascript: 0, css: 0, powershell: 0, ini: 0,
	};
	if (/\b(using System|namespace\s+\w|public\s+(class|static|void|string|int|bool|override|virtual)|private\s+(static|void|string|int|readonly)|protected\s+(virtual|override)|internal\s+|foreach\s*\(|\bvar\s+\w+\s*=|=>|\bnew\s+[A-Z]\w+\(|get;\s*set;|\bstring\[\]|\bthis\.|\[[A-Z]\w+(\(.*\))?\]\s*$)/m.test(c)) score.csharp += 3;
	if (/;\s*$/m.test(c) && /[{}]/.test(c)) score.csharp += 1;
	if (/\b(SELECT\b[\s\S]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|CREATE\s+(TABLE|PROC|VIEW|FUNCTION|INDEX)|ALTER\s+TABLE|DELETE\s+FROM|\bEXEC(UTE)?\s+\w|DECLARE\s+@|SET\s+@)/i.test(c)) score.sql += 4;
	if (/^\s*<[?!A-Za-z\/][\s\S]*>\s*$/m.test(c) && /<\/?\w+[\s>\/]/.test(c) && !/\bpublic\b|\bclass\b/.test(c)) score.xml += 3;
	if (/\b(function\s*\w*\(|document\.\w+|var\s+\w+\s*=\s*(function|document|\{)|\$\(["'])/.test(c)) score.javascript += 3;
	if (/^[\s\S]*[.#]?[\w-]+\s*\{[^}]*:[^}]*;[^}]*\}/.test(c) && !/\bclass\b|\bpublic\b/.test(c)) score.css += 3;
	if (/(^|\s)(Get|Set|New|Add|Remove|Import|Export)-[A-Z]\w+|\$\w+\s*=|\|\s*(Where|Select|ForEach)-Object/m.test(c)) score.powershell += 3;
	if (/^\s*\[[\w .]+\]\s*$/m.test(c) && /^\s*\w+\s*=\s*.+$/m.test(c)) score.ini += 3;
	const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
	return best[1] >= 3 ? best[0] : null;
}

const codeLine = (t) =>
	/[;{}]\s*$/.test(t) ||
	/^\s*(\/\/|\/\*|\*\/|#region|#endregion|using\s+[\w.]+;|namespace\s|public\s|private\s|protected\s|internal\s|static\s|class\s|void\s|return\b|if\s*\(|else\b|using\s*\(|lock\s*\(|switch\s*\(|(get|set)\s*$|for(each)?\s*\(|while\s*\(|try\b|catch\b|finally\b|\[[A-Z]\w+)/.test(t) ||
	/^\s*<\/?[\w:!?%]+[^>]*>\s*$/.test(t) ||
	/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE|GROUP BY|ORDER BY|EXEC|DECLARE)\b/i.test(t) ||
	/^\s*(\w+(\.\w+)+\(.*\)|\w+\s*=\s*.+);?\s*$/.test(t);

function reindent(code) {
	if (!/[{}]/.test(code) || /^(\t| {2,})\S/m.test(code)) return code;
	let d = 0;
	return code.split("\n").map((l) => {
		const t = l.trim();
		if (!t) return "";
		const open = (t.match(/\{/g) || []).length, close = (t.match(/\}/g) || []).length;
		if (t.startsWith("}")) d = Math.max(0, d - 1);
		const line = "    ".repeat(d) + t;
		d = Math.max(0, d + open - close + (t.startsWith("}") ? 1 : 0));
		return line;
	}).join("\n");
}
function polishContent(blocks) {
	let out = [];
	let i = 0;
	const text = (b) => (b.children || []).map((c) => c.text).join("");
	while (i < blocks.length) {
		const b = blocks[i];
		// run of >=3 consecutive plain paragraphs that all look like code -> one code block
		if (b._type === "block" && b.style === "normal" && !b.listItem && codeLine(text(b)) && text(b).length < 220) {
			let j = i;
			while (j < blocks.length && blocks[j]._type === "block" && blocks[j].style === "normal" && !blocks[j].listItem && codeLine(text(blocks[j])) && text(blocks[j]).length < 220) j++;
			if (j - i >= 3) {
				const code = blocks.slice(i, j).map(text).join("\n");
				out.push({ _type: "code", _key: "p" + out.length + "x" + i, code });
				i = j;
				continue;
			}
		}
		out.push(b);
		i++;
	}
	// Code-like lines next to a code block belong to it: the old formatter split snippets around lines that
	// looked like prose. Adjacent code blocks are joined too.
	const isCodePara = (b) => b._type === "block" && b.style === "normal" && !b.listItem && codeLine(text(b)) && text(b).length < 220;
	const joined = [];
	out.forEach((b, k) => {
		const prev = joined[joined.length - 1];
		if (isCodePara(b) && ((prev && prev._type === "code") || (out[k + 1] && out[k + 1]._type === "code"))) {
			if (prev && prev._type === "code") prev.code += "\n" + text(b);
			else joined.push({ _type: "code", _key: "a" + k, code: text(b) });
		} else if (b._type === "code" && prev && prev._type === "code") prev.code += "\n" + b.code;
		else joined.push(b);
	});
	out = joined;
	let changed = 0;
	for (const b of out) {
		if (b._type !== "code") continue;
		b.code = reindent(b.code.replace(/\t/g, "    ").replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, ""));
		const lang = b.language || guessLang(b.code);
		if (lang && lang !== b.language) { b.language = lang; changed++; }
	}
	return { blocks: out, changed };
}
module.exports = { polishContent, guessLang };

if (require.main === module) {
	(async () => {
		const recs = JSON.parse(fs.readFileSync(OUT + "/_all.json"));
		const state = JSON.parse(fs.readFileSync(OUT + "/_state.json"));
		const BASE = "https://blog.jaysonknight.com/_emdash/api";
		const H = { Authorization: "Bearer " + process.env.EMDASH_TOKEN, "Content-Type": "application/json", "Accept-Encoding": "identity" };
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const tryJson = async (url, opts) => { for (let a = 0; a < 4; a++) { try { const r = await fetch(url, opts); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; } return { ok: r.ok, status: r.status, j, t }; } catch { await sleep(3000 * (a + 1)); } } return { ok: false, status: 0, j: {}, t: "" }; };
		const polishedPath = OUT + "/_polished.json";
		const polished = fs.existsSync(polishedPath) ? JSON.parse(fs.readFileSync(polishedPath)) : {};
		const langs = {};
		let n = 0, upd = 0, fail = 0;
		for (const r of recs) {
			if (n >= LIMIT) break;
			const id = state.posts[r.slug];
			if (!id || polished[r.slug]) continue;
			n++;
			// rebuild from the stored record, re-attaching uploaded images by position
			const live = DRY ? null : (await tryJson(`${BASE}/content/posts/${id}`, { headers: H })).j;
			const item = live?.data?.item;
			if (!DRY && !item) { console.log("skip (read failed)", r.slug); continue; }
			const base = item ? item.data.content : r.data.content;
			const { blocks, changed } = polishContent(base);
			for (const b of blocks) if (b._type === "code") langs[b.language || "none"] = (langs[b.language || "none"] || 0) + 1;
			const diff = JSON.stringify(blocks) !== JSON.stringify(base);
			if (DRY || !diff) { polished[r.slug] = 1; continue; }
			const res = await tryJson(`${BASE}/content/posts/${id}`, { method: "PUT", headers: H, body: JSON.stringify({ data: { content: blocks }, _rev: item._rev }) });
			if (res.ok) { upd++; polished[r.slug] = 1; } else { fail++; console.log("FAIL", r.slug, res.status, res.t.slice(0, 160)); }
			if (n % 25 === 0) fs.writeFileSync(polishedPath, JSON.stringify(polished));
			await new Promise((s) => setTimeout(s, 120));
		}
		fs.writeFileSync(polishedPath, JSON.stringify(polished));
		console.log({ checked: n, updated: upd, failed: fail, languages: langs });
	})();
}
