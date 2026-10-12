// Scene-style filenames: whitespace and punctuation collapse into dots, including
// the full-width colon (U+FF1A) Windows substitutes for ':'. In-word apostrophes
// fold into the word instead of becoming dots.
import assert from 'node:assert/strict';
import parseFileName, { type Variable } from '../modules/module.filename';

// Drives the real parser instead of a copy of its rules.
const name = (title: string): string => {
	const vars = [{ name: 'title', type: 'string', replaceWith: title, sanitize: false }] as Variable[];
	return parseFileName('${title}', vars, 2, [])[0];
};

const cases: Array<[string, string]> = [
	['Mushoku Tensei： Jobless Reincarnation', 'Mushoku.Tensei.Jobless.Reincarnation'],
	['Mushoku Tensei: Jobless Reincarnation', 'Mushoku.Tensei.Jobless.Reincarnation'],
	['Burn Bright, Mad Dog', 'Burn.Bright.Mad.Dog'],
	['Another Domestic Disaster?', 'Another.Domestic.Disaster'],
	['The Journey’s End', 'The.Journeys.End'],
	["The.Journey's.End", 'The.Journeys.End'],
	["JoJo's Bizarre Adventure", 'JoJos.Bizarre.Adventure'],
	["Don't Stop Me Now", 'Dont.Stop.Me.Now'],
	["O'Brien's Pub", 'OBriens.Pub'],
	["James' Journey", 'James.Journey'],
	["Rock 'n' Roll", 'Rock.n.Roll'],
	["'Twas the Night'", 'Twas.the.Night'],
	['A King-Class Water Mage', 'A.King.Class.Water.Mage'],
	['[Crunchyroll] Show (2026)', 'Crunchyroll.Show.2026'],
	['Turning   Point    4', 'Turning.Point.4'],
	['Re:Zero - Starting Life', 'Re.Zero.Starting.Life'],
	['S03E09 - Lament!', 'S03E09.Lament'],
	['already.dotted.name', 'already.dotted.name'],
	['Show.S01E01.1080p.WEB-DL', 'Show.S01E01.1080p.WEB.DL']
];

for (const [input, expected] of cases) {
	const got = name(input);
	assert.strictEqual(got, expected, `"${input}" -> "${got}" (expected "${expected}")`);
	assert.ok(!got.startsWith('.') && !got.endsWith('.'), `stray edge dot in "${got}"`);
	assert.ok(!got.includes('..'), `double dot in "${got}"`);
}
console.log(`✓ ${cases.length} filenames collapse to dots, no stray or doubled dots`);

assert.strictEqual(name('Frieren_Beyond_Journeys_End'), 'FrierenBeyondJourneysEnd');
console.log('✓ underscores are dropped');

// Generic "Episode N" placeholders (what the APIs return when an episode has no
// real title) collapse to nothing, so the template slot vanishes from the file
// name instead of printing "Episode.1".
import Helper from '../modules/module.helper';
import path from 'path';

const templateName = (episodeTitle: string): string => {
	const vars = [
		{ name: 'seriesTitle', type: 'string', replaceWith: 'Dragon Ball Super Beerus', sanitize: true },
		{ name: 'season', type: 'number', replaceWith: 1 },
		{ name: 'episode', type: 'number', replaceWith: 1 },
		{ name: 'title', type: 'string', replaceWith: Helper.episodeTitleForFilename(episodeTitle), sanitize: true },
		{ name: 'height', type: 'number', replaceWith: 1080 },
		{ name: 'service', type: 'string', replaceWith: 'CR' }
	] as Variable[];
	return parseFileName('${seriesTitle}.S${season}E${episode}.${title}.${height}p.${service}', vars, 2, []).join(path.sep);
};

assert.strictEqual(templateName('Episode 1'), 'Dragon.Ball.Super.Beerus.S01E01.1080p.CR');
console.log('✓ "Episode 1" placeholder leaves the filename without an Episode.N slot');

for (const placeholder of ['Episode 1', 'Episode 12', 'Episode 12.5', 'episode 3', 'EPISODE 7', 'Épisode 4', 'Episodio 2', 'Episódio 9', 'Folge 24', '第12話', '  Episode 5  ']) {
	assert.strictEqual(Helper.episodeTitleForFilename(placeholder), '', `"${placeholder}" should be treated as a placeholder`);
}
for (const real of ['The Journey’s End', 'Lament', ' Episode 1: The Beginning', 'Episode', 'Episódio', '第12話 『始まりの旅』']) {
	assert.strictEqual(Helper.episodeTitleForFilename(real), real.trim(), `"${real}" is a real title and must survive`);
}
assert.strictEqual(Helper.episodeTitleForFilename(undefined), '');
assert.strictEqual(Helper.episodeTitleForFilename(null), '');
assert.strictEqual(Helper.episodeTitleForFilename('   '), '');
console.log('✓ placeholder detection: localized variants dropped, real titles and prefixed titles kept');

console.log('\nAll filename tests passed.');
