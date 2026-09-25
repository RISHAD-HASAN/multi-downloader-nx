import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// log initializes the shared config/logger cycle in the same order as the CLI.
import '../modules/log';
import { getEnv, loadBinCfg, resolveEnv } from '../modules/module.cfg-loader';

(async () => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-bin-test-'));
	const binDir = path.join(temp, 'binaries');
	const pathDir = path.join(temp, 'path-entry');
	const nestedDir = path.join(pathDir, 'bin');
	fs.mkdirSync(binDir, { recursive: true });
	fs.mkdirSync(nestedDir, { recursive: true });
	const suffix = process.platform === 'win32' ? '.exe' : '';
	const ffmpeg = path.join(binDir, `ffmpeg${suffix}`);
	const mkvmerge = path.join(binDir, `mkvmerge${suffix}`);
	const shaka = path.join(nestedDir, `shaka-packager${suffix}`);
	for (const file of [ffmpeg, mkvmerge, shaka]) {
		fs.writeFileSync(file, 'test');
		fs.chmodSync(file, 0o755);
	}

	const names = ['FFMPEG_PATH', 'BIN_DIR', 'PATH'];
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	try {
		process.env.FFMPEG_PATH = ffmpeg;
		process.env.BIN_DIR = binDir;
		process.env.PATH = pathDir;
		assert.equal(getEnv('ffmpeg_path'), ffmpeg, 'env lookup should be case-insensitive');
		assert.equal(resolveEnv('$FFMPEG_PATH'), ffmpeg);
		const found = await loadBinCfg();
		assert.equal(found.ffmpeg, ffmpeg, 'direct environment override should beat bin-path.yml');
		assert.equal(found.mkvmerge, mkvmerge, 'BIN_DIR should find the default binary when the configured name is missing');
		assert.equal(found.shaka, shaka, 'PATH/bin should be searched when no direct binary was found');
		console.log('✓ environment overrides, BIN_DIR and PATH/bin discovery');
	} finally {
		for (const name of names) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
		fs.rmSync(temp, { recursive: true, force: true });
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
