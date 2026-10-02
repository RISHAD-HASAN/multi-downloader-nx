// Maps a pasted Crunchyroll URL onto a target type and the ID the CLI flags expect.

export type ParsedUrl = {
	service: 'crunchy';
	type: 'series' | 'season' | 'episode' | 'movieListing' | 'extid';
	id: string;
	originalUrl: string;
};

export function parseUrl(rawUrl: string): ParsedUrl | undefined {
	if (!rawUrl || typeof rawUrl !== 'string') return undefined;

	let urlStr = rawUrl.trim();
	if (!/^https?:\/\//i.test(urlStr)) {
		urlStr = 'https://' + urlStr;
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(urlStr);
	} catch {
		return undefined;
	}

	const hostname = parsedUrl.hostname.toLowerCase();
	const pathname = parsedUrl.pathname;

	if (hostname === 'crunchyroll.com' || hostname.endsWith('.crunchyroll.com')) {
		// drop the locale prefix: /en, /fr, /es-419, /pt-br
		const path = pathname.replace(/^\/[a-z]{2}(?:-[a-z0-9]{2,4})?(?=\/|$)/i, '');

		const seriesMatch = path.match(/^\/(?:watch\/)?series\/([0-9A-Z]{9,})/i);
		if (seriesMatch) {
			return {
				service: 'crunchy',
				type: 'series',
				id: seriesMatch[1],
				originalUrl: rawUrl
			};
		}

		const movieMatch = path.match(/^\/(?:watch\/)?(?:movie_listing|movie)\/([0-9A-Z]{9,})/i);
		if (movieMatch) {
			return {
				service: 'crunchy',
				type: 'movieListing',
				id: movieMatch[1],
				originalUrl: rawUrl
			};
		}

		const seasonMatch = path.match(/^\/season\/([0-9A-Z]{9,})/i);
		if (seasonMatch) {
			return {
				service: 'crunchy',
				type: 'season',
				id: seasonMatch[1],
				originalUrl: rawUrl
			};
		}

		const epMatch = path.match(/^\/(?:watch|episode)\/([0-9A-Z]{9,})/i);
		if (epMatch) {
			return {
				service: 'crunchy',
				type: 'episode',
				id: epMatch[1],
				originalUrl: rawUrl
			};
		}

		// old episode URLs end in a numeric id: /<show>/<slug>-<extid>
		const legacyMatch = path.match(/-(\d{5,})(?:\/|$)/);
		if (legacyMatch) {
			return {
				service: 'crunchy',
				type: 'extid',
				id: legacyMatch[1],
				originalUrl: rawUrl
			};
		}

		return undefined;
	}

	return undefined;
}
