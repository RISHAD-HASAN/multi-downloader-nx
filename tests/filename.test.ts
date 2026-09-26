// Scene-style filenames: whitespace and punctuation collapse into dots, including
// the full-width colon (U+FF1A) Windows substitutes for ':'.
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
	['The Journey’s End', 'The.Journey.s.End'],
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

// Underscores are dropped
assert.strictEqual(name('Frieren_Beyond_Journeys_End'), 'FrierenBeyondJourneysEnd');
console.log('✓ underscores are dropped');

console.log('\nAll filename tests passed.');
