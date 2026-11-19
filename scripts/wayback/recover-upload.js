// Upload the images that the Wayback index revealed (recoverable.json) and register them in state.media.
const fs = require("fs");
const T = require("./paths").DATA;
const OUT = T + "/out2";
const H = { Authorization: "Bearer " + process.env.EMDASH_TOKEN, "Accept-Encoding": "identity" };
const state = JSON.parse(fs.readFileSync(OUT + "/_state.json"));
const found = JSON.parse(fs.readFileSync(T + "/recoverable.json"));
(async () => {
	const slugs = new Set();
	for (const f of found) {
		const abs = new URL(f.src, "http://jaysonknight.com/").href;
		if (state.media[abs]) { console.log("already have", abs); slugs.add(f.slug); continue; }
		const r = await fetch(`https://web.archive.org/web/${f.ts}im_/${f.original}`);
		const ct = r.headers.get("content-type") || "";
		if (!r.ok || !/^image\//.test(ct)) { console.log("fetch failed", f.original, r.status, ct); continue; }
		const buf = Buffer.from(await r.arrayBuffer());
		const ext = ct.split("/")[1].split(";")[0].replace("jpeg", "jpg");
		let name = decodeURIComponent(new URL(f.original).pathname.split("/").pop() || "image").replace(/[^\w.-]+/g, "_");
		if (!/\.\w{2,4}$/.test(name)) name += "." + ext;
		const fd = new FormData();
		fd.append("file", new Blob([buf], { type: ct.split(";")[0] }), name);
		const up = await fetch("https://blog.jaysonknight.com/_emdash/api/media", { method: "POST", headers: H, body: fd });
		const j = await up.json().catch(() => ({}));
		const key = j?.data?.item?.storageKey;
		if (!up.ok || !key) { console.log("upload failed", f.original, up.status); continue; }
		state.media[abs] = `/_emdash/api/media/file/${key}`;
		slugs.add(f.slug);
		console.log("uploaded", name, buf.length, "bytes ->", key);
	}
	fs.writeFileSync(OUT + "/_state.json", JSON.stringify(state, null, 1));
	console.log("SLUGS=" + [...slugs].join(","));
})();
