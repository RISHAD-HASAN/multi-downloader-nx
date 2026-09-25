import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

(async () => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-archive-test-'));
	const originalContentDirectory = process.env.contentDirectory;
	try {
		process.env.contentDirectory = temp;
		const config = path.join(temp, 'config');
		fs.mkdirSync(config);
		const damaged = path.join(config, 'archive.json');
		fs.writeFileSync(damaged, '{invalid-json');

		await import('../modules/log'); // initialize config/logger in the same order as the CLI
		const { archiveFile, makeCommand, downloaded } = await import('../modules/module.downloadArchive');
		assert.equal(archiveFile, damaged);
		assert.deepEqual(makeCommand('crunchy'), [], 'an unreadable archive should not crash listing');
		const backups = fs.readdirSync(config).filter((name) => name.startsWith('archive.json.corrupt.'));
		assert.equal(backups.length, 1);
		assert.equal(fs.readFileSync(path.join(config, backups[0]), 'utf8'), '{invalid-json');

		downloaded({ service: 'crunchy', type: 's' }, 'TEST', ['1']);
		const next = JSON.parse(fs.readFileSync(damaged, 'utf8'));
		assert.deepEqual(next.crunchy.s[0], { id: 'TEST', already: ['1'] });
		assert.equal(makeCommand('crunchy').length, 1);

		// Valid JSON of the wrong shape is also corrupt. Preserve each backup even
		// when two failures happen within the same millisecond.
		fs.writeFileSync(damaged, 'null');
		assert.deepEqual(makeCommand('crunchy'), []);
		const nextBackups = fs.readdirSync(config).filter((name) => name.startsWith('archive.json.corrupt.'));
		assert.equal(nextBackups.length, 2);
		assert.ok(nextBackups.some((name) => fs.readFileSync(path.join(config, name), 'utf8') === 'null'));
		console.log('✓ corrupt archive is backed up and a new archive can be used without losing the old data');
	} finally {
		if (originalContentDirectory === undefined) delete process.env.contentDirectory;
		else process.env.contentDirectory = originalContentDirectory;
		fs.rmSync(temp, { recursive: true, force: true });
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
