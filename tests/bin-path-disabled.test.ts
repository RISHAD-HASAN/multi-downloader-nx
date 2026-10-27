import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// workingDir is frozen the moment module.working-dir is first imported, so point
// the run at a scratch directory before anything pulls in the config loader.
// That keeps this test away from the tracked config/ directory entirely.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-bin-disabled-'));
process.env.contentDirectory = temp;

const binDir = path.join(temp, 'binaries');
const emptyPathDir = path.join(temp, 'empty-path');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(emptyPathDir, { recursive: true });

const suffix = process.platform === 'win32' ? '.exe' : '';
const mp4decrypt = path.join(binDir, `mp4decrypt${suffix}`);
fs.writeFileSync(mp4decrypt, 'test');
fs.chmodSync(mp4decrypt, 0o755);

// `ffmpeg: ''` disables it explicitly, `mkvmerge:` parses as null and means the
// same thing, and `mp4decrypt` proves only blanked entries are switched off.
fs.mkdirSync(path.join(temp, 'config'), { recursive: true });
fs.writeFileSync(path.join(temp, 'config', 'bin-path.yml'), [`ffmpeg: ''`, 'mkvmerge:', `mp4decrypt: '${mp4decrypt}'`].join('\n') + '\n');

const names = ['PATH', 'BIN_PATH', 'BIN_DIR', 'FFMPEG_PATH', 'MKVMERGE_PATH', 'MP4DECRYPT_PATH', 'SHAKA_PACKAGER_PATH', 'FFMPEG', 'MKVMERGE'];
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

(async () => {
	try {
		// Nothing may resolve through the environment or PATH: only what the
		// config file points at can be found, so the assertions mean something.
		process.env.PATH = emptyPathDir;
		for (const name of names.slice(1)) delete process.env[name];

		// log initializes the shared config/logger cycle in the same order as the CLI.
		await import('../modules/log');
		const { loadBinCfg } = await import('../modules/module.cfg-loader');
		const found = await loadBinCfg();

		assert.equal(found.ffmpeg, undefined, 'an empty string must disable the binary, not fall back to the default');
		assert.equal(found.mkvmerge, undefined, 'a blank (null) entry must disable the binary');
		assert.equal(found.mp4decrypt, mp4decrypt, 'a binary with a real configured path still resolves');
		console.log('✓ empty and null bin-path entries disable the tool instead of reverting to the default');
	} finally {
		for (const name of names) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
		delete process.env.contentDirectory;
		fs.rmSync(temp, { recursive: true, force: true });
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
