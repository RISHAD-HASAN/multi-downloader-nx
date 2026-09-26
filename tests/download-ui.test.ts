// The live download view: session lifecycle, track ownership and the GUI opt-out.
import assert from 'assert';
import { beginSession, endSession, sessionActive, sessionOwns, trackProgress, trackState } from '../modules/module.download-ui';

// Session lifecycle (inert but safe when stdout is not a TTY)
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

// A new session replaces the previous one (one per episode)
{
	beginSession([{ key: 'video', type: 'Video', label: 'a' }]);
	beginSession([{ key: 'audio', type: 'Audio', label: 'b' }]);
	assert.strictEqual(sessionOwns('video'), false, 'stale track survived a new session');
	assert.strictEqual(sessionOwns('audio'), true);
	endSession();
	console.log('✓ starting a new session tears down the previous one');
}

// GUI mode must not take over stdout
{
	const prev = process.env.isGUI;
	process.env.isGUI = 'true';
	beginSession([{ key: 'video', type: 'Video', label: 'x' }]);
	assert.strictEqual(sessionActive(), false, 'live view must stay off in GUI mode');
	process.env.isGUI = prev;
	endSession();
	console.log('✓ GUI mode leaves the live view disabled');
}

console.log('\nAll download-UI tests passed.');
