// Visual check: screenshots + layout metrics of live pages through headless Edge (CDP), no extension needed.
//   node scripts/visual-check.cjs <outDir> "name=url[@WxH][:full]" ...
//   e.g. node scripts/visual-check.cjs shots "home=https://blog.jaysonknight.com/@1440x900" "home-m=https://blog.jaysonknight.com/@390x844:full"
// Prints per-page JSON (title, horizontal overflow, header images, nav links, broken images) and writes <name>.png.
// Cloudflare Bot Fight Mode challenges headless browsers: turn it off for the run and restore it right after
// (zone bot_management fight_mode). Lazy-loaded images below the fold can look blank in :full captures.
const fs = require("fs");
const { spawn } = require("child_process");
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
if (!edge) throw new Error("msedge not found");
const [outDir, ...jobs] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
	const profile = process.env.TEMP + "/edge-shots-profile";
	const proc = spawn(edge, [`--remote-debugging-port=${PORT}`, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
	let version;
	for (let i = 0; i < 40; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(500); } }
	if (!version) { proc.kill(); throw new Error("edge did not start"); }
	const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => (ws.onopen = r));
	let id = 0; const pending = new Map(); const events = [];
	ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
	const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
	await send("Page.enable"); await send("Runtime.enable");
	const report = [];
	for (const job of jobs) {
		const m = job.match(/^([^=]+)=(.+?)(?:@(\d+)x(\d+))?(:full)?$/);
		const [, name, url, w = "1440", h = "900", full] = m;
		await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
		await send("Page.navigate", { url });
		await sleep(4500);
		const ev = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
			const q = (s) => document.querySelector(s);
			const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
			const hdr = q('.site-header');
			return JSON.stringify({
				title: document.title, status: document.readyState,
				scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
				hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
				header: rect(hdr), brandMark: rect(q('.brand-mark')), brandText: rect(q('.brand-text')), brandBlog: rect(q('.brand-blog')),
				headerImgs: hdr ? hdr.querySelectorAll('img').length : 0,
				navLinks: [...document.querySelectorAll('.nav-link')].map((a) => a.textContent.trim() + (a.classList.contains('is-active') ? '*' : '')),
				brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => (i.currentSrc || i.src).slice(0, 90)),
				h1: (q('h1') || {}).textContent
			});
		})()` });
		let info = {}; try { info = JSON.parse(ev.result.result.value); } catch {}
		const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!full, ...(full ? { clip: { x: 0, y: 0, width: +w, height: Math.min(4200, Math.max(+h, (info.scrollH || 0))), scale: 1 } } : {}) });
		let data = shot.result && shot.result.data;
		if (full && !data) data = (await send("Page.captureScreenshot", { format: "png" })).result.data;
		if (full) {
			const dims = await send("Runtime.evaluate", { returnByValue: true, expression: "document.documentElement.scrollHeight" });
			const sh = Math.min(4200, dims.result.result.value);
			const s2 = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: +w, height: sh, scale: 1 } });
			data = s2.result.data;
		}
		fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, "base64"));
		report.push({ name, url, size: `${w}x${h}`, ...info });
	}
	fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
	console.log(JSON.stringify(report.map((r) => ({ name: r.name, title: (r.title || "").slice(0, 40), hOverflow: r.hOverflow, headerImgs: r.headerImgs, nav: (r.navLinks || []).join(","), broken: (r.brokenImgs || []).length })), null, 1));
	try { ws.close(); } catch {}
	proc.kill();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
