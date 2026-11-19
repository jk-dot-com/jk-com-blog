/** A media value's own pixel size, when EmDash recorded it. */
interface Sized {
	width?: number;
	height?: number;
}

/**
 * Width and height to request from the image service for a featured image shown at most `maxWidth` px wide:
 * the original's aspect ratio, never upscaled. Empty when the size is unknown, which leaves the component's defaults.
 */
export function scaledTo(image: unknown, maxWidth: number): { width?: number; height?: number } {
	const media = typeof image === "object" && image !== null ? (image as Sized) : undefined;
	if (!media?.width || !media.height) return {};
	const width = Math.min(maxWidth, media.width);
	return { width, height: Math.round((width * media.height) / media.width) };
}
