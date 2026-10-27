// Test runner: runs every tests/*.test.ts in its own process and fails if any of
// them do.
//
// `test:all` used to be a hand-maintained chain of commands in package.json, so
// adding a test meant editing the manifest and forgetting it meant the test never
// ran. This discovers them instead. Each file still gets a fresh process, which
// matters: several of them rewrite process.argv, swap the working directory or
// install the live console before importing modules.
//
// Pass file-name fragments to run a subset:  tsx tests/run.ts proxy url

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..');
const filters = process.argv.slice(2).map((arg) => arg.toLowerCase());

const files = fs
	.readdirSync(__dirname)
	.filter((file) => file.endsWith('.test.ts'))
	.filter((file) => filters.length === 0 || filters.some((filter) => file.toLowerCase().includes(filter)))
	.sort();

if (files.length === 0) {
	console.error(filters.length ? `No test file matches: ${filters.join(', ')}` : 'No tests found in tests/');
	process.exit(1);
}

// Reuse the loader this runner was started with (tsx), so a spawned test is
// launched exactly the way `tsx tests/foo.test.ts` would launch it - without
// shelling out to a .bin shim that behaves differently on Windows.
const launchArgs = process.execArgv.length ? process.execArgv : ['--import', 'tsx'];

const started = Date.now();
const failed: string[] = [];

for (const file of files) {
	console.log(`\n--- ${file} ---`);
	const result = spawnSync(process.execPath, [...launchArgs, path.join(__dirname, file)], {
		stdio: 'inherit',
		cwd: repoRoot
	});

	if (result.error) {
		console.error(result.error);
		failed.push(file);
	} else if (result.status !== 0) {
		failed.push(file);
	}
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length) {
	console.error(`\n${failed.length} of ${files.length} test file(s) failed in ${seconds}s:`);
	for (const file of failed) console.error(`  ${file}`);
	process.exit(1);
}

console.log(`\nAll ${files.length} test file(s) passed in ${seconds}s.`);
