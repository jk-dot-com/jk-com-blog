// Smoke-tests the deployed site. Usage: pnpm verify:live  (SITE_URL overrides the target)
const base = (process.env.SITE_URL ?? "https://blog.jaysonknight.com").replace(/\/$/, "");
let failed = 0;

async function check(path, { status = [200], type, contains } = {}) {
	const res = await fetch(base + path, { redirect: "manual" });
	const body = await res.text();
	const errors = [];
	if (!status.includes(res.status)) errors.push(`status ${res.status}, want ${status}`);
	if (type && !(res.headers.get("content-type") ?? "").includes(type)) errors.push(`content-type want ${type}`);
	if (contains && !body.includes(contains)) errors.push(`body missing "${contains}"`);
	console.log(`${errors.length ? "FAIL" : "ok  "} ${path} ${res.status}${errors.length ? " — " + errors.join("; ") : ""}`);
	if (errors.length) failed++;
	return body;
}

await check("/", { contains: "<html" });
const posts = await check("/posts", { contains: "<html" });
const first = posts.match(/href="(\/posts\/[^"/]+)"/)?.[1];
if (first) await check(first, { contains: "<article" });
else console.log("skip post detail (no posts listed)");
await check("/search");
await check("/rss.xml", { type: "xml", contains: "<rss" });
await check("/this-page-should-not-exist", { status: [404] });
// Admin must be reachable (login redirect or page), never a 5xx.
await check("/_emdash/admin", { status: [200, 301, 302, 307, 308, 401] });

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log("all checks passed");
