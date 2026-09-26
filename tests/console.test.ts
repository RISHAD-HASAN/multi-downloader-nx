// Regression tests for the console renderer.
// The rich console replaced log4js, so it must preserve `util.format`
// substitution (`%s`, `%d`, …) used by ~29 existing call sites, plus markup,
// wrapping and colour-disabling behaviour.
import assert from 'assert';
import { cekTree } from '../modules/module.console';
import { RichConsole, Text, Tree, Padding, Table, stripAnsi, stripMarkup, renderMarkup, setTheme, theme, textWidth } from '../modules/module.rich';

function capture(fn: (c: RichConsole) => void, opts: any = {}): string {
	const out: string[] = [];
	const c = new RichConsole({ width: 100, forceTerminal: false, ...opts });
	c.write = (s: string) => void out.push(s);
	fn(c);
	return out.join('');
}

setTheme('catppuccin-mocha');

// ── 1. util.format parity with the old log4js logger ───────────────────────
{
	const t = capture((c) => {
		c.info('Your Country: %s', 'BD');
		c.info('USER: %s (%s)', 'alice', 'a@b.c');
		c.info('%s[S%sE%s] %s', '✓ ', 1, 2, 'The Journey');
		c.info('count %d and %i', 3.7, 4.2);
		c.info('plain', 'multi', 'args');
		c.info('obj:', { a: 1, b: [2, 3] });
	});
	for (const expect of [
		'Your Country: BD',
		'USER: alice (a@b.c)',
		'✓ [S1E2] The Journey',
		'count 3.7 and 4',
		'plain multi args',
		'a: 1'
	]) {
		assert.ok(t.includes(expect), `missing substitution result: ${expect}`);
	}
	assert.ok(!t.includes('%s'), 'unsubstituted %s left in output');
	console.log('✓ util.format substitution (%s/%d/%i, multi-arg, objects)');
}

// ── 2. Errors render with their stack ──────────────────────────────────────
{
	const t = capture((c) => c.error(new Error('boom')));
	assert.ok(t.includes('Error: boom'), 'error message missing');
	assert.ok(t.includes('ERROR'), 'error level label missing');
	console.log('✓ Error objects render with level label and stack');
}

// ── 3. Log levels filter correctly ─────────────────────────────────────────
{
	const t = capture((c) => {
		c.level = 'warning';
		c.debug('nope-debug');
		c.info('nope-info');
		c.warn('yes-warn');
		c.error('yes-error');
	});
	assert.ok(!t.includes('nope-debug') && !t.includes('nope-info'), 'level filter let through low levels');
	assert.ok(t.includes('yes-warn') && t.includes('yes-error'), 'level filter dropped high levels');
	console.log('✓ log level filtering');
}

// ── 4. Markup: known tags style, unknown tags stay literal ─────────────────
{
	assert.strictEqual(stripMarkup('[cyan]hi[/]'), 'hi');
	// tags aniDL already prints in real log lines must survive untouched
	assert.strictEqual(stripMarkup('[INFO] done'), '[INFO] done');
	assert.strictEqual(stripMarkup('[Crunchyroll] S01E01 [1080p]'), '[Crunchyroll] S01E01 [1080p]');
	assert.strictEqual(stripAnsi(renderMarkup('[cyan]hi[/]')), 'hi');
	assert.strictEqual(stripAnsi(renderMarkup('[1080p] x')), '[1080p] x');
	const t = capture((c) => c.info('[Crunchyroll] Frieren - S01E01 [1080p]'));
	assert.ok(t.includes('[Crunchyroll]') && t.includes('[1080p]'), 'literal brackets were eaten');
	console.log('✓ markup: styled tags applied, unknown/bracketed text preserved');
}

// ── 5. Colour can be fully disabled ────────────────────────────────────────
{
	const prev = theme.enabled;
	theme.enabled = false;
	const t = capture((c) => c.info('[cyan]hello[/]'));
	assert.strictEqual(t.includes('\x1b['), false, 'ANSI emitted while colour disabled');
	assert.ok(t.includes('hello'));
	theme.enabled = prev;
	console.log('✓ colour disabling produces clean plain text');
}

// ── 6. Wrapping keeps a hanging indent and never exceeds the width ─────────
{
	const long = 'lorem ipsum dolor sit amet '.repeat(12);
	const t = capture((c) => c.info(long), { width: 60 });
	const lines = t.split('\n').filter(Boolean).map(stripAnsi);
	assert.ok(lines.length > 1, 'long line did not wrap');
	for (const l of lines) assert.ok(textWidth(l) <= 60, `line exceeds width: ${textWidth(l)}`);
	for (const l of lines) assert.ok(l.startsWith('     '), 'wrapped line lost its indent');
	console.log('✓ wrapping respects width and hanging indent');
}

// ── 7. Renderables produce bounded output ──────────────────────────────────
{
	const tree = new Tree('', { hideRoot: true });
	const b = tree.add('[repr.number]2[/] Videos');
	b.add(new Text('H.264 1920x1080', { style: 'text2' }));
	b.add(new Text('H.264 1280x720', { style: 'text2' }));
	const grid = Table.grid({ padding: [0, 1] });
	grid.addRow('a', 'b', 'c');
	const t = capture((c) => {
		c.print(new Padding(tree, [0, 5]));
		c.print(new Padding(grid, [0, 5]));
		c.rule('Section');
	});
	const lines = t.split('\n').filter(Boolean).map(stripAnsi);
	for (const l of lines) assert.ok(textWidth(l) <= 100, `renderable overflowed: ${textWidth(l)}`);
	assert.ok(t.includes('Videos') && t.includes('1920x1080'), 'tree content missing');
	assert.ok(t.includes('Section'), 'rule title missing');
	console.log('✓ tree/grid/rule render within the console width');
}

// ── 8. CJK width accounting ────────────────────────────────────────────────
{
	assert.strictEqual(textWidth('葬送のフリーレン'), 16, 'CJK glyphs must count as 2 columns');
	assert.strictEqual(textWidth('abc'), 3);
	const t = capture((c) => c.info('葬送のフリーレン '.repeat(20)), { width: 50 });
	for (const l of t.split('\n').filter(Boolean).map(stripAnsi)) {
		assert.ok(textWidth(l) <= 50, `CJK line overflowed: ${textWidth(l)}`);
	}
	console.log('✓ CJK-aware width measurement and wrapping');
}

{
	const text = capture(c => c.print(cekTree('Widevine', 'private-pssh', [{ kid: 'private-kid', key: 'private-key', from: 'Local Vault' }])));
	for (const secret of ['private-pssh', 'private-kid', 'private-key']) assert.ok(!text.includes(secret));
	assert.ok(text.includes('Widevine') && text.includes('*') && text.includes('Local Vault'));
	console.log('✓ DRM trees mask PSSH, key IDs and content keys');
}
console.log('\nAll console tests passed.');
