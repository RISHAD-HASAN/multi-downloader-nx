// Helper functions
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import childProcess from 'child_process';
import { console_ as richConsole } from './module.console';
import { console } from './log';

// Subprocess output is hidden unless the user asked for --debug
const quietDefault = () => richConsole.level !== 'debug' && process.env.isGUI !== 'true';

export default class Helper {
	static async question(q: string) {
		const rl = readline.createInterface({ input, output });
		const a = await rl.question(q);
		rl.close();
		return a;
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
