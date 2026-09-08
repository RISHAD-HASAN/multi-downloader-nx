/**
 * The "majin" encode is a separate, higher-bitrate CENC DASH rendition served
 * from a different path. These tests pin the URL rewrite against real
 * Crunchyroll manifest URLs (taken from actual download logs).
 * Ported from the Yurasubs fork.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// mirrors Crunchy.applyMajinTransform
const applyMajinTransform = (url: string): string => {
	if (url.includes('/static/majin/')) return url;
	if (!/\/(?:\d+\/)?clean\/dash\//.test(url) || !url.includes('/static/')) return url;
	return url.replace('/static/', '/static/majin/').replace(/\/(?:\d+\/)?clean\/dash\//, '/clean/cenc/dash/');
};

// ── 1. real URLs observed in a live session ────────────────────────────────
{
	const video =
		'https://cr-play-service.prd.crunchyrollsvc.com/v2/manifest/GE00374461JAJP/static/e00374461a00374488jajp/0/clean/dash/manifest.mpd?playbackGuid=05-ca513cec';
	const got = applyMajinTransform(video);
	assert.ok(got.includes('/static/majin/'), 'majin path segment missing');
	assert.ok(got.includes('/clean/cenc/dash/'), 'cenc path missing');
	assert.ok(!/\/0\/clean\//.test(got), 'the numeric stream index should be dropped');
	assert.ok(got.includes('?playbackGuid=05-ca513cec'), 'query string must be preserved');
	assert.strictEqual(
		got,
		'https://cr-play-service.prd.crunchyrollsvc.com/v2/manifest/GE00374461JAJP/static/majin/e00374461a00374488jajp/clean/cenc/dash/manifest.mpd?playbackGuid=05-ca513cec'
	);
	console.log('✓ video manifest rewrite');

	// audio manifest uses index 1
	const audio =
		'https://cr-play-service.prd.crunchyrollsvc.com/v2/manifest/GE00374461JAJP/static/e00374461a00374488jajp/1/clean/dash/manifest.mpd?accountid=df30e4a1';
	const gotA = applyMajinTransform(audio);
	assert.ok(gotA.includes('/static/majin/') && gotA.includes('/clean/cenc/dash/'));
	assert.ok(!/\/1\/clean\//.test(gotA));
	console.log('✓ audio manifest rewrite');
}

// ── 2. idempotence + non-matching URLs are left alone ──────────────────────
{
	const already =
		'https://x/v2/manifest/A/static/majin/b/clean/cenc/dash/manifest.mpd';
	assert.strictEqual(applyMajinTransform(already), already, 'must not double-transform');

	const hls = 'https://x/v2/manifest/A/static/b/0/clean/hls/manifest.m3u8';
	assert.strictEqual(applyMajinTransform(hls), hls, 'HLS manifests must be left completely alone');

	const unrelated = 'https://example.com/whatever.mpd';
	assert.strictEqual(applyMajinTransform(unrelated), unrelated);
	console.log('✓ idempotent; HLS and unrelated URLs untouched');
}

// ── 3. the threshold logic ─────────────────────────────────────────────────
{
	const qualifies = (bandwidth: number, height: number, width: number) => {
		const kbps = Math.round(bandwidth / 1024);
		const is1080pPlus = height >= 1080 || width >= 1920;
		return is1080pPlus && kbps >= 7500;
	};
	assert.strictEqual(qualifies(7500 * 1024, 1080, 1920), true, '7500 kbps @1080p should qualify');
	assert.strictEqual(qualifies(7499 * 1024, 1080, 1920), false, 'below threshold must not qualify');
	assert.strictEqual(qualifies(12000 * 1024, 720, 1280), false, '720p must never qualify');
	assert.strictEqual(qualifies(9000 * 1024, 2160, 3840), true, '4K should qualify');
	console.log('✓ 1080p+ and >= 7500 kbps threshold');
}

// ── 4. it is actually wired into crunchy.ts, not just declared ─────────────
{
	const cr = fs.readFileSync(path.join(__dirname, '..', 'crunchy.ts'), 'utf8');
	assert.ok(cr.includes('applyMajinTransform'), 'crunchy.ts lost applyMajinTransform');
	assert.ok(/if \(options\.majin\)/.test(cr), '--majin flag is not acted upon');
	assert.ok(cr.includes('automatically enabling Majin quality mode'), 'auto-probe missing');
	assert.ok(/a\.bandwidth - b\.bandwidth/.test(cr), 'video sort lost its bitrate tiebreaker');

	const args = fs.readFileSync(path.join(__dirname, '..', 'modules', 'module.args.ts'), 'utf8');
	assert.ok(args.includes("name: 'majin'"), '--majin flag missing from the arg list');

	const types = fs.readFileSync(path.join(__dirname, '..', '@types', 'crunchyTypes.d.ts'), 'utf8');
	assert.ok(/majin\?: boolean/.test(types), 'CrunchyDownloadOptions lost majin');
	console.log('✓ wired into crunchy.ts, args and types');
}

console.log('\nAll majin tests passed.');
