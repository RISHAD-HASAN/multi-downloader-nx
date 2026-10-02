import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Import service modules with a valid CLI invocation: Req's constructor parses
// argv, and tests must never reach the network or require account credentials.
(async () => {
	const savedArgs = process.argv;
	process.argv = [...savedArgs, '--service', 'crunchy'];
	try {
		await import('../modules/log'); // initialize the config/logger cycle first
		const [{ default: Crunchy }, { default: ADN }, { default: Hidive }] = await Promise.all([import('../crunchy'), import('../adn'), import('../hidive')]);
		const neverDownload = () => {
			throw new Error('format listing must not mux or download');
		};

		const crunchy: any = Object.create(Crunchy.prototype);
		crunchy.downloadMediaList = async () => ({ data: [], fileName: '', error: false });
		crunchy.muxStreams = neverDownload;
		assert.equal(await crunchy.downloadEpisode({ seasonID: 'TEST', e: '1' }, { listFormats: true }), true);

		const adn: any = Object.create(ADN.prototype);
		adn.downloadEpisode = async () => ({ data: [], fileName: '', error: false });
		adn.muxStreams = neverDownload;
		assert.equal((await adn.getEpisode({ id: 1 }, { F: true })).isOk, true);

		const hidive: any = Object.create(Hidive.prototype);
		hidive.cfg = { bin: { ffmpeg: '/unused' } };
		const formats = await hidive.downloadMPD(
			{ cdn: { video: [{ bandwidth: 2_000_000, quality: { width: 1280, height: 720 }, segments: [] }], audio: [{ bandwidth: 128_000, segments: [] }] } },
			[],
			{ title: 'Test', seasonTitle: 'Test', seriesTitle: 'Test', episodeInformation: { seasonNumber: 1, episodeNumber: 1 } },
			{ F: true, x: 1, q: 0 }
		);
		assert.deepEqual(formats, { data: [], fileName: '', error: false });
		const crunchySource = fs.readFileSync(path.join(__dirname, '..', 'crunchy.ts'), 'utf8');
		assert.ok(crunchySource.includes('if (!options.listFormats && !options.F && !this.cdmAvailable()'), 'format listing should work without a CDM');
		assert.ok(crunchySource.includes('protected cdmAvailable(): boolean'), 'the CDM check must stay overridable so tests and dry runs do not need a CDM');
		assert.ok(crunchySource.includes('if (!options.listFormats && !options.F && !this.cfg.bin.mp4decrypt'), 'format listing should work without a decryptor');
		console.log('✓ format listing skips mux/archive in Crunchyroll and ADN, and bypasses CDM checks');

		// Transfer/decrypt wiring: audio must not queue behind the whole video,
		// decryption must not block the event loop, and a finished track must be
		// renamed into place instead of being copied a second time.
		const hidiveSource = fs.readFileSync(path.join(__dirname, '..', 'hidive.ts'), 'utf8');
		const mergerSource = fs.readFileSync(path.join(__dirname, '..', 'modules', 'module.merger.ts'), 'utf8');
		assert.ok(hidiveSource.includes('const videoJob = (async () => {'), 'HIDIVE video transfer must run as its own job');
		assert.ok(hidiveSource.includes('await Promise.all([videoJob, audioJob]);'), 'HIDIVE audio must transfer while the video is still running');
		assert.ok(!hidiveSource.includes('const decryptVideo = Helper.exec('), 'HIDIVE decryption must not block the event loop');
		assert.ok(hidiveSource.includes('await Helper.execAsync('), 'HIDIVE must use the background subprocess runner');
		assert.ok(hidiveSource.includes('Helper.moveFile('), 'HIDIVE must rename finished tracks instead of copying them');
		assert.ok(crunchySource.includes('Helper.moveFile(output, destination);'), 'Crunchyroll must rename decrypted tracks instead of copying them');
		assert.ok(mergerSource.includes('await Helper.execAsync(type'), 'muxing must not block the event loop');
		console.log('✓ transfers run concurrently and finished tracks are renamed, not copied');

		const cms = { bucket: '/test', policy: 'test', signature: 'test', key_pair_id: 'test' };
		const json = (value: unknown) => ({ ok: true, res: new Response(JSON.stringify(value)) });
		const failed = { ok: false, res: new Response(null, { status: 403 }) };
		crunchy.cmsToken = { cms };
		crunchy.token = { access_token: 'test' };
		crunchy.locale = 'en-US';
		crunchy.logObject = async () => {};
		const calls: string[] = [];
		crunchy.req = {
			getData: async (url: string, opts: { silent?: boolean }) => {
				calls.push(url);
				if (url.includes('/seasons/TEST?')) return json({ data: [{}] });
				if (url.includes('/cms/v2/test/episodes?')) {
					assert.equal(opts.silent, true);
					return failed;
				}
				if (url.includes('/seasons/TEST/episodes?')) return json({ total: 0, data: [] });
				if (url.includes('/cms/v2/test/objects/')) {
					assert.equal(opts.silent, true);
					return failed;
				}
				if (url.includes('/content/v2/cms/objects/')) return json({ total: 0, data: [] });
				throw new Error(`Unexpected URL: ${url}`);
			}
		};
		const season = await crunchy.getSeasonById('TEST', 2, undefined, false, false);
		assert.deepEqual(season, { isOk: true, value: [] });
		assert.ok(calls.some((url) => url.includes('/cms/v2/test/episodes?')));
		assert.ok(calls.some((url) => url.includes('/seasons/TEST/episodes?')));
		assert.deepEqual(await crunchy.getObjectById('G12345678', true), { total: 0, data: [], meta: {} });
		assert.ok(calls.some((url) => url.includes('/content/v2/cms/objects/')));
		console.log('✓ signed CMS 403 falls back to the content API for episodes and objects');

		// The public episode endpoint may fail too; a healthy CMS result still works.
		crunchy.req.getData = async (url: string) => {
			if (url.includes('/seasons/TEST?')) return json({ data: [{}] });
			if (url.includes('/cms/v2/test/episodes?')) return json({ total: 0, items: [] });
			return failed;
		};
		assert.deepEqual(await crunchy.getSeasonById('TEST', 2, undefined, false, false), { isOk: true, value: [] });
		console.log('✓ public API 403 falls back to signed CMS when it remains available');

		crunchy.req.getData = async (url: string) => {
			if (url.includes('/seasons/TEST?')) return json({ data: [{ id: 'TEST' }] });
			if (url.includes('/cms/v2/test/episodes?')) return failed;
			if (url.includes('/seasons/TEST/episodes?')) return json({ total: 1, data: [{ id: 'EPISODE' }] });
			throw new Error(`Unexpected URL: ${url}`);
		};
		assert.equal((await crunchy.getSeasonDataById({ id: 'TEST' }))?.data[0].id, 'EPISODE');
		console.log('✓ season-data listing also accepts a public API result when signed CMS returns 403');

		const { default: Helper } = await import('../modules/module.helper');
		const { default: parseFileName } = await import('../modules/module.filename');
		assert.equal(Helper.formatTime(119.5), '2m00s');
		const vars = [{ name: 'title', type: 'string', replaceWith: 'Original' }] as Parameters<typeof parseFileName>[1];
		assert.deepEqual(parseFileName('${title}', vars, 2, ["title='Overridden'"]), ['Overridden']);
		assert.deepEqual(parseFileName('${title}', vars, 2, []), ['Original']);
		assert.equal(vars[0].replaceWith, 'Original');
		assert.match(adn.generateRandomString(17), /^[0-9a-f]{17}$/);
		assert.deepEqual(adn.parseCookies('ok=hello%20world; bad=%GG; extra=a=b'), { ok: 'hello world', bad: '%GG', extra: 'a=b' });
		console.log('✓ filename overrides are isolated, timestamps round correctly, and ADN tolerates malformed cookies');

		const execTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-exec-test-'));
		try {
			const output = path.join(execTemp, 'out with spaces.txt');
			const marker = path.join(execTemp, 'injected.txt');
			const script = "require('node:fs').writeFileSync(process.argv[1], process.argv[2])";
			const payload = `$(touch ${marker})`;
			assert.equal(Helper.exec('node', `"${process.execPath}"`, `-e "${script}" "${output}" "${payload}"`).isOk, true);
			assert.equal(fs.readFileSync(output, 'utf8'), payload);
			assert.equal(fs.existsSync(marker), false, 'subprocess arguments must not be evaluated by a shell');
			assert.equal(Helper.exec('node', process.execPath, ['-e', script, output, 'array argument']).isOk, true);
			assert.equal(fs.readFileSync(output, 'utf8'), 'array argument');

			// The background runner keeps the same contract: the event loop is
			// free while the child works, a failure still reports its exit code,
			// and an unspawnable binary resolves instead of throwing.
			assert.equal((await Helper.execAsync('node', process.execPath, ['-e', script, output, 'async argument'])).isOk, true);
			assert.equal(fs.readFileSync(output, 'utf8'), 'async argument');
			const asyncFail = await Helper.execAsync('node', process.execPath, ['-e', 'process.exit(3)']);
			assert.equal(asyncFail.isOk, false);
			if (!asyncFail.isOk) assert.equal(asyncFail.err.code, 3, 'a non-zero exit code must reach the caller');
			const missingBin = await Helper.execAsync('anidl-no-such-binary', 'anidl-no-such-binary', []);
			assert.equal(missingBin.isOk, false, 'a binary that cannot be spawned must resolve as a failure');

			// Moving a finished track must put it in place and leave nothing behind.
			const moved = path.join(execTemp, 'moved.txt');
			Helper.moveFile(output, moved);
			assert.equal(fs.readFileSync(moved, 'utf8'), 'async argument');
			assert.equal(fs.existsSync(output), false, 'a rename must not leave the source behind');
		} finally {
			fs.rmSync(execTemp, { recursive: true, force: true });
		}
		console.log('✓ subprocess arguments preserve spaces without shell expansion');

		const [{ default: Merger }, { languages }] = await Promise.all([import('../modules/module.merger'), import('../modules/module.langsData')]);
		const lang = languages[0];
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-chapter-test-'));
		try {
			const chapterPath = path.join(temp, 'chapters.txt');
			fs.writeFileSync(chapterPath, 'CHAPTER01=00:00:00.000\nCHAPTER01NAME=Opening\n');
			const merger = new Merger({
				videoAndAudio: [{ path: path.join(temp, 'missing.mp4'), lang }],
				onlyVid: [],
				onlyAudio: [],
				subtitles: [
					{ file: path.join(temp, 'missing-sub1.ass'), language: lang },
					{ file: path.join(temp, 'missing-sub2.ass'), language: lang }
				],
				chapters: [{ path: chapterPath, lang }],
				ccTag: 'CC',
				output: 'test.mkv',
				options: { ffmpeg: [], mkvmerge: [] },
				defaults: { audio: lang, sub: lang }
			});
			assert.match(merger.FFmpeg(), /-map_metadata 3/);
			merger.cleanUp(); // missing video/subtitle files must not abort cleanup
			assert.equal(fs.existsSync(chapterPath), false);
		} finally {
			fs.rmSync(temp, { recursive: true, force: true });
		}
		console.log('✓ ffmpeg maps the chapter input after subtitles; cleanup tolerates missing files');

		const appArgs = await import('../modules/module.app-args');
		appArgs.overrideArguments({}, { F: true, cbr: '1', service: 'crunchy' });
		assert.equal(appArgs.argvC.listFormats, true);
		assert.equal(appArgs.argvC['list-formats'], true);
		assert.equal(appArgs.argvC.F, true);
		assert.equal(appArgs.argvC.cbr, '1');
		const invalid = spawnSync(
			process.execPath,
			[
				'-r',
				'tsx/cjs',
				'-e',
				"process.argv=['node','test','--service','crunchy','--cbr','2']; require('./modules/log'); require('./modules/module.app-args').overrideArguments({}, {});"
			],
			{ cwd: path.join(__dirname, '..'), encoding: 'utf8' }
		);
		assert.equal(invalid.status, 1);
		assert.match(invalid.stdout + invalid.stderr, /expected 0 or 1/);
		console.log('✓ GUI format aliases and CBR selection work; invalid CLI --cbr is rejected');
	} finally {
		process.argv = savedArgs;
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
