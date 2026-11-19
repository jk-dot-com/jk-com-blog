/** Longest meta description search engines show before cutting it off. */
const MAX_DESCRIPTION = 155;

// Matches any run of whitespace (spaces, tabs, newlines) so it can collapse to one space.
// Matches "a \n b" at " \n "; rejects "ab", which has no whitespace.
// Tester: https://regex101.com/?regex=%5Cs%2B&flags=g&testString=a%20%0A%20b
const WHITESPACE_RUN = /\s+/g;

// Matches punctuation and spaces left dangling at the end after cutting at a word boundary.
// Matches "word, " at ", "; rejects "word", which has nothing trailing.
// Tester: https://regex101.com/?regex=%5B%2C%3B%3A%5C-%E2%80%93%E2%80%94%5Cs%5D%2B%24&testString=word%2C%20
const DANGLING_PUNCTUATION = /[,;:\-–—\s]+$/;

/** Plain text of a Portable Text body: its paragraphs, headings and lists, without code or images. */
export function plainTextOf(blocks: unknown): string {
	const list = Array.isArray(blocks) ? (blocks as Array<{ _type?: string; children?: Array<{ text?: string }> }>) : [];
	return list
		.filter((b) => b._type === "block")
		.map((b) => (b.children ?? []).map((c) => c.text ?? "").join(""))
		.join(" ");
}

/** Meta-description fallback for an entry with no excerpt: the opening of its body, cut at a word boundary. */
export function descriptionFromText(text: string): string {
	const flat = text.replace(WHITESPACE_RUN, " ").trim();
	if (flat.length <= MAX_DESCRIPTION) return flat;
	const cut = flat.slice(0, MAX_DESCRIPTION);
	return cut.slice(0, cut.lastIndexOf(" ")).replace(DANGLING_PUNCTUATION, "") + "…";
}
