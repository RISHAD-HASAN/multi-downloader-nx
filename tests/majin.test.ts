import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
	applyCbrTransform,
	applyMajinTransform,
	chooseStream,
	comparePlaybackStreams,
	formatBytes,
	formatDuration,
	manifestDuration,
	parseISODuration,
	sizeFromBitrate,
	variantUrl,
	type StreamCandidate
} from '../modules/module.crunchy-quality';

const raw = 'https://cr-play-service.prd.crunchyrollsvc.com/v2/manifest/GE00374461JAJP/static/e00374461a00374488jajp/0/clean/dash/manifest.mpd?playbackGuid=05-ca513cec';

const mpd = (tracks: { bps: number; width: number; height: number; uri: string }[], duration = 'PT23M40S') =>
	`<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="${duration}" minBufferTime="PT2S"><Period><AdaptationSet mimeType="video/mp4">${tracks
		.map(
			(t, i) =>
				`<Representation id="v${i}" bandwidth="${t.bps}" width="${t.width}" height="${t.height}" codecs="avc1.42c028"><BaseURL>${t.uri}</BaseURL><SegmentBase indexRange="0-99"><Initialization range="0-99"/></SegmentBase></Representation>`
		)
		.join('')}</AdaptationSet></Period></MPD>`;

const track = (bps: number, name: string, width = 1920, height = 1080) => ({ bps, width, height, uri: `https://cdn.example.test/${name}.mp4` });

const request = (bodies: Map<string, string>, sizes = new Map<string, number>()) => {
	const fetched: string[] = [];
	const heads: string[] = [];
	return {
		fetched,
		heads,
		manifest: async (url: string) => {
			fetched.push(url);
			return bodies.get(url);
		},
		size: async (url: string) => {
			heads.push(url);
			return sizes.get(url);
		}
	};
};

const candidate = (variant: StreamCandidate['variant'], bps: number, actualBps?: number, height = 1080): StreamCandidate => ({
	variant,
	name: variant,
	url: raw,
	width: height === 1080 ? 1920 : height === 900 ? 1600 : 640,
	height,
	declaredBps: bps,
	actualBps,
	durationSec: 1420
});

async function testSegmentBaseParsing() {
	// The downloader's MPD parser also uses HEAD to construct byte ranges. Its
	// size/bitrate must come from a complete file, not a 206 partial response.
	const savedArgs = process.argv;
	process.argv = [...savedArgs, '--service', 'crunchy'];
	try {
		await import('../modules/log'); // initialize the shared config/logger cycle
		const { Req } = await import('../modules/module.fetch');
		const { parse } = await import('../modules/module.transform-mpd');
		const original = Req.prototype.getData;
		let status = 200;
		let length = '2500000';
		Req.prototype.getData = async (url, opts = {}) => {
			assert.equal(url, 'https://cdn.example.test/whole.mp4');
			assert.equal(opts.method, 'HEAD');
			return { ok: true, res: new Response(null, { status, headers: { 'Content-Length': length } }) };
		};
		try {
			const fixture = mpd([track(5_000_000, 'whole')], 'PT10S');
			let video = (await parse(fixture))['cdn.example.test'].video[0];
			assert.equal(video.byteLength, 2_500_000);
			assert.equal(video.actualBitrate, 2_000_000);
			assert.equal(video.bandwidth, 2_000_000);
			assert.ok(video.segments.length > 0);
			status = 206;
			video = (await parse(fixture))['cdn.example.test'].video[0];
			assert.equal(video.byteLength, undefined);
			assert.equal(video.actualBitrate, undefined);
			assert.equal(video.bandwidth, 5_000_000);
			length = '2500000junk';
			status = 200;
			video = (await parse(fixture))['cdn.example.test'].video[0];
			assert.equal(video.byteLength, undefined);
		} finally {
			Req.prototype.getData = original;
		}
	} finally {
		process.argv = savedArgs;
	}
	console.log('✓ SegmentBase parser reports whole-file size and rejects partial/invalid HEAD lengths');
}

(async () => {
	// Test the actual URL functions, not a copy of their implementation.
	const majin = variantUrl(raw, 'majin');
	assert.equal(
		majin,
		'https://cr-play-service.prd.crunchyrollsvc.com/v2/manifest/GE00374461JAJP/static/majin/e00374461a00374488jajp/clean/cenc/dash/manifest.mpd?playbackGuid=05-ca513cec'
	);
	assert.equal(applyMajinTransform(majin), majin, 'Majin rewrite must be idempotent');
	assert.equal(applyCbrTransform(majin, '0'), raw);
	assert.equal(applyCbrTransform(raw, '1'), raw.replace('/0/clean/', '/1/clean/'));
	assert.equal(applyCbrTransform(applyCbrTransform(raw, '1'), '1'), variantUrl(raw, 'cbr1'));
	assert.equal(applyMajinTransform(raw.replace('/0/clean/', '/1/clean/')), majin);
	assert.equal(applyMajinTransform(raw.replace('/dash/manifest.mpd', '/hls/manifest.m3u8')), raw.replace('/dash/manifest.mpd', '/hls/manifest.m3u8'));
	assert.equal(applyCbrTransform('https://example.test/other.mpd', '0'), 'https://example.test/other.mpd');
	const hlsWithDashQuery = raw.replace('/0/clean/dash/manifest.mpd', '/0/clean/hls/manifest.m3u8') + '&redirect=/static/example/0/clean/dash/';
	assert.equal(applyMajinTransform(hlsWithDashQuery), hlsWithDashQuery, 'do not rewrite a DASH path in an HLS query parameter');
	console.log('✓ URL rewrites are reversible, idempotent, and leave HLS alone');

	assert.equal(parseISODuration('PT1H2M3.5S'), 3723.5);
	assert.equal(parseISODuration('P1DT5S'), 86405);
	assert.equal(parseISODuration('not-a-duration'), 0);
	assert.equal(manifestDuration(mpd([], 'PT23M40S'), 120), 1420);
	assert.equal(formatDuration(59.9), '1m 0s');
	assert.equal(sizeFromBitrate(8_000_000, 1420), 1_420_000_000);
	assert.equal(sizeFromBitrate(0, 1420), undefined);
	assert.equal(formatBytes(1_427_622_727), '1.33 GiB');
	assert.equal(formatBytes(611_463_168), '583.1 MB');
	assert.equal(formatBytes(0), '0 B');
	console.log('✓ duration, bitrate and file-size formatting');

	// Majin's peak tier can beat CBR even when its measured average is lower
	// than CBR's declared bitrate, if the average is still healthy.
	const highBodies = new Map([
		[majin, mpd([track(20_000_000, 'majin-720', 1280, 720), track(13_953_000, 'majin-1080')])],
		[variantUrl(raw, 'cbr0'), mpd([track(12_809_000, 'cbr0')])],
		[variantUrl(raw, 'cbr1'), mpd([track(8_564_000, 'cbr1')])]
	]);
	const highSize = (9_632_000 * 1420) / 8;
	const highReq = request(highBodies, new Map([['https://cdn.example.test/majin-1080.mp4', highSize]]));
	const high = await comparePlaybackStreams(raw, 'auto', 100, highReq.manifest, highReq.size);
	assert.equal(high.selected?.variant, 'majin');
	assert.equal(high.candidates.length, 3);
	assert.equal(high.durationSec, 1420);
	assert.equal(high.selected.actualBps, 9_632_000);
	assert.equal(high.selected.sizeBytes, highSize);
	assert.deepEqual(highReq.heads, ['https://cdn.example.test/majin-1080.mp4'], 'probe the whole file, not the 720p version or the MPD');
	console.log('✓ 3-way comparison chooses healthy VBR and probes only its best whole-file representation');

	const lowBodies = new Map([
		[majin, mpd([track(4_572_217, 'low-majin')])],
		[variantUrl(raw, 'cbr0'), mpd([track(11_478_671, 'high-cbr')])],
		[variantUrl(raw, 'cbr1'), mpd([track(7_926_003, 'regular-cbr')])]
	]);
	const lowReq = request(lowBodies, new Map([['https://cdn.example.test/low-majin.mp4', (3_420_000 * 1420) / 8]]));
	const low = await comparePlaybackStreams(raw, 'auto', 0, lowReq.manifest, lowReq.size);
	assert.equal(low.selected?.variant, 'cbr0');
	assert.equal(low.candidates.find((c) => c.variant === 'majin')?.actualBps, 3_420_000);
	console.log('✓ 3-way comparison chooses higher-bitrate CBR when Majin is weak');

	assert.equal(chooseStream([candidate('majin', 16_000_000, 12_000_000, 900), candidate('cbr0', 10_000_000)])?.variant, 'cbr0');
	assert.equal(chooseStream([candidate('majin', 2_800_000, 2_700_000, 480), candidate('cbr1', 2_500_000, undefined, 480)])?.variant, 'majin');
	assert.equal(chooseStream([candidate('majin', 15_000_000), candidate('cbr0', 12_000_000)])?.variant, 'majin');
	assert.equal(chooseStream([candidate('majin', 15_000_000, 6_000_000), candidate('cbr0', 12_000_000)])?.variant, 'cbr0');
	console.log('✓ resolution downgrade, SD, unknown HEAD size and low actual bitrate rules');

	const manual = request(highBodies);
	assert.equal((await comparePlaybackStreams(raw, 'cbr1', 0, manual.manifest, manual.size)).selected?.variant, 'cbr1');
	assert.deepEqual(manual.fetched, [variantUrl(raw, 'cbr1')], 'manual --cbr must not probe Majin or CBR 0');
	assert.deepEqual(manual.heads, []);
	assert.equal((await comparePlaybackStreams(raw, 'majin', 0, async () => undefined, manual.size)).selected, undefined);
	const secondDub = await comparePlaybackStreams(raw, 'auto', 0, request(new Map([[variantUrl(raw, 'cbr0'), mpd([track(11_478_671, 'cbr0')])]])).manifest, manual.size);
	assert.equal(secondDub.selected?.variant, 'cbr0', 'another dub without Majin must not inherit the first dub selection');
	console.log('✓ manual overrides, missing-encode fallback and per-dub selection');

	let called = false;
	const hls = await comparePlaybackStreams(
		raw.replace('/dash/manifest.mpd', '/hls/manifest.m3u8'),
		'auto',
		0,
		async () => {
			called = true;
			return undefined;
		},
		async () => undefined
	);
	assert.equal(hls.selected, undefined);
	assert.equal(called, false);

	// Keep the integration checks targeted; the algorithm above is exercised
	// using real MPD parsing and mocked network callbacks.
	const root = path.join(__dirname, '..');
	const crunchy = fs.readFileSync(path.join(root, 'crunchy.ts'), 'utf8');
	assert.ok(crunchy.includes('comparePlaybackStreams(') && crunchy.includes('this.applyCbrTransform('));
	assert.ok(!/options\.majin\s*=\s*(true|false)/.test(crunchy), 'the option must not be latched across dubs');
	assert.ok(crunchy.includes('No majin encode exists for this version'));
	const args = fs.readFileSync(path.join(root, 'modules/module.args.ts'), 'utf8');
	assert.ok(args.includes("name: 'cbr'") && args.includes("name: 'list-formats'"));
	assert.ok(fs.readFileSync(path.join(root, '@types/crunchyTypes.d.ts'), 'utf8').includes("cbr?: '0' | '1'"));
	console.log('✓ Crunchyroll wiring and CLI types');

	await testSegmentBaseParsing();
	console.log('\nAll Majin/CBR stream-selection tests passed.');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
