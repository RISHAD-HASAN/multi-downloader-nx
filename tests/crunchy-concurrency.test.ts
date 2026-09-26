import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { actualAudioTag, applyActualAudioTag, audioTagNotice, completedAudioLanguages, DashTransferRegistry, templateHasAudioTag } from '../modules/module.crunchy-transfer';

const lang = (code: string) => ({ code, name: code.toUpperCase(), locale: code });
const audioFile = (code: string) => ({ type: 'Audio', lang: lang(code), path: `${code}.audio.m4s` });
const videoFile = (code: string) => ({ type: 'Video', lang: lang(code), path: `${code}.video.m4s` });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const videoTask = (key: string, mediaId: string, body: () => Promise<void>) => ({ key, kind: 'video' as const, mediaId, task: body });
const audioTask = (key: string, mediaId: string, langCode: string, body: () => Promise<void>) => ({ key, kind: 'audio' as const, mediaId, langCode, task: body });

async function testConcurrentTransfers() {
	const registry = new DashTransferRegistry();
	const events: string[] = [];
	await registry.runAll([
		videoTask('video|G1', 'G1', async () => {
			events.push('video:start');
			await sleep(40);
			events.push('video:end');
		}),
		audioTask('audio-spa|G1', 'G1', 'spa', async () => {
			events.push('audio:start');
			await sleep(5);
			events.push('audio:end');
		})
	]);
	assert.deepEqual(events, ['video:start', 'audio:start', 'audio:end', 'video:end'], 'audio must finish while the video transfer is still running');
	assert.deepEqual(
		registry.list().map((t) => [t.key, t.state]),
		[
			['video|G1', 'completed'],
			['audio-spa|G1', 'completed']
		]
	);
	assert.equal(registry.hasPending(), false);
	assert.deepEqual(registry.completedAudioLangCodes('G1'), ['spa']);
	assert.deepEqual(registry.completedAudioLangCodes(), ['spa']);
	assert.deepEqual(registry.completedAudioLangCodes('OTHER'), []);
	console.log('✓ video and audio DASH tracks transfer concurrently and settle as completed');
}

async function testPendingVisibility() {
	const registry = new DashTransferRegistry();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const batch = registry.runAll([videoTask('video|G2', 'G2', () => gate), audioTask('audio-eng|G2', 'G2', 'eng', async () => {})]);
	await sleep(10);
	assert.equal(registry.hasPending(), true);
	assert.deepEqual(
		registry.pending().map((t) => t.key),
		['video|G2']
	);
	release();
	await batch;
	assert.equal(registry.pending().length, 0);
	assert.equal(registry.get('video|G2')?.state, 'completed');
	console.log('✓ in-flight tracks are visible as pending until they settle');
}

async function testFailureHandling() {
	const registry = new DashTransferRegistry();
	const settled: string[] = [];
	const batch = registry.runAll([
		videoTask('video|G3', 'G3', async () => {
			await sleep(5);
			throw new Error('CDN closed the connection');
		}),
		audioTask('audio-eng|G3', 'G3', 'eng', async () => {
			await sleep(30);
			settled.push('audio');
		})
	]);
	await assert.rejects(batch, /CDN closed the connection/);
	assert.deepEqual(settled, ['audio'], 'runAll must wait for every sibling transfer before surfacing the failure');
	assert.equal(registry.get('video|G3')?.state, 'failed');
	assert.equal(registry.get('video|G3')?.error, 'CDN closed the connection');
	assert.equal(registry.get('audio-eng|G3')?.state, 'completed');

	// Failed dubs never count towards the completed-language list
	await registry
		.runAll([
			audioTask('audio-eng|G4', 'G4', 'eng', async () => {}),
			audioTask('audio-spa|G4', 'G4', 'spa', async () => {
				throw new Error('403');
			})
		])
		.catch(() => undefined);
	assert.deepEqual(registry.completedAudioLangCodes('G4'), ['eng']);

	// A single transfer rejects with its own error
	await assert.rejects(
		registry.run({
			key: 'video|G5',
			kind: 'video',
			mediaId: 'G5',
			task: async () => {
				throw new Error('Playlist is empty!');
			}
		}),
		/Playlist is empty!/
	);

	// clear() is scoped per episode
	await registry.runAll([audioTask('audio-jpn|G6', 'G6', 'jpn', async () => {})]);
	registry.clear('G3');
	assert.deepEqual(
		registry.list().map((t) => t.mediaId),
		['G4', 'G4', 'G5', 'G6']
	);
	registry.clear();
	assert.equal(registry.list().length, 0);
	console.log('✓ failed transfers are recorded, rethrown after siblings settle, and excluded from completed audio');
}

function testAudioTag() {
	assert.deepEqual(completedAudioLanguages([audioFile('eng'), audioFile('spa'), audioFile('eng')]), ['eng', 'spa']);
	assert.equal(actualAudioTag([audioFile('eng'), audioFile('spa')]), 'DUAL.');
	assert.equal(actualAudioTag([audioFile('eng')]), '', 'a lone completed dub is not DUAL');
	assert.equal(actualAudioTag([audioFile('eng'), audioFile('eng')]), '', 'duplicates of one language are not DUAL');
	// The HLS fallback muxes audio into the video, so video languages decide
	assert.equal(actualAudioTag([videoFile('eng'), videoFile('spa')]), 'DUAL.');
	assert.equal(actualAudioTag([videoFile('eng')]), '');
	// DASH output: completed audio files win over the video file language
	assert.equal(actualAudioTag([videoFile('eng'), audioFile('eng'), audioFile('spa')]), 'DUAL.');
	assert.equal(actualAudioTag([videoFile('eng'), audioFile('eng')]), '');
	// Non-media entries are ignored
	assert.equal(actualAudioTag([{ type: 'Chapters', lang: lang('eng'), path: 'ch.txt' }, videoFile('eng')]), '');
	assert.deepEqual(completedAudioLanguages([]), []);
	console.log('✓ DUAL tag follows the audio tracks that actually completed');
}

function testApplyAudioTag() {
	const variables = [
		{ name: 'title', type: 'string', replaceWith: 'Show' },
		{ name: 'audio', type: 'string', replaceWith: 'DUAL.' },
		{ name: 'episode', type: 'number', replaceWith: 1 }
	];
	assert.equal(applyActualAudioTag(variables, [videoFile('eng'), audioFile('eng')]), true);
	assert.equal(variables[1].replaceWith, '', 'requested DUAL must be downgraded when the second dub failed');
	assert.equal(applyActualAudioTag(variables, [audioFile('eng')]), false, 'an unchanged tag reports no rewrite');
	assert.equal(variables[0].replaceWith, 'Show');
	assert.equal(variables[2].replaceWith, 1);
	assert.equal(applyActualAudioTag(variables, [audioFile('eng'), audioFile('spa')]), true);
	assert.equal(variables[1].replaceWith, 'DUAL.', 'a completed second dub upgrades the tag again');

	// A template that asks for ${audio} still gets a value when the download path
	// never seeded one (template-only callers, HLS fallback).
	assert.equal(templateHasAudioTag('${title}.${audio}x264'), true);
	assert.equal(templateHasAudioTag('${title}.x264'), false);
	const empty: { name: string; type: string; replaceWith: string | number }[] = [];
	assert.equal(
		applyActualAudioTag(empty, [audioFile('eng'), audioFile('spa')], '${title}.${audio}x264'),
		true,
		'a missing ${audio} variable must be seeded when the template asks for it'
	);
	assert.deepEqual(empty, [{ name: 'audio', type: 'string', replaceWith: 'DUAL.' }]);
	const untouched: { name: string; type: string; replaceWith: string | number }[] = [];
	assert.equal(applyActualAudioTag(untouched, [audioFile('eng'), audioFile('spa')], '${title}.x264'), false, 'a template without ${audio} has nowhere to seed');
	assert.deepEqual(untouched, []);

	// The tag outcome is always reported, so a skipped DUAL cannot go unnoticed.
	assert.deepEqual(audioTagNotice([audioFile('eng'), audioFile('spa')], '${title}.${audio}x264', false), {
		level: 'info',
		message: 'Audio: eng + spa - DUAL tag added to the filename'
	});
	const skipped = audioTagNotice([audioFile('eng'), audioFile('spa')], '${title}.x264', false);
	assert.equal(skipped?.level, 'warn');
	assert.ok(skipped?.message.includes('no ${audio}') && skipped?.message.includes('--fileName'));
	assert.equal(audioTagNotice([audioFile('eng')], '${title}.${audio}x264', false), undefined, 'a lone requested dub is ordinary and stays quiet');
	assert.equal(audioTagNotice([audioFile('eng')], '${title}.${audio}x264', true)?.level, 'info', 'a downgraded DUAL reports that one dub completed');
	console.log('✓ the ${audio} filename variable is rewritten in place, seeded when missing, and always reported');
}

function testCrunchyWiring() {
	const source = fs.readFileSync(path.join(__dirname, '..', 'crunchy.ts'), 'utf8');
	assert.ok(source.includes('private pendingDashTransfers = new DashTransferRegistry();'), 'crunchy.ts must own a DASH transfer registry');
	assert.ok(source.includes('videoJobs.push(videoJob)'), 'video must run independently of the dub loop');
	assert.ok(source.includes("await finishTrack('audio');"), 'audio must decrypt inside its own transfer');
	assert.ok(source.includes('await Promise.all(videoJobs);'), 'video jobs must drain before returning');
	assert.ok(source.includes('await Helper.decrypt(binary, args);'), 'decryption must not block network transfers');
	assert.ok(
		source.includes('applyActualAudioTag(variables, files, options.fileName)'),
		'the filename variable must be updated from completed audio before the final name is built'
	);
	assert.ok(source.includes('audioTagNotice(files, options.fileName, requestedDual)'), 'a skipped DUAL tag must be reported to the user');
	console.log('✓ crunchy.ts wires concurrent DASH transfers and the completed-audio tag');
}

async function testMergerDefaultAudio() {
	const savedArgs = process.argv;
	process.argv = [...savedArgs, '--service', 'crunchy'];
	try {
		await import('../modules/log'); // initialize the shared config/logger cycle
		const [{ default: Merger }, { languages }] = await Promise.all([import('../modules/module.merger'), import('../modules/module.langsData')]);
		const { default: Helper } = await import('../modules/module.helper');
		let ticked = false;
		const timer = setTimeout(() => {
			ticked = true;
		}, 10);
		await Helper.decrypt(process.execPath, ['-e', 'setTimeout(() => {}, 80)']);
		clearTimeout(timer);
		assert.equal(ticked, true, 'decryption must leave the event loop available to downloads');
		await assert.rejects(Helper.decrypt(process.execPath, ['-e', 'console.error("secret-key"); process.exit(7)']), (error: Error) => {
			assert.equal(error.message, 'Decryption failed with exit code 7');
			assert.ok(!error.message.includes('secret-key'));
			return true;
		});
		const eng = languages.find((l) => l.code === 'eng')!;
		const spa = languages.find((l) => l.code === 'spa')!;
		const jpn = languages.find((l) => l.code === 'jpn')!;
		const base = {
			onlyVid: [],
			subtitles: [],
			ccTag: 'CC',
			output: 'test.mkv',
			options: { ffmpeg: [], mkvmerge: [] }
		};

		const audioOnly = new Merger({
			...base,
			videoAndAudio: [],
			onlyAudio: [
				{ path: 'eng.audio.m4s', lang: eng },
				{ path: 'spa.audio.m4s', lang: spa }
			],
			defaults: { audio: spa, sub: eng }
		});
		assert.equal(audioOnly.defaultAudioIndex(), 1);
		const audioOnlyCmd = audioOnly.FFmpeg();
		assert.ok(audioOnlyCmd.includes('-disposition:a:1 default'), audioOnlyCmd);
		assert.ok(audioOnlyCmd.includes('-disposition:a:0 0'), audioOnlyCmd);

		// videoAndAudio tracks are mapped before onlyAudio tracks
		const mixed = new Merger({
			...base,
			videoAndAudio: [{ path: 'video.m4s', lang: eng }],
			onlyAudio: [{ path: 'spa.audio.m4s', lang: spa }],
			defaults: { audio: eng, sub: eng }
		});
		assert.equal(mixed.defaultAudioIndex(), 0);
		const mixedCmd = mixed.FFmpeg();
		assert.ok(mixedCmd.includes('-disposition:a:0 default'), mixedCmd);
		assert.ok(mixedCmd.includes('-disposition:a:1 0'), mixedCmd);

		// No matching language: every track is cleared, none flagged default
		const unmatched = new Merger({
			...base,
			videoAndAudio: [{ path: 'video.m4s', lang: eng }],
			onlyAudio: [{ path: 'spa.audio.m4s', lang: spa }],
			defaults: { audio: jpn, sub: eng }
		});
		assert.equal(unmatched.defaultAudioIndex(), -1);
		const unmatchedCmd = unmatched.FFmpeg();
		assert.ok(!/-disposition:a:\d+ default/.test(unmatchedCmd), unmatchedCmd);
		assert.ok(unmatchedCmd.includes('-disposition:a:0 0'));
		assert.ok(unmatchedCmd.includes('-disposition:a:1 0'));

		// A lone audio track keeps FFmpeg's own default handling
		const single = new Merger({
			...base,
			videoAndAudio: [{ path: 'video.m4s', lang: eng }],
			onlyAudio: [],
			defaults: { audio: spa, sub: eng }
		});
		assert.equal(single.defaultAudioIndex(), -1);
		assert.ok(!single.FFmpeg().includes('-disposition:a'), 'single audio output must not touch dispositions');
	} finally {
		process.argv = savedArgs;
	}
	console.log('✓ FFmpeg muxing flags the configured default audio track');
}

(async () => {
	await testConcurrentTransfers();
	await testPendingVisibility();
	await testFailureHandling();
	testAudioTag();
	testApplyAudioTag();
	testCrunchyWiring();
	await testMergerDefaultAudio();
	console.log('\nAll Crunchyroll concurrency tests passed.');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
