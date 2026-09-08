/**
 * Listing verbosity is context-dependent:
 *   --srz X            -> season list only
 *   --srz X -s S       -> episode list only (+ separator)
 *   --srz X -s S -e 9  -> neither; go straight to the download
 * Plus: the account line shows the username, never the email.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const cr = fs.readFileSync(path.join(__dirname, '..', 'crunchy.ts'), 'utf8');

// ── the account line must not leak the email ───────────────────────────────
assert.ok(!/USER: %s \(%s\)/.test(cr), 'the USER line still prints the email');
assert.ok(cr.includes("console.info('USER: %s', profile.username)"), 'username line missing');
assert.ok(!/profile\.email/.test(cr), 'profile.email is still referenced in output');
console.log('✓ account line shows username only');

// ── a silent token refresh must not re-print the account line ──────────────
assert.ok(
	cr.includes("} else if (!silent) {\r\n\t\t\tconsole.info('USER: Anonymous');") ||
		cr.includes("} else if (!silent) {\n\t\t\tconsole.info('USER: Anonymous');"),
	'the anonymous branch ignores `silent`, duplicating the USER line'
);
console.log('✓ anonymous branch honours the silent flag');

// ── season list only when -s was not supplied ──────────────────────────────
assert.ok(
	/if \(!argv\.s\) await this\.logSeriesById/.test(cr),
	'the season list is not gated on the absence of -s'
);
console.log('✓ season list hidden once -s narrows the request');

// ── episode list only when -s given and -e absent ──────────────────────────
assert.ok(
	cr.includes('const showEpisodeList = Boolean(listingArgv.s) && !listingArgv.e;'),
	'episode listing is not gated correctly'
);
assert.ok(
	cr.includes('showEpisodeList ? sortedEpisodes : {}'),
	'the episode loop does not honour showEpisodeList'
);
assert.ok(/if \(sepArgv\.s && !sepArgv\.e\)/.test(cr), 'the --- separator is not tied to the episode list');
console.log('✓ episode list + separator only for `--srz -s` without -e');

// ── the \r\t cursor hack is gone (it broke the padded layout) ──────────────
assert.ok(!cr.includes('\\r\\t- Versions:'), 'episode listing still uses the \\r\\t cursor hack');
assert.ok(cr.includes('   - Versions: ${item.items'), 'episode listing lost its indent');
console.log('✓ episode listing uses real indentation');

console.log('\nAll listing tests passed.');
