// DASH track bookkeeping for Crunchyroll. Video and each audio dub go to separate
// files, so they transfer concurrently; the registry tracks per-track state,
// records which dubs completed (the DUAL filename tag), and reports the first
// error once every sibling transfer has settled.

export type DashTransferKind = 'video' | 'audio';

export type DashTransferState = 'active' | 'completed' | 'failed';

export interface DashTransferInfo {
	// `video|<mediaId>` or `audio-eng|<mediaId>`
	key: string;
	kind: DashTransferKind;
	// Episode/version GUID the transfer belongs to
	mediaId: string;
	langCode?: string;
	state: DashTransferState;
	error?: string;
	startedAt: number;
	finishedAt?: number;
}

export interface DashTransferTask {
	key: string;
	kind: DashTransferKind;
	mediaId: string;
	langCode?: string;
	task: () => Promise<void>;
}

export class DashTransferRegistry {
	private transfers = new Map<string, DashTransferInfo>();
	private inflight = new Map<string, Promise<void>>();

	// Every transfer seen since the last clear()
	public list(): DashTransferInfo[] {
		return [...this.transfers.values()];
	}

	public get(key: string): DashTransferInfo | undefined {
		return this.transfers.get(key);
	}

	// Still running
	public pending(): DashTransferInfo[] {
		return this.list().filter((info) => this.inflight.has(info.key));
	}

	public hasPending(): boolean {
		return this.inflight.size > 0;
	}

	// Languages of the dubs that finished; a failed dub must not count towards
	// the DUAL tag.
	public completedAudioLangCodes(mediaId?: string): string[] {
		const codes = this.list()
			.filter((info) => info.kind === 'audio' && info.state === 'completed' && (mediaId === undefined || info.mediaId === mediaId))
			.map((info) => info.langCode)
			.filter((code): code is string => Boolean(code));
		return [...new Set(codes)];
	}

	// Run one transfer, tracking its state. Rejects with the task error.
	public run(entry: DashTransferTask): Promise<void> {
		const info: DashTransferInfo = {
			key: entry.key,
			kind: entry.kind,
			mediaId: entry.mediaId,
			langCode: entry.langCode,
			state: 'active',
			startedAt: Date.now()
		};
		this.transfers.set(entry.key, info);
		const promise = (async () => {
			try {
				await entry.task();
				info.state = 'completed';
			} catch (error) {
				info.state = 'failed';
				info.error = error instanceof Error ? error.message : String(error);
				throw error;
			} finally {
				info.finishedAt = Date.now();
				this.inflight.delete(entry.key);
			}
		})();
		this.inflight.set(entry.key, promise);
		return promise;
	}

	// Start every transfer at once, wait for all of them to settle, then rethrow
	// the first failure: one dead track aborts the episode without abandoning a
	// sibling that is still writing to disk.
	public async runAll(entries: DashTransferTask[]): Promise<void> {
		if (entries.length === 0) return;
		const settled = await Promise.allSettled(entries.map((entry) => this.run(entry)));
		const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failure) throw failure.reason;
	}

	// Drop bookkeeping for one episode, or for all of them when no id is given
	public clear(mediaId?: string): void {
		for (const [key, info] of this.transfers) {
			if (mediaId === undefined || info.mediaId === mediaId) this.transfers.delete(key);
		}
	}
}

// The bits of a downloaded-file entry the audio tag is derived from
type TaggedFile = {
	type: string;
	lang?: { code: string };
};

// The ${audio} filename variable
type AudioTagVariable = {
	name: string;
	type: string;
	replaceWith: string | number;
};

// Distinct audio languages that finished downloading. DASH episodes produce one
// Audio file per dub; the HLS fallback muxes audio into the video, so distinct
// Video languages stand in when there are no Audio files.
export const completedAudioLanguages = (files: TaggedFile[]): string[] => {
	const audio = files.filter((file) => file.type === 'Audio' && file.lang?.code);
	const source = audio.length > 0 ? audio : files.filter((file) => file.type === 'Video' && file.lang?.code);
	return [...new Set(source.map((file) => file.lang!.code))];
};

// DUAL only when more than one dub completed: a failed second dub must not leave
// the tag in the final filename.
export const actualAudioTag = (files: TaggedFile[]): string => (completedAudioLanguages(files).length > 1 ? 'DUAL.' : '');

// `${audio}` is substituted only when the filename template asks for it, so a
// template without it has nowhere to put the tag.
export const templateHasAudioTag = (template: string | undefined): boolean => /\$\{audio\}/.test(template ?? '');

// Rewrite the ${audio} variable in place, seeding one when the template asks for
// it but the download path never created it. Returns true when the variable list
// changed, i.e. the caller has to rebuild the filename.
export const applyActualAudioTag = (variables: AudioTagVariable[], files: TaggedFile[], template?: string): boolean => {
	const tag = actualAudioTag(files);
	let changed = false;
	let seeded = false;
	for (const variable of variables) {
		if (variable.name !== 'audio') continue;
		seeded = true;
		if (variable.type === 'string' && variable.replaceWith !== tag) {
			variable.replaceWith = tag;
			changed = true;
		}
	}
	if (!seeded && templateHasAudioTag(template)) {
		variables.push({ name: 'audio', type: 'string', replaceWith: tag });
		changed = true;
	}
	return changed;
};

// One-line report of how the DUAL tag turned out, so a skipped tag is never a
// mystery. Returns nothing for a single dub that never asked for the tag.
export const audioTagNotice = (files: TaggedFile[], template: string | undefined, requestedDual: boolean): { level: 'info' | 'warn'; message: string } | undefined => {
	const langs = completedAudioLanguages(files);
	if (langs.length > 1) {
		return templateHasAudioTag(template)
			? { level: 'info', message: `Audio: ${langs.join(' + ')} - DUAL tag added to the filename` }
			: {
					level: 'warn',
					message: `Audio: ${langs.join(' + ')} - DUAL tag skipped, the fileName template has no \${audio} variable; add \${audio} to --fileName or config/cli-defaults.yml`
				};
	}
	if (requestedDual) return { level: 'info', message: `Audio: ${langs.join(' + ') || 'none'} - only one dub completed, no DUAL tag` };
	return undefined;
};
