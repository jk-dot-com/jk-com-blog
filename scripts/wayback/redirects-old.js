// 301 redirects from every old Community Server URL to the new /posts/<slug>. Idempotent via out2/_state.json.
const fs = require("fs");
const OUT = require("./paths").DATA + "/out2";
const BASE = "https://blog.jaysonknight.com/_emdash/api/redirects";
const H = { Authorization: "Bearer " + process.env.EMDASH_TOKEN, "Content-Type": "application/json", "Accept-Encoding": "identity" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
	const recs = JSON.parse(fs.readFileSync(OUT + "/_all.json"));
	const state = JSON.parse(fs.readFileSync(OUT + "/_state.json"));
	state.redirects ||= {};
	let ok = 0, skip = 0, fail = 0;
	for (const r of recs) {
		if (!state.posts[r.slug]) continue;
		for (const p of r.oldPaths) {
			if (state.redirects[p]) { skip++; continue; }
			let res;
			for (let a = 0; a < 4; a++) {
				try { res = await fetch(BASE, { method: "POST", headers: H, body: JSON.stringify({ source: p, destination: `/posts/${r.slug}`, type: 301 }) }); if (res.status < 500 && res.status !== 429) break; } catch {}
				await sleep(2000 * (a + 1));
			}
			if (res?.ok || res?.status === 409) { state.redirects[p] = r.slug; ok++; }
			else { fail++; console.log("FAIL", p, res?.status, ((await res?.text?.()) || "").slice(0, 120)); }
			if ((ok + fail) % 50 === 0) fs.writeFileSync(OUT + "/_state.json", JSON.stringify(state, null, 1));
			await sleep(100);
		}
	}
	fs.writeFileSync(OUT + "/_state.json", JSON.stringify(state, null, 1));
	console.log("redirects", { created: ok, skipped: skip, failed: fail });
})();
