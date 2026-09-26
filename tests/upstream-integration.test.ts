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
