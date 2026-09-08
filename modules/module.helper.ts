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
		const days = Math.floor(t / 86400);
		const hours = Math.floor((t % 86400) / 3600);
		const minutes = Math.floor(((t % 86400) % 3600) / 60);
		const seconds = +(t % 60).toFixed(0);
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

	static exec(
		pname: string,
		fpath: string,
		pargs: string,
		spc = false
	):
		| {
				isOk: true;
		  }
		| {
				isOk: false;
				err: Error & { code: number };
		  } {
		pargs = pargs ? ' ' + pargs : '';
		// `quiet` keeps shaka-packager / mkvmerge chatter off the terminal so the
		// live download view can stay on screen. Output is still captured and is
		// replayed on failure (or when --debug is set).
		const quiet = quietDefault();
		if (quiet) {
			console.debug(`> "${pname}"${pargs}`);
		} else {
			console.info(`\n> "${pname}"${pargs}${spc ? '\n' : ''}`);
		}
		try {
			const stdio = quiet ? 'pipe' : 'inherit';
			let out: Buffer | string | undefined;
			if (process.platform === 'win32') {
				out = childProcess.execSync('& ' + fpath + pargs, { stdio, shell: 'powershell.exe', windowsHide: true });
			} else {
				out = childProcess.execSync(fpath + pargs, { stdio });
			}
			if (quiet && out) {
				const text = out.toString().trim();
				if (text) console.debug(text);
			}
			return {
				isOk: true
			};
		} catch (er) {
			if (quiet) {
				// the failure output was swallowed - surface it now
				const e = er as { stdout?: Buffer; stderr?: Buffer };
				const dump = [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join('\n').trim();
				if (dump) console.error(dump);
			}
			const err = er as Error & { status: number };
			return {
				isOk: false,
				err: {
					...err,
					code: err.status
				}
			};
		}
	}
}
