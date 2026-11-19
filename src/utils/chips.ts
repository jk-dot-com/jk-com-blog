/** A tag or category link shown as a chip on cards, lists and post pages. */
export interface Chip {
	slug: string;
	label: string;
	href: string;
}

interface Term {
	slug: string;
	label: string;
}

/**
 * Tags when the post has any; otherwise its categories. Posts imported from the old blog only carry
 * categories, so without the fallback they would show no chips at all.
 */
export const chipsFor = (tags: Term[] = [], categories: Term[] = []): Chip[] =>
	tags.length > 0
		? tags.map(({ slug, label }) => ({ slug, label, href: `/tag/${slug}` }))
		: categories.map(({ slug, label }) => ({ slug, label, href: `/category/${slug}` }));
