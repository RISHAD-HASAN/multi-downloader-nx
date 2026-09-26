import { parse as parseMpd } from 'mpd-parser';

// Crunchyroll serves separate DASH encodes for Majin (VBR) and the CBR 0/1
// paths, and the selection is local to one playback version: other dubs may not
// carry the same encodes. None of this applies to HLS manifests.
export type StreamVariant = 'majin' | 'cbr0' | 'cbr1';
export type StreamMode = 'auto' | StreamVariant;

export type StreamCandidate = {
	variant: StreamVariant;
	name: string;
	url: string;
	width: number;
	height: number;
	declaredBps: number;
	actualBps?: number;
	sizeBytes?: number;
	mediaUri?: string;
	durationSec: number;
};

export type StreamComparison = {
	candidates: StreamCandidate[];
	selected?: StreamCandidate;
	durationSec: number;
};

const dashPath = /\/(?:\d+\/)?clean\/(?:cenc\/)?dash\//;

function dashUrlParts(url: string): [string, string] | undefined {
	const suffixStart = url.search(/[?#]/);
	const pathname = suffixStart === -1 ? url : url.slice(0, suffixStart);
	if (!pathname.includes('/static/') || !dashPath.test(pathname)) return;
	return [pathname, suffixStart === -1 ? '' : url.slice(suffixStart)];
}

export function applyMajinTransform(url: string): string {
	const parts = dashUrlParts(url);
	if (!parts) return url;
	const [pathname, suffix] = parts;
	const withMajin = pathname.includes('/static/majin/') ? pathname : pathname.replace('/static/', '/static/majin/');
	return withMajin.replace(dashPath, '/clean/cenc/dash/') + suffix;
}

export function applyCbrTransform(url: string, index: '0' | '1'): string {
	const parts = dashUrlParts(url);
	if (!parts) return url;
	const [pathname, suffix] = parts;
	return pathname.replace('/static/majin/', '/static/').replace(dashPath, `/${index}/clean/dash/`) + suffix;
}

export function variantUrl(url: string, variant: StreamVariant): string {
	return variant === 'majin' ? applyMajinTransform(url) : applyCbrTransform(url, variant === 'cbr0' ? '0' : '1');
}

export function parseISODuration(value?: string): number {
	if (!value) return 0;
	const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value);
	if (!match) return 0;
	return Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
}

export function manifestDuration(manifest: string, fallbackSec = 0): number {
	return parseISODuration(/\bmediaPresentationDuration=["']([^"']+)["']/i.exec(manifest)?.[1]) || fallbackSec;
}

export function formatDuration(seconds: number): string {
	const rounded = Math.round(seconds);
	return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

export function sizeFromBitrate(bps: number, durationSec: number): number | undefined {
	return Number.isFinite(bps) && bps > 0 && Number.isFinite(durationSec) && durationSec > 0 ? Math.round((bps * durationSec) / 8) : undefined;
}

export function formatBytes(bytes?: number): string {
	if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${Math.round(bytes)} B`;
}

function parseCandidate(variant: StreamVariant, url: string, manifest: string, fallbackDurationSec: number): StreamCandidate | undefined {
	if (!/<MPD(?:\s|>)/i.test(manifest)) return;
	const playlists = parseMpd(manifest, { manifestUri: url }).playlists ?? [];
	const videos = playlists.filter((playlist) => playlist.attributes.RESOLUTION && playlist.attributes.BANDWIDTH > 0);
	// Prefer 1080p+ when present, then the highest declared bitrate. Only a
	// SegmentBase sidx can be HEADed - an MPD or a single SegmentTemplate part is
	// not the whole file.
	const hd = videos.filter((playlist) => playlist.attributes.RESOLUTION!.height >= 1080 || playlist.attributes.RESOLUTION!.width >= 1920);
	const best = (hd.length ? hd : videos).sort((a, b) => b.attributes.BANDWIDTH - a.attributes.BANDWIDTH)[0];
	if (!best) return;

	const durationSec = manifestDuration(manifest, fallbackDurationSec);
	return {
		variant,
		name: variant === 'majin' ? 'Majin (VBR)' : variant === 'cbr0' ? 'CBR 0 (high bitrate)' : 'CBR 1 (standard)',
		url,
		width: best.attributes.RESOLUTION!.width,
		height: best.attributes.RESOLUTION!.height,
		declaredBps: best.attributes.BANDWIDTH,
		sizeBytes: sizeFromBitrate(best.attributes.BANDWIDTH, durationSec),
		mediaUri: best.sidx?.resolvedUri,
		durationSec
	};
}

export function chooseStream(candidates: StreamCandidate[]): StreamCandidate | undefined {
	const majin = candidates.find((candidate) => candidate.variant === 'majin');
	const cbr = candidates
		.filter((candidate) => candidate.variant !== 'majin')
		.sort((a, b) => {
			const aHd = a.height >= 1080 || a.width >= 1920;
			const bHd = b.height >= 1080 || b.width >= 1920;
			return Number(bHd) - Number(aHd) || b.declaredBps - a.declaredBps;
		})[0];

	if (!majin || !cbr) return majin ?? cbr;
	const majinHd = majin.height >= 1080 || majin.width >= 1920;
	const cbrHd = cbr.height >= 1080 || cbr.width >= 1920;
	if (majinHd !== cbrHd) return majinHd ? majin : cbr;

	// Bitmovin VBR declares its peak tier, while the average file bitrate is
	// lower. Majin wins when it really beats CBR, or when its tier is higher and
	// the measured bitrate is healthy (7.5 Mbps). Without a whole-file size from
	// HEAD, fall back to comparing the declared tiers.
	const majinWins =
		(majin.actualBps !== undefined && majin.actualBps > cbr.declaredBps) ||
		(majin.declaredBps > cbr.declaredBps && (majin.actualBps === undefined || majin.actualBps >= 7_500_000));
	return majinWins ? majin : cbr;
}

export async function comparePlaybackStreams(
	url: string,
	mode: StreamMode,
	fallbackDurationSec: number,
	fetchManifest: (url: string) => Promise<string | undefined>,
	fetchFileSize: (uri: string) => Promise<number | undefined>
): Promise<StreamComparison> {
	const empty: StreamComparison = { candidates: [], durationSec: fallbackDurationSec };
	if (!dashUrlParts(url)) return empty;

	const variants: StreamVariant[] = mode === 'auto' ? ['majin', 'cbr0', 'cbr1'] : [mode];
	const results = await Promise.all(
		variants.map(async (variant) => {
			try {
				const candidateUrl = variantUrl(url, variant);
				const body = await fetchManifest(candidateUrl);
				return body ? parseCandidate(variant, candidateUrl, body, fallbackDurationSec) : undefined;
			} catch {
				// A 404 or a malformed rendition must not abort the other dubs/streams.
				return undefined;
			}
		})
	);
	const candidates = results.filter((candidate): candidate is StreamCandidate => candidate !== undefined);
	const majin = candidates.find((candidate) => candidate.variant === 'majin');
	if (majin?.mediaUri) {
		try {
			const bytes = await fetchFileSize(majin.mediaUri);
			if (bytes && Number.isSafeInteger(bytes) && bytes > 0) {
				majin.sizeBytes = bytes;
				if (majin.durationSec > 0) majin.actualBps = Math.round((bytes * 8) / majin.durationSec);
			}
		} catch {
			// HEAD is best-effort; the manifest tier remains usable on failure.
		}
	}

	const selected = mode === 'auto' ? chooseStream(candidates) : candidates.find((candidate) => candidate.variant === mode);
	return { candidates, selected, durationSec: selected?.durationSec ?? candidates[0]?.durationSec ?? fallbackDurationSec };
}
