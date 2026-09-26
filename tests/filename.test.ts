// Scene-style filename rules: whitespace and punctuation collapse into dots.
// The real-world case is the Windows full-width colon (U+FF1A) that appeared as
// "Mushoku.Tensei：.Jobless..." in a live download.
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// mirrors module.filename.ts
const dots = (input: string): string =>
	input
		.replace(/\s+/g, '.')
		.replace(/[,;:\uFF1A\uFF0C\u2013\u2014\-!?'"“”‘’`(){}[\]<>|~^&+=@#$%]/g, '.')
		.replace(/\.{2,}/g, '.')
		.replace(/^\.+|\.+$/g, '');

const cases: Array<[string, string]> = [
	['Mushoku Tensei： Jobless Reincarnation', 'Mushoku.Tensei.Jobless.Reincarnation'],
	['Mushoku Tensei: Jobless Reincarnation', 'Mushoku.Tensei.Jobless.Reincarnation'],
	['Burn Bright, Mad Dog', 'Burn.Bright.Mad.Dog'],
	['Another Domestic Disaster?', 'Another.Domestic.Disaster'],
	['The Journey’s End', 'The.Journey.s.End'],
	['A King-Class Water Mage', 'A.King.Class.Water.Mage'],
	['[Crunchyroll] Show (2026)', 'Crunchyroll.Show.2026'],
	['Turning   Point    4', 'Turning.Point.4'],
	['Re:Zero - Starting Life', 'Re.Zero.Starting.Life'],
	['S03E09 - Lament!', 'S03E09.Lament']
];

for (const [input, expected] of cases) {
	const got = dots(input);
	assert.strictEqual(got, expected, `"${input}" -> "${got}" (expected "${expected}")`);
}
console.log(`✓ ${cases.length} filename cases collapse to dots`);

// no leading/trailing/duplicate dots ever survive
for (const [input] of cases) {
	const got = dots(input);
	assert.ok(!got.startsWith('.') && !got.endsWith('.'), `stray edge dot in "${got}"`);
	assert.ok(!got.includes('..'), `double dot in "${got}"`);
}
console.log('✓ no leading, trailing or doubled dots');

// dots and existing separators are preserved, extensions unharmed
assert.strictEqual(dots('Show.S01E01.1080p.WEB-DL'), 'Show.S01E01.1080p.WEB.DL');
assert.strictEqual(dots('already.dotted.name'), 'already.dotted.name');
console.log('✓ already-dotted names stay stable');

// the implementation actually contains the rule
const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'module.filename.ts'), 'utf8');
assert.ok(src.includes('\\uFF1A'), 'module.filename.ts lost the full-width colon rule');
assert.ok(/\\\.\{2,\}/.test(src), 'module.filename.ts lost the duplicate-dot squeeze');
console.log('✓ rules present in module.filename.ts');

// subprocess output must be suppressed unless --debug
const helper = fs.readFileSync(path.join(__dirname, '..', 'modules', 'module.helper.ts'), 'utf8');
assert.ok(helper.includes('quietDefault'), 'Helper.exec no longer hides subprocess output');
assert.ok(helper.includes("const stdio = quiet ? 'pipe' : 'inherit'"), 'Helper.exec still inherits stdio unconditionally');
console.log('✓ shaka/mkvmerge output is captured, not inherited');

// the live view survives decryption and reports Decrypting in place
const cr = fs.readFileSync(path.join(__dirname, '..', 'crunchy.ts'), 'utf8');
assert.ok(cr.includes("'Decrypting'"), 'crunchy.ts does not report a Decrypting state');
const endIdx = cr.indexOf('endSession();');
const decIdx = cr.indexOf("trackState(trackKey, 'Decrypting')");
assert.ok(decIdx > 0 && endIdx > decIdx, 'the live view must now close AFTER decryption');
assert.ok(cr.includes('audio-${lang.code}'.replace('${lang.code}', '${lang.code}')), 'audio rows are not per-language');
assert.ok(cr.includes("type: 'Subtitle'"), 'subtitles are not added to the tree');
console.log('✓ live view spans decryption; per-language audio + subtitle rows');

// ── verbose per-stream chatter must stay at debug level ───────────────────
const cr2 = fs.readFileSync(path.join(__dirname, '..', 'crunchy.ts'), 'utf8');
for (const noisy of [
	'Video Playlists URL',
	'Audio Playlists URL',
	'Total parts in video stream',
	'Total parts in audio stream',
	'Selecting raw stream',
	'Got decryption keys',
	'Chapter request successful'
]) {
	const idx = cr2.indexOf(noisy);
	assert.ok(idx > 0, `"${noisy}" vanished entirely`);
	const line = cr2.slice(cr2.lastIndexOf('\n', idx) + 1, idx);
	assert.ok(!line.includes('console.info'), `"${noisy}" is still logged at info level`);
}
const hls2 = fs.readFileSync(path.join(__dirname, '..', 'modules', 'hls-download.ts'), 'utf8');
for (const noisy of ['Saving stream to', 'Init part downloaded', 'Download and save init part']) {
	const idx = hls2.indexOf(noisy);
	assert.ok(idx > 0, `"${noisy}" vanished entirely`);
	const line = hls2.slice(hls2.lastIndexOf('\n', idx) + 1, idx);
	assert.ok(!line.includes('console.info'), `"${noisy}" is still logged at info level`);
}
console.log('✓ verbose stream chatter is debug-only');

// a silent request must not log non-OK responses (the majin probe 404s by design)
const fetchSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'module.fetch.ts'), 'utf8');
assert.ok(fetchSrc.includes('if (!res.ok && !params.silent)'), 'silent requests still log non-OK responses');
console.log('✓ silent requests stay quiet on 404/401');

console.log('\nAll filename/output tests passed.');
