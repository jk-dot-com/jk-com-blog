/** Numbered archive pages (`?page=2`) for the post, category and tag listings. */
export const FIRST_PAGE = 1;
export const PAGE_SIZE = 24;

/** The requested page number; anything missing, fractional or below 1 is the first page. */
export const pageFromUrl = (url: URL): number => {
	const page = Number(url.searchParams.get("page") ?? FIRST_PAGE);
	return Number.isInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
};

/** How many entries to skip for a page, for `getEmDashCollection({ limit, offset })`. */
export const pageOffset = (page: number): number => (page - FIRST_PAGE) * PAGE_SIZE;
