// The live download view.
//
// Holds one session per episode. hls-download reports into it instead of
// printing a line per chunk, and extra dubs/subtitles get appended to the same
// tree as they show up. Normal log lines still print above the live region.

import { console_ } from './module.console';
import { DownloadTable, formatBytes, type TrackLike } from './module.console';

export type UITrackType = 'Video' | 'Audio' | 'Subtitle';

export interface UITrack {
	// Stable identifier used by the downloader to address this row
	key: string;
	type: UITrackType;
	label: string;
}

// Terminal states shown in place of the transferred amount
export type TrackState = 'Downloaded' | 'Decrypting' | 'Decrypted' | 'Muxing' | 'Muxed' | 'SKIPPED' | 'FAILED';

interface TrackRuntime {
	completed: number;
	total: number | null;
	bytes: number;
	state?: TrackState;
	startedAt: number;
	lastBytes: number;
	lastAt: number;
	speed: number;
}

class DownloadSession {
	private table: DownloadTable;
	private runtime = new Map<string, TrackRuntime>();
	private stopped = false;

	constructor(public tracks: UITrack[]) {
		const rows: Array<TrackLike & { key: string }> = tracks.map((t) => ({
			key: t.key,
			type: t.type,
			label: t.label
		}));
		this.table = new DownloadTable(rows);
		for (const t of tracks) {
			this.runtime.set(t.key, {
				completed: 0,
				total: null,
				bytes: 0,
				startedAt: Date.now(),
				lastBytes: 0,
				lastAt: Date.now(),
				speed: 0
			});
		}
		this.table.start();
	}

	has(key: string): boolean {
		return this.runtime.has(key);
	}

	// Register a track once the view is already on screen
	add(track: UITrack) {
		if (this.runtime.has(track.key)) return;
		this.tracks.push(track);
		this.runtime.set(track.key, {
			completed: 0,
			total: null,
			bytes: 0,
			startedAt: Date.now(),
			lastBytes: 0,
			lastAt: Date.now(),
			speed: 0
		});
		this.table.addTrack({ key: track.key, type: track.type, label: track.label });
	}

	// Report progress for one track. Safe to call very frequently
	progress(key: string, patch: { completed?: number; total?: number | null; bytes?: number }) {
		const rt = this.runtime.get(key);
		if (!rt || this.stopped) return;

		if (patch.total !== undefined) rt.total = patch.total;
		if (patch.completed !== undefined) rt.completed = patch.completed;

		if (patch.bytes !== undefined) {
			const now = Date.now();
			const dt = (now - rt.lastAt) / 1000;
			// Recompute the rolling speed at most a few times a second
			if (dt >= 0.4) {
				const inst = (patch.bytes - rt.lastBytes) / dt;
				rt.speed = rt.speed === 0 ? inst : rt.speed * 0.7 + inst * 0.3;
				rt.lastBytes = patch.bytes;
				rt.lastAt = now;
			}
			rt.bytes = patch.bytes;
		}

		this.table.update(key, {
			completed: rt.completed,
			total: rt.total,
			downloaded: rt.state ?? this.readout(rt)
		});
	}

	private readout(rt: TrackRuntime): string {
		const size = rt.bytes > 0 ? formatBytes(rt.bytes) : '-';
		if (rt.speed > 0 && !rt.state) return `${size} @ ${formatBytes(rt.speed)}/s`;
		return size;
	}

	// Mark a track as finished/decrypted/muxed/skipped
	state(key: string, state: TrackState) {
		const rt = this.runtime.get(key);
		if (!rt || this.stopped) return;
		rt.state = state;
		const inProgress = state === 'Decrypting' || state === 'Muxing';
		const styled = state === 'FAILED' ? '[red]FAILED[/]' : state === 'SKIPPED' ? '[yellow]SKIPPED[/]' : inProgress ? `[yellow]${state}[/]` : `[green]${state}[/]`;
		// Tracks that never reported a total (subtitles, chapters) still need a
		// full bar rather than an idle pulse once they reach a terminal state.
		const total = rt.total && rt.total > 0 ? rt.total : 1;
		this.table.update(key, {
			completed: inProgress ? Math.max(rt.completed, total) : total,
			total,
			downloaded: styled
		});
	}

	stop() {
		if (this.stopped) return;
		this.stopped = true;
		this.table.stop();
	}
}

let current: DownloadSession | undefined;

/**
 * Begin the live download view. Returns silently in GUI mode so the GUI's own
 * progress reporting is untouched.
 */
export function beginSession(tracks: UITrack[]): void {
	endSession();
	if (process.env.isGUI === 'true') return;
	if (!tracks.length) return;
	current = new DownloadSession(tracks);
}

export function sessionActive(): boolean {
	return current !== undefined;
}

// True when the live view owns this track (so the caller should not log lines).
export function sessionOwns(key?: string): boolean {
	return Boolean(current && key && current.has(key));
}

export function trackProgress(key: string, patch: { completed?: number; total?: number | null; bytes?: number }): void {
	current?.progress(key, patch);
}

export function trackState(key: string, state: TrackState): void {
	current?.state(key, state);
}

// Add a track to the running session (2nd dub, subtitles, ...)
export function addTrack(track: UITrack): void {
	current?.add(track);
}

// Mark every track still in flight with a terminal state
export function trackStateAll(state: TrackState, only?: UITrackType): void {
	if (!current) return;
	for (const t of current.tracks) {
		if (only && t.type !== only) continue;
		current.state(t.key, state);
	}
}

export function endSession(): void {
	current?.stop();
	current = undefined;
}

// Guarantees the live region is torn down even if the body throws
export async function withSession<T>(tracks: UITrack[], fn: () => Promise<T>): Promise<T> {
	beginSession(tracks);
	try {
		return await fn();
	} finally {
		endSession();
	}
}

// Never leave the terminal with a hidden cursor / half-painted live region.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
	process.on(sig, () => {
		endSession();
		console_.showCursor();
		process.exit(130);
	});
}
process.on('exit', () => {
	endSession();
	console_.showCursor();
});
