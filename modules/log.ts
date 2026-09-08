// Logger. Drop-in for the log4js one that used to live here: same
// console.info/warn/error/debug surface, but rendered through RichConsole.
// logs/latest.log still gets plain text.

import fs from 'fs';
import path from 'path';
import { workingDir } from './module.cfg-loader';
import log4js from 'log4js';
import { console_ as rich } from './module.console';
import { setTheme, stripMarkup, theme, type LogLevel } from './module.rich';

const logFolder = path.join(workingDir, 'logs');
const latest = path.join(logFolder, 'latest.log');

const makeLogFolder = () => {
	if (!fs.existsSync(logFolder)) fs.mkdirSync(logFolder, { recursive: true });
	if (fs.existsSync(latest)) {
		const stats = fs.statSync(latest);
		fs.renameSync(latest, path.join(logFolder, `${stats.mtimeMs}.log`));
	}
};

// File-only log4js instance; the console half is handled by RichConsole.
const makeFileLogger = () => {
	makeLogFolder();
	log4js.configure({
		appenders: {
			file: {
				type: 'file',
				filename: latest,
				layout: {
					type: 'pattern',
					pattern: '%x{info}%m',
					tokens: {
						info: (ev) => (ev.level.levelStr === 'INFO' ? '' : `[${ev.level.levelStr}] `)
					}
				}
			}
		},
		categories: { default: { appenders: ['file'], level: 'all' } }
	});
	return log4js.getLogger();
};

const fileLogger = makeFileLogger();

rich.addSink((level: LogLevel, text: string) => {
	switch (level) {
		case 'debug':
			fileLogger.debug(text);
			break;
		case 'warning':
			fileLogger.warn(text);
			break;
		case 'error':
		case 'critical':
			fileLogger.error(text);
			break;
		default:
			fileLogger.info(text);
	}
});

// The GUI pipes stdout through its own renderer, so drop colour + indentation.
const isGUI = process.env.isGUI === 'true';
if (isGUI || process.env.NO_COLOR || process.env.ANIDL_NO_COLOR) {
	theme.enabled = false;
	rich.logPadding = 0;
} else {
	setTheme(process.env.ANIDL_THEME);
}

if (process.env.ANIDL_LOG_LEVEL) {
	const lvl = process.env.ANIDL_LOG_LEVEL.toLowerCase();
	if (['debug', 'info', 'warning', 'error', 'critical'].includes(lvl)) rich.level = lvl as LogLevel;
}

// Redirect stray `global.console.*` calls into the rich console too
const patchGlobalConsole = () => {
	const g = global.console as any;
	g.log = (...d: any[]) => rich.info(...d);
	g.info = (...d: any[]) => rich.info(...d);
	g.warn = (...d: any[]) => rich.warn(...d);
	g.error = (...d: any[]) => rich.error(...d);
	g.debug = (...d: any[]) => rich.debug(...d);
};
patchGlobalConsole();

// node:sqlite (used by the SQLite key vault) emits an ExperimentalWarning on
// every run; it is expected and would otherwise surface as an ERROR line.
// Node prints warnings from its own default listener, so it has to be replaced.
const defaultWarningListeners = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
	if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
	if (defaultWarningListeners.length) {
		for (const l of defaultWarningListeners) l(w);
		return;
	}
	rich.warn(`${w.name}: ${w.message}`);
});

/**
 * Backwards-compatible logger object. `console.info(...)` etc. behave exactly
 * as before from a caller's point of view, but now render with markup support.
 */
export const console = Object.assign(rich, {
	// log4js parity aliases used in a few places
	trace: (...a: any[]) => rich.debug(...a),
	fatal: (...a: any[]) => rich.critical(...a),
	// Plain, unstyled output (bypasses markup) - for raw dumps
	raw: (s: string) => rich.write(stripMarkup(s) + '\n')
});

export { rich };
export default console;
