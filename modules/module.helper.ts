// Helper functions
import fs from 'fs';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import childProcess from 'child_process';
import { console_ as richConsole } from './module.console';
import { console } from './log';

// Subprocess output is hidden unless the user asked for --debug
const quietDefault = () => richConsole.level !== 'debug' && process.env.isGUI !== 'true';

export type ExecResult =
	| {
			isOk: true;
	  }
	| {
			isOk: false;
			err: Error & { code: number };
	  };

export default class Helper {
	/** Longest subprocess output kept for the failure report (per stream). */
	private static readonly maxCapturedOutput = 512 * 1024;

	/** Serializes interactive prompts (see question). */
	private static promptQueue: Promise<unknown> = Promise.resolve();

	/** Non-blocking DRM subprocess. Never log arguments or child output containing keys. */
	static decrypt(binary: string, args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = childProcess.spawn(binary, args, { stdio: 'ignore', windowsHide: true });
			child.once('error', () => reject(new Error('Unable to start decryption executable')));
			child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`Decryption failed with exit code ${code}`))));
		});
	}

	/**
	 * Same contract as exec(), but the child runs in the background so the event
	 * loop keeps serving downloads while it works.
	 */
	static execAsync(pname: string, fpath: string, pargs: string | string[], spc = false): Promise<ExecResult> {
		const quiet = quietDefault();
		return new Promise((resolve) => {
			const argv = Array.isArray(pargs) ? pargs : Helper.splitArguments(pargs);
			const command = fpath.trim().replace(/^["']|["']$/g, '');
			const display = argv.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ');
			if (quiet) console.debug(`> "${pname}" ${display}`);
			else console.info(`\n> "${pname}" ${display}${spc ? '\n' : ''}`);
			const child = childProcess.spawn(command, argv, { stdio: quiet ? 'pipe' : 'inherit', windowsHide: true });
			let stdout = '';
			let stderr = '';
			if (quiet) {
				// keep the tail only: a chatty decrypt must not buffer a whole run
				const capture = (current: string, data: Buffer) => (current + data).slice(-Helper.maxCapturedOutput);
				child.stdout?.on('data', (data) => (stdout = capture(stdout, data.toString())));
				child.stderr?.on('data', (data) => (stderr = capture(stderr, data.toString())));
			}
			child.once('error', (error) => {
				resolve({ isOk: false, err: Object.assign(error as Error, { code: 1 }) });
			});
			child.once('close', (code) => {
				if (code === 0) return resolve({ isOk: true });
				if (quiet) {
					// The failure output was swallowed - surface it now.
					const dump = [stdout, stderr].join('\n').trim();
					if (dump) console.error(dump);
				}
				resolve({
					isOk: false,
					err: Object.assign(new Error(`${pname} exited with code ${code}`), { code: code ?? 1 })
				});
			});
		});
	}

	/**
	 * Rename a finished file into place, copying only across volumes.
	 */
	static moveFile(from: string, to: string): void {
		try {
			fs.renameSync(from, to);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
			fs.copyFileSync(from, to);
			fs.unlinkSync(from);
		}
	}

	/**
	 * Prompts take turns: two tracks can find an existing file at the same time,
	 * and two readline interfaces would fight over stdin.
	 */
	static question(q: string): Promise<string> {
		const ask = Helper.promptQueue.then(async () => {
			const rl = readline.createInterface({ input, output });
			try {
				return await rl.question(q);
			} finally {
				rl.close();
			}
		});
		Helper.promptQueue = ask.catch(() => undefined);
		return ask;
	}
	static formatTime(t: number) {
		const totalSeconds = Math.round(t);
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const daysS = days > 0 ? `${days}d` : '';
		const hoursS = daysS || hours ? `${daysS}${daysS && hours < 10 ? '0' : ''}${hours}h` : '';
		const minutesS = minutes || hoursS ? `${hoursS}${hoursS && minutes < 10 ? '0' : ''}${minutes}m` : '';
		const secondsS = `${minutesS}${minutesS && seconds < 10 ? '0' : ''}${seconds}s`;
		return secondsS;
	}

	static cleanupFilename(n: string) {
		/* eslint-disable no-useless-escape, no-control-regex */
		// Smart Replacer
		const rep: Record<string, string> = {
			'/': '⧸',
			'\\': '⧹',
			':': '：',
			'*': '∗',
			'?': '？',
			'"': "'",
			'<': '‹',
			'>': '›'
		};
		n = n.replace(/[\/\\:\*\?"<>\|]/g, (ch) => rep[ch] || '_');

		// Old Replacer
		const controlRe = /[\x00-\x1f\x80-\x9f]/g;
		const reservedRe = /^\.+$/;
		const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
		const windowsTrailingRe = /[\. ]+$/;

		return n.replace(controlRe, '_').replace(reservedRe, '_').replace(windowsReservedRe, '_').replace(windowsTrailingRe, '_');
	}

	private static splitArguments(input: string): string[] {
		const argv: string[] = [];
		let current = '';
		let quote: '"' | "'" | undefined;
		let started = false;
		for (const char of input) {
			if (char === quote) {
				quote = undefined;
			} else if ((char === '"' || char === "'") && !quote) {
				quote = char;
				started = true;
			} else if (/\s/.test(char) && !quote) {
				if (started) argv.push(current);
				current = '';
				started = false;
			} else {
				current += char;
				started = true;
			}
		}
		if (quote) throw new Error('Unterminated quote in subprocess arguments');
		if (started) argv.push(current);
		return argv;
	}

	static exec(
		pname: string,
		fpath: string,
		pargs: string | string[],
		spc = false
	):
		| {
				isOk: true;
		  }
		| {
				isOk: false;
				err: Error & { code: number };
		  } {
		// `quiet` keeps shaka-packager / mkvmerge chatter off the terminal so the
		// live download view can stay on screen. Output is still captured and is
		// replayed on failure (or when --debug is set).
		const quiet = quietDefault();
		try {
			// The merger still produces command-line strings; tokenize quotes without
			// passing the resulting arguments through a shell (including on Windows).
			const argv = Array.isArray(pargs) ? pargs : Helper.splitArguments(pargs);
			const command = fpath.trim().replace(/^["']|["']$/g, '');
			const display = argv.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ');
			if (quiet) console.debug(`> "${pname}" ${display}`);
			else console.info(`\n> "${pname}" ${display}${spc ? '\n' : ''}`);
			const stdio = quiet ? 'pipe' : 'inherit';
			const out = childProcess.execFileSync(command, argv, { stdio, windowsHide: true });
			if (quiet && out) {
				const text = out.toString().trim();
				if (text) console.debug(text);
			}
			return { isOk: true };
		} catch (er) {
			if (quiet) {
				// The failure output was swallowed - surface it now.
				const e = er as { stdout?: Buffer; stderr?: Buffer };
				const dump = [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join('\n').trim();
				if (dump) console.error(dump);
			}
			const err = er as Error & { status?: number };
			return {
				isOk: false,
				err: Object.assign(err, { code: err.status ?? 1 })
			};
		}
	}
}
