// Console presentation built on module.rich: banner, section rules, listing
// panels, track trees, content key trees and the live download table.

import {
	BOX,
	GradientBar,
	Group,
	Live,
	Padding,
	Panel,
	Progress,
	RichConsole,
	Rule,
	Spinner,
	Table,
	Text,
	Tree,
	formatBytes,
	formatDuration,
	renderMarkup,
	setTheme,
	stripMarkup,
	theme,
	type LogLevel,
	type RenderInput
} from './module.rich';

export {
	BOX,
	GradientBar,
	Group,
	Live,
	Padding,
	Panel,
	Progress,
	Rule,
	Spinner,
	Table,
	Text,
	Tree,
	formatBytes,
	formatDuration,
	renderMarkup,
	setTheme,
	stripMarkup,
	theme
};

export const console_ = new RichConsole({ showTime: false, logPadding: [0, 5] });


const ANIDL_ASCII = [
	' ▄▄▄· ▐ ▄ ▪  ·▄▄▄▄  ▄▄▌  ',
	'▐█ ▀█ •█▌▐███ ██▪ ██ ██•  ',
	'▄█▀▀█ ▐█▐▐▌▐█·▐█· ▐█▌██▪  ',
	'▐█ ▪▐▌██▐█▌▐█▌██. ██ ▐█▌▐▌',
	' ▀  ▀ ▀▀ █▪▀▀▀▀▀▀▀▀• .▀▀▀ '
].join('\n');

/**
 * The centred ASCII banner + version line, mirroring unshackle's `__main__`.
 */
export function printBanner(version: string, extra?: string) {
	const year = new Date().getFullYear();
	console_.print(
		new Padding(
			new Group(
				new Text(ANIDL_ASCII, { style: 'ascii.art', justify: 'center' }),
				new Text(
					`v [repr.number]${version}[/]${extra ? ` (${extra})` : ''} - © 2021-${year} - github.com/anidl/multi-downloader-nx`,
					{ justify: 'center' }
				)
			),
			[1, 11, 1, 10]
		)
	);
}


// `console.print(Padding(Rule("[rule.text]…"), (1, 2)))`
export function rule(title: string, pad: [number, number] | number = [1, 2]) {
	console_.print(new Padding(new Rule(`[rule.text]${title}[/]`), pad));
}

// A padded body block at unshackle's standard (0, 5) indent
export function block(renderable: RenderInput, pad: [number, number] | [number, number, number, number] = [0, 5]) {
	console_.print(new Padding(renderable, pad));
}

// unshackle's `listing_panel` - a titled panel listing renderables
export function listingPanel(items: RenderInput[], title: string): Panel {
	const grid = Table.grid({ padding: [0, 1] });
	if (items.length === 0) grid.addRow('[text2]Nothing to list[/]');
	for (const item of items) grid.addRow(item);
	return new Panel(grid, { title: `[panel.title]${title}[/]`, box: BOX.ROUNDED, padding: [0, 1] });
}


export interface TrackLike {
	type: 'Video' | 'Audio' | 'Subtitle' | 'Chapter' | 'Attachment';
	label: string;
	id?: string;
}

const TRACK_ORDER: TrackLike['type'][] = ['Video', 'Audio', 'Subtitle', 'Chapter', 'Attachment'];

/**
 * Build unshackle's `Tracks.tree()`: one branch per track type, labelled
 * "[n] Videos", with each track described beneath it.
 */
export function tracksTree(tracks: TrackLike[]): Tree {
	const tree = new Tree('', { hideRoot: true });
	for (const type of TRACK_ORDER) {
		const of = tracks.filter((t) => t.type === type);
		if (!of.length) continue;
		const plural = type + (type !== 'Audio' && of.length !== 1 ? 's' : '');
		const branch = tree.add(`[repr.number]${of.length}[/] ${plural}`);
		for (const t of of) branch.add(new Text(t.label, { style: 'text2', overflow: 'fold' }));
	}
	return tree;
}

/**
 * The live download view: a tree of tracks where each leaf carries its own
 * spinner + gradient bar + ETA + state, refreshed in place.
 */
export class DownloadTable {
	public progress = new Progress(['spinner', 'bar', '•', 'remaining', '•', 'downloaded'], { barWidth: 32 });
	private taskByKey = new Map<string, number>();
	private table = Table.grid();
	private live?: Live;
	private tracks: Array<TrackLike & { key: string }> = [];
	// Extra renderables appended below the tracks (e.g. the CEK tree)
	public extras = Table.grid();

	constructor(tracks: Array<TrackLike & { key: string }>) {
		this.tracks = tracks;
		for (const t of tracks) this.taskByKey.set(t.key, this.progress.addTask(t.label, { downloaded: '-' }, null));
		this.rebuild();
	}

	private rebuild() {
		const tree = new Tree('', { hideRoot: true });
		for (const type of TRACK_ORDER) {
			const of = this.tracks.filter((t) => t.type === type);
			if (!of.length) continue;
			const plural = type + (type !== 'Audio' && of.length !== 1 ? 's' : '');
			const branch = tree.add(`[repr.number]${of.length}[/] ${plural}`);
			for (const t of of) {
				const cell = Table.grid();
				// keep every track on one line; long names get an ellipsis
				cell.addRow(new Text(t.label, { style: 'text2', overflow: 'ellipsis' }));
				const taskId = this.taskByKey.get(t.key);
				if (taskId !== undefined) cell.addRow(new SingleTask(this.progress, taskId));
				branch.add(cell);
			}
		}
		this.table = Table.grid();
		this.table.addRow(tree);
		if (this.extras.rows.length) this.table.addRow(this.extras);
	}

	start(): DownloadTable {
		this.rebuild();
		this.live = new Live(new Padding(this.table, [1, 5]), { console: console_, refreshPerSecond: 20 }).start();
		return this;
	}

	// Register a track after the view is already live (extra dubs, subtitles).
	addTrack(track: TrackLike & { key: string }) {
		if (this.taskByKey.has(track.key)) return;
		this.tracks.push(track);
		this.taskByKey.set(track.key, this.progress.addTask(track.label, { downloaded: '-' }, null));
		this.rebuild();
		this.live?.update(new Padding(this.table, [1, 5]));
	}

	has(key: string): boolean {
		return this.taskByKey.has(key);
	}

	update(key: string, patch: { completed?: number; total?: number | null; downloaded?: string; advance?: number }) {
		const id = this.taskByKey.get(key);
		if (id === undefined) return;
		const { downloaded, ...rest } = patch;
		this.progress.update(id, { ...rest, ...(downloaded !== undefined ? { fields: { downloaded } } : {}) });
		if (downloaded && ['Downloaded', 'Decrypted', 'Muxed', 'SKIPPED'].includes(stripMarkup(downloaded))) {
			const t = this.progress.getTask(id);
			if (t && t.total) this.progress.update(id, { completed: t.total });
		}
	}

	// Attach/refresh a content-key tree beneath the track list
	setKeyTree(tree: Tree) {
		this.extras = Table.grid();
		this.extras.addRow(tree);
		this.rebuild();
		this.live?.update(new Padding(this.table, [1, 5]));
	}

	stop() {
		this.live?.stop();
	}
}

// Renders exactly one task of a Progress - used inside the track tree
class SingleTask {
	constructor(
		private progress: Progress,
		private taskId: number
	) {}
	measure(maxWidth: number) {
		return maxWidth;
	}
	render(width: number): string[] {
		const all = this.progress.tasks;
		const idx = all.findIndex((t) => t.id === this.taskId);
		if (idx < 0) return [''];
		const only = new Progress(this.progress.columns, this.progress.opts);
		only.tasks = [all[idx]];
		return only.render(width);
	}
}


/**
 * DRM status tree. Mask PSSH, KIDs and keys before rendering or file logging;
 * retain only the DRM type and vault attribution.
 */
export function cekTree(drm: 'Widevine' | 'PlayReady' | 'ClearKey', _pssh: string | undefined, keys: Array<{ kid: string; key: string; from?: string; trackKid?: boolean }>): Tree {
	const label = `[cyan]${drm}[/][text2](*)[/]`;
	const tree = new Tree(new Text(label, { overflow: 'fold' }));
	if (!keys.length) tree.add('[logging.level.error]No content keys were returned[/]');
	for (const k of keys) {
		const marks: string[] = [];
		if (k.from) marks.push(`[text2]from ${k.from}[/]`);
		if (k.trackKid) marks.push('[green]*[/]');
		tree.add(new Text(`[text2]*[/]${marks.length ? ' ' + marks.join(' ') : ''}`, { overflow: 'fold' }));
	}
	return tree;
}


export function selectionCancelled() {
	console_.print(new Padding(':x: Selection Cancelled...', [0, 5, 1, 5]));
}

export function downloadCancelled() {
	console_.print(new Padding(':x: Download Cancelled...', [0, 5, 1, 5]));
}

// "Processed all titles in 1:23" footer
export function elapsedFooter(label: string, seconds: number) {
	console_.print(new Padding(`${label} [progress.elapsed]${formatDuration(seconds)}[/]`, [0, 5, 1, 5]));
}

export type { LogLevel, RenderInput };
