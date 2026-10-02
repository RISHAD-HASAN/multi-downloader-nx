// build-in
import crypto from 'crypto';
import fs from 'fs/promises';
import fsp from 'fs';
import url from 'url';

import { console } from './log';
import { ProgressData } from '../@types/messageHandler';
import Helper from './module.helper';
import * as reqModule from './module.fetch';
import { Manifest } from 'm3u8-parser';
import { sessionOwns, trackProgress } from './module.download-ui';
import { describeError, networkHint } from './module.error';

const req = new reqModule.Req();

export type HLSCallback = (data: ProgressData) => unknown;

export type M3U8Json = {
	segments: Record<string, unknown>[];
	mediaSequence?: number;
};

type Segment = {
	uri: string;
	key: Key;
	byterange?: {
		offset: number;
		length: number;
	};
};

type Key = {
	uri: string;
	iv: number[];
};

export type HLSOptions = {
	m3u8json: M3U8Json | Partial<Manifest>;
	output?: string;
	threads?: number;
	retries?: number;
	offset?: number;
	baseurl?: string;
	skipInit?: boolean;
	timeout?: number;
	fsRetryTime?: number;
	override?: 'Y' | 'y' | 'N' | 'n' | 'C' | 'c';
	callback?: HLSCallback;
	// Row in the live download view that this stream should report into
	trackKey?: string;
};

type Data = {
	parts: {
		first: number;
		total: number;
		completed: number;
	};
	m3u8json: M3U8Json | Partial<Manifest>;
	outputFile: string;
	threads: number;
	retries: number;
	offset: number;
	baseurl?: string;
	skipInit?: boolean;
	keys: {
		[uri: string]: Buffer | string;
	};
	timeout: number;
	checkPartLength: boolean;
	isResume: boolean;
	bytesDownloaded: number;
	waitTime: number;
	callback?: HLSCallback;
	trackKey?: string;
	override?: string;
	dateStart: number;
};

// hls class
class hlsDownload {
	// Most recent part error, used to derive an actionable network hint
	private lastError: unknown;
	// In-flight key downloads, keyed by key URI (see fetchKey)
	private keyPromises = new Map<string, Promise<Buffer>>();
	private data: Data;
	constructor(options: HLSOptions) {
		// check playlist
		if (!options || !options.m3u8json || !options.m3u8json.segments || options.m3u8json.segments.length === 0) {
			throw new Error('Playlist is empty!');
		}
		// init options
		this.data = {
			parts: {
				first: options.m3u8json.mediaSequence || 0,
				total: options.m3u8json.segments.length,
				completed: 0
			},
			m3u8json: options.m3u8json,
			outputFile: options.output || 'stream.ts',
			threads: options.threads || 5,
			retries: options.retries || 10,
			offset: options.offset || 0,
			baseurl: options.baseurl,
			skipInit: options.skipInit,
			keys: {},
			timeout: options.timeout ? options.timeout : 60 * 1000,
			checkPartLength: false,
			isResume: options.offset ? options.offset > 0 : false,
			bytesDownloaded: 0,
			waitTime: options.fsRetryTime ?? 1000 * 5,
			callback: options.callback,
			trackKey: options.trackKey,
			override: options.override,
			dateStart: 0
		};
	}
	async download() {
		// set output
		const fn = this.data.outputFile;
		// try load resume file
		if (fsp.existsSync(fn) && fsp.existsSync(`${fn}.resume`) && this.data.offset < 1) {
			try {
				const stats = await fs.stat(`${fn}.resume`);
				const age = Date.now() - stats.mtimeMs;

				// Only resume download if data is not older than 24 hours
				if (age < 24 * 60 * 60 * 1000) {
					console.debug('Resume data found! Trying to resume...');
					const resumeData = JSON.parse(await fs.readFile(`${fn}.resume`, 'utf-8'));
					if (resumeData.total == this.data.m3u8json.segments?.length && resumeData.completed != resumeData.total && !isNaN(resumeData.completed)) {
						console.debug('Resume data is ok!');
						this.data.offset = resumeData.completed;
						this.data.isResume = true;
						// A crash can leave bytes on disk that the marker does not
						// vouch for; cut them so the parts that follow stay aligned.
						if (typeof resumeData.bytes == 'number' && resumeData.bytes >= 0) {
							const size = (await fs.stat(fn)).size;
							if (size != resumeData.bytes) {
								await fs.truncate(fn, resumeData.bytes);
								console.debug(`Trimmed ${size - resumeData.bytes} byte(s) written after the last resume marker`);
							}
						}
					} else {
						console.warn(' Resume data is wrong!');
						console.warn({
							resume: { total: resumeData.total, dled: resumeData.completed },
							current: { total: this.data.m3u8json.segments?.length }
						});
					}
				} else {
					console.warn('Resume data found, but too old! Redownloading everything...');
					try {
						await fs.unlink(fn);
						await fs.unlink(`${fn}.resume`);
					} catch (e) {
						console.error(e);
					}
				}
			} catch (e) {
				console.error('Resume failed, downloading will be not resumed!');
				console.error(e);
			}
		}
		// ask before rewrite file
		if (fsp.existsSync(`${fn}`) && !this.data.isResume) {
			let rwts = this.data.override ?? (await Helper.question(`[Q] File «${fn}» already exists! Rewrite? ([y]es/[N]o/[c]ontinue)`));
			rwts = rwts || 'N';
			if (['Y', 'y'].includes(rwts[0])) {
				console.debug(`Deleting «${fn}»...`);
				await fs.unlink(fn);
			} else if (['C', 'c'].includes(rwts[0])) {
				return { ok: true, parts: this.data.parts };
			} else {
				return { ok: false, parts: this.data.parts };
			}
		}
		// show output filename
		if (fsp.existsSync(fn) && this.data.isResume) {
			console.debug(`Adding content to «${fn}»...`);
		} else {
			console.debug(`Saving stream to «${fn}»...`);
		}
		// start time
		this.data.dateStart = Date.now();
		// Bytes already on disk (resumed prefix) and bytes covered by complete parts
		let startBytes = this.data.isResume ? (await fs.stat(fn)).size : 0;
		let committedBytes = startBytes;
		let segments = this.data.m3u8json.segments;
		// download init part
		if (segments?.[0].map && this.data.offset === 0 && !this.data.skipInit) {
			console.debug('Download and save init part...');
			const initSeg = segments[0].map as Segment;
			if (segments[0].key) {
				initSeg.key = segments[0].key as Key;
			}
			try {
				const initDl = await this.downloadPart(initSeg, 0);
				await fs.writeFile(fn, initDl.dec, { flag: 'a' });
				startBytes = (await fs.stat(fn)).size;
				committedBytes = startBytes;
				await fs.writeFile(
					`${fn}.resume`,
					JSON.stringify({
						completed: 0,
						total: this.data.m3u8json.segments?.length,
						bytes: committedBytes
					})
				);
				console.debug('Init part downloaded.');
			} catch (e: any) {
				console.error(`Part init download error:\n\t${e.message}`);
				return { ok: false, parts: this.data.parts };
			}
		} else if (segments?.[0].map && this.data.offset === 0 && this.data.skipInit) {
			console.warn('Skipping init part can lead to broken video!');
		}
		// resuming ...
		if (this.data.offset > 0) {
			segments = segments?.slice(this.data.offset);
			console.debug(`Resuming download from part ${this.data.offset + 1}...`);
			this.data.parts.completed = this.data.offset;
		}
		// dl process: a fixed worker pool drains the whole playlist and a single
		// ordered writer appends parts as soon as the gap in front of them is
		// filled, so a straggler never idles the other connections and disk
		// writes overlap the transfers instead of pausing them.
		const totalSeg = (segments?.length ?? 0) + this.data.offset; // Add the sliced length back so the resume data will be correct even if a resumed download fails
		let nextToWrite = this.data.offset;
		let nextIndex = 0;
		let errcnt = 0;
		let writeFailed = false;
		let lastReported = this.data.offset;
		const pendingParts = new Map<number, Buffer>();
		const handle = await fs.open(fn, 'a');
		// Raw bytes written to disk (used to continue after a short write)
		let writtenBytes = committedBytes;

		const writePart = async (buf: Buffer): Promise<boolean> => {
			let attempt = 0;
			let written = 0;
			while (attempt < 3) {
				try {
					while (written < buf.byteLength) {
						const { bytesWritten } = await handle.write(buf, written, buf.byteLength - written);
						if (bytesWritten < 1) throw new Error('short write');
						written += bytesWritten;
						writtenBytes += bytesWritten;
					}
					// The part is complete only now: the marker must never claim
					// bytes that a failed write left half-finished.
					committedBytes = writtenBytes;
					return true;
				} catch (err) {
					console.error(err);
					console.error(`Unable to write to file '${fn}' (Attempt ${attempt + 1}/3)`);
					console.info(`Waiting ${Math.round(this.data.waitTime / 1000)}s before retrying`);
					await new Promise<void>((resolve) => setTimeout(() => resolve(), this.data.waitTime));
				}
				attempt++;
			}
			console.error(`Unable to write content to '${fn}'.`);
			return false;
		};

		const reportProgress = async (force = false) => {
			if (!force && nextToWrite - lastReported < this.data.threads) return;
			lastReported = nextToWrite;
			this.data.parts.completed = nextToWrite;
			const data = extFn.getDownloadInfo(this.data.dateStart, nextToWrite, totalSeg, this.data.bytesDownloaded);
			await fs.writeFile(
				`${fn}.resume`,
				JSON.stringify({
					completed: nextToWrite,
					total: totalSeg,
					bytes: committedBytes
				})
			);
			function formatDLSpeedB(s: number) {
				if (s < 1000000) return `${(s / 1000).toFixed(2)} KB/s`;
				if (s < 1000000000) return `${(s / 1000000).toFixed(2)} MB/s`;
				return `${(s / 1000000000).toFixed(2)} GB/s`;
			}
			function formatDLSpeedBit(s: number) {
				if (s * 8 < 1000000) return `${((s * 8) / 1000).toFixed(2)} KBit/s`;
				if (s * 8 < 1000000000) return `${((s * 8) / 1000000).toFixed(2)} MBit/s`;
				return `${((s * 8) / 1000000000).toFixed(2)} GBit/s`;
			}
			if (sessionOwns(this.data.trackKey)) {
				// the live view renders progress; keep stdout free of per-chunk lines
				trackProgress(this.data.trackKey as string, {
					completed: nextToWrite,
					total: totalSeg,
					bytes: this.data.bytesDownloaded
				});
			} else {
				console.info(
					`${nextToWrite} of ${totalSeg} parts downloaded [${data.percent}%] (${Helper.formatTime(parseInt((data.time / 1000).toFixed(0)))} | ${formatDLSpeedB(data.downloadSpeed)} / ${formatDLSpeedBit(data.downloadSpeed)})`
				);
			}
			if (this.data.callback)
				this.data.callback({
					total: this.data.parts.total,
					cur: nextToWrite,
					bytes: this.data.bytesDownloaded,
					percent: data.percent,
					time: data.time,
					downloadSpeed: data.downloadSpeed
				});
		};

		// Append every part whose turn has come; progress follows what is on disk.
		const flushParts = async (): Promise<boolean> => {
			while (pendingParts.has(nextToWrite)) {
				const buf = pendingParts.get(nextToWrite) as Buffer;
				pendingParts.delete(nextToWrite);
				if (!(await writePart(buf))) return false;
				nextToWrite++;
				if (this.data.trackKey) {
					// feed the live download view one tick per part, not per chunk
					trackProgress(this.data.trackKey, { completed: nextToWrite, bytes: this.data.bytesDownloaded });
				}
				await reportProgress();
			}
			return true;
		};

		const worker = async () => {
			while (errcnt === 0 && !writeFailed) {
				const i = nextIndex++;
				if (i >= (segments?.length ?? 0)) return;
				const curp = segments?.[i] as Segment;
				const partIndex = i + this.data.offset;
				let retriesLeft = this.data.retries;
				while (retriesLeft > 0) {
					try {
						const r = await this.downloadPart(curp, partIndex);
						pendingParts.set(partIndex, r.dec);
						if (!(await flushParts())) {
							writeFailed = true;
							return;
						}
						break;
					} catch (error: any) {
						this.lastError = error;
						retriesLeft--;
						console.warn(`Retrying part ${error.p + 1} (${this.data.retries - retriesLeft}/${this.data.retries})`);
						if (retriesLeft > 0) {
							await new Promise((resolve) => setTimeout(resolve, 1000));
						} else {
							console.error(`Part ${error.p + 1} download failed after ${this.data.retries} retries: ${describeError(error)}`);
							errcnt++;
						}
					}
				}
			}
		};

		// Parallelized part download with retry logic and optional concurrency limit
		const workers: Promise<void>[] = [];
		for (let i = 0; i < Math.max(1, this.data.threads); i++) {
			workers.push(worker());
		}
		await Promise.all(workers);
		await handle.close();

		// catch error: the file is a contiguous prefix, so a resume marker that
		// names exactly that prefix makes the next run pick up where this one died
		if (errcnt > 0 || writeFailed) {
			await reportProgress(true);
			if (errcnt > 0) console.error(`${errcnt} parts not downloaded`);
			const hint = this.lastError ? networkHint(this.lastError) : undefined;
			if (hint) console.error(hint);
			return { ok: false, parts: this.data.parts };
		}
		// final progress + resume marker, then the marker goes away with the finished file
		await reportProgress(true);
		// return result
		await fs.unlink(`${fn}.resume`);
		return { ok: true, parts: this.data.parts };
	}
	async downloadPart(seg: Segment, partIndex: number) {
		const sURI = extFn.getURI(seg.uri, this.data.baseurl);
		let decipher, part, dec;
		const p = partIndex;
		try {
			if (seg.key != undefined) {
				decipher = await this.getKey(seg.key, p);
			}
			part = await extFn.getData(
				p,
				sURI,
				{
					...(seg.byterange
						? {
								Range: `bytes=${seg.byterange.offset}-${seg.byterange.offset + seg.byterange.length - 1}`
							}
						: {})
				},
				0,
				false
			);
			if (!part) throw new Error('no response body (see the warning above for the transport error)');
			// if (this.data.checkPartLength) {
			//   this.data.checkPartLength = false;
			//   console.warn(`Part ${segIndex + segOffset + 1}: can't check parts size!`);
			// }
			if (decipher == undefined) {
				this.data.bytesDownloaded += Buffer.from(part).byteLength;
				return { dec: Buffer.from(part), p };
			}
			dec = decipher.update(Buffer.from(part));
			dec = Buffer.concat([dec, decipher.final()]);
			this.data.bytesDownloaded += dec.byteLength;
		} catch (error: any) {
			error.p = p;
			throw error;
		}
		return { dec, p };
	}
	// One fetch per key URI: every part pointing at the same key shares the
	// in-flight download instead of hitting the key server once per part.
	private fetchKey(kURI: string, partIndex: number): Promise<Buffer> {
		const cached = this.data.keys[kURI];
		if (cached) return Promise.resolve(Buffer.from(cached));
		const inflight = this.keyPromises.get(kURI);
		if (inflight) return inflight;
		const promise = (async () => {
			const rkey = await extFn.getData(partIndex, kURI, {}, 0, true);
			if (!rkey) throw new Error('no response body (see the warning above for the transport error)');
			return Buffer.from(rkey);
		})();
		this.keyPromises.set(kURI, promise);
		return promise.then(
			(key) => {
				this.data.keys[kURI] = key;
				this.keyPromises.delete(kURI);
				return key;
			},
			(error) => {
				// Let the next part retry the key instead of poisoning the playlist
				this.keyPromises.delete(kURI);
				throw error;
			}
		);
	}
	async getKey(key: Key, partIndex: number) {
		const kURI = extFn.getURI(key.uri, this.data.baseurl);
		const p = partIndex;
		let keyData: Buffer | undefined = this.data.keys[kURI] ? Buffer.from(this.data.keys[kURI]) : undefined;
		if (!keyData) {
			try {
				keyData = await this.fetchKey(kURI, partIndex);
			} catch (error: any) {
				error.p = p;
				throw error;
			}
		}
		// get ivs: without an explicit IV the HLS spec uses the media sequence
		// number of the part, so the index must be absolute (resume included)
		const iv = Buffer.alloc(16);
		const ivs = key.iv ? key.iv : [0, 0, 0, p + 1];
		for (let i = 0; i < ivs.length; i++) {
			iv.writeUInt32BE(ivs[i], i * 4);
		}
		if (!keyData) throw new Error('Missing decryption key');
		return crypto.createDecipheriv('aes-128-cbc', keyData, iv);
	}
}

const extFn = {
	getURI: (uri: string, baseurl?: string) => {
		const httpURI = /^https{0,1}:/.test(uri);
		if (!baseurl && !httpURI) {
			throw new Error('No base and not http(s) uri');
		} else if (httpURI) {
			return uri;
		}
		return baseurl + uri;
	},
	getDownloadInfo: (dateStart: number, partsDL: number, partsTotal: number, downloadedBytes: number) => {
		const dateElapsed = Date.now() - dateStart;
		const percentFxd = parseInt(((partsDL / partsTotal) * 100).toFixed());
		const percent = percentFxd < 100 ? percentFxd : partsTotal == partsDL ? 100 : 99;
		const revParts = dateElapsed * (partsTotal / partsDL - 1);
		const downloadSpeed = downloadedBytes / (dateElapsed / 1000); //Bytes per second
		return { percent, time: revParts, downloadSpeed };
	},
	getData: async (partIndex: number, uri: string, headers: Record<string, string>, segOffset: number, isKey: boolean) => {
		// get file if uri is local
		if (uri.startsWith('file://')) {
			const buffer = await fs.readFile(url.fileURLToPath(uri));
			return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		}

		const partReq = await req.getData(uri, {
			method: 'GET',
			headers: headers,
			silent: true
		});

		if (!partReq.res || !partReq.ok) {
			const partType = isKey ? 'Key' : 'Part';
			const partIndx = partIndex + 1 + segOffset;
			// transport failures carry no .res, so fall back to the unwrapped cause
			const reason = partReq.error?.res?.statusText || describeError(partReq.error);
			console.warn(`${partType} ${partIndx}: ${reason}`);
			return;
		}

		return await partReq.res.arrayBuffer();
	}
};

export default hlsDownload;
