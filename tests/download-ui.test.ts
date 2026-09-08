// Verifies the live download view is actually wired into the download path.
// The rich components existed before this suite but nothing called them, so the
// CLI rendered plain per-chunk log lines. These assertions fail if that wiring
// is ever removed again.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { beginSession, endSession, sessionActive, sessionOwns, trackProgress, trackState } from '../modules/module.download-ui';

const root = path.join(__dirname, '..');

// ── 1. session lifecycle (non-TTY: must be inert but safe) ────────────────
{
	assert.strictEqual(sessionActive(), false, 'no session should exist initially');
	beginSession([
		{ key: 'video', type: 'Video', label: '1920x1080' },
		{ key: 'audio', type: 'Audio', label: '200kB/s | Japanese' }
	]);
	assert.strictEqual(sessionActive(), true);
	assert.strictEqual(sessionOwns('video'), true);
	assert.strictEqual(sessionOwns('audio'), true);
	assert.strictEqual(sessionOwns('subtitle'), false, 'unknown track must not be owned');
	assert.strictEqual(sessionOwns(undefined), false);

	for (let i = 1; i <= 50; i++) trackProgress('video', { completed: i, total: 50, bytes: i * 1000 });
	trackState('video', 'Downloaded');
	trackProgress('audio', { completed: 10, total: 20, bytes: 4096 });
	trackState('audio', 'FAILED');
	// unknown keys must be no-ops rather than throwing mid-download
	trackProgress('nope', { completed: 1, total: 2 });
	trackState('nope', 'Downloaded');

	endSession();
	assert.strictEqual(sessionActive(), false);
	assert.strictEqual(sessionOwns('video'), false);
	endSession(); // idempotent
	console.log('✓ session lifecycle, ownership, no-op on unknown tracks');
}

// ── 2. beginSession replaces a previous session (per-episode loops) ───────
{
	beginSession([{ key: 'video', type: 'Video', label: 'a' }]);
	beginSession([{ key: 'audio', type: 'Audio', label: 'b' }]);
	assert.strictEqual(sessionOwns('video'), false, 'stale track survived a new session');
	assert.strictEqual(sessionOwns('audio'), true);
	endSession();
	console.log('✓ starting a new session tears down the previous one');
}

// ── 3. GUI mode must not take over stdout ─────────────────────────────────
{
	const prev = process.env.isGUI;
	process.env.isGUI = 'true';
	beginSession([{ key: 'video', type: 'Video', label: 'x' }]);
	assert.strictEqual(sessionActive(), false, 'live view must stay off in GUI mode');
	process.env.isGUI = prev;
	endSession();
	console.log('✓ GUI mode leaves the live view disabled');
}

// ── 4. the downloader is actually wired to it ─────────────────────────────
{
	const hls = fs.readFileSync(path.join(root, 'modules', 'hls-download.ts'), 'utf8');
	assert.ok(hls.includes("from './module.download-ui'"), 'hls-download.ts no longer imports the live view');
	assert.ok(hls.includes('trackProgress('), 'hls-download.ts does not report progress to the live view');
	assert.ok(hls.includes('sessionOwns('), 'hls-download.ts no longer suppresses per-chunk log lines');
	assert.ok(/trackKey\?: string;/.test(hls), 'HLSOptions lost its trackKey');
	console.log('✓ hls-download.ts reports progress into the live view');
}

// ── 5. crunchy opens/closes the session and labels tracks ─────────────────
{
	const cr = fs.readFileSync(path.join(root, 'crunchy.ts'), 'utf8');
	assert.ok(cr.includes('beginSession(uiTracks)'), 'crunchy.ts does not open the live download view');
	assert.ok(cr.includes("trackKey: 'video'"), "crunchy.ts does not tag the video stream");
	assert.ok(cr.includes('trackKey: audioTrackKey'), 'crunchy.ts does not tag the audio stream per language');
	assert.ok(cr.includes('endSession();'), 'crunchy.ts never closes the live view');
	assert.ok(cr.includes('tracksTree('), 'crunchy.ts no longer renders the available-tracks tree');
	// Subprocess output is captured now, so the live view spans decryption and
	// only closes once every stream is finished.
	const endIdx = cr.indexOf('endSession();');
	const decIdx = cr.indexOf("trackState('video', 'Decrypting')");
	assert.ok(decIdx > 0, 'crunchy.ts does not report Decrypting');
	assert.ok(endIdx > decIdx, 'live view must stay open through decryption');
	assert.ok(cr.includes("type: 'Subtitle'"), 'subtitles are not added to the tree');
	console.log('✓ crunchy.ts keeps the view open through decryption, adds subtitle rows');
}

console.log('\nAll download-UI tests passed.');
