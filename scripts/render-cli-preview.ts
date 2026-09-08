// Renders a representative Crunchyroll CLI session with the unshackle-style
// console, in every available theme, and writes an HTML preview.
// Dev tool only - not part of the shipped CLI.
import fs from 'fs';
import {
	GradientBar,
	Group,
	Padding,
	Panel,
	Progress,
	RichConsole,
	Rule,
	Table,
	Text,
	Tree,
	PALETTES,
	setTheme,
	stripAnsi
} from '../modules/module.rich';

const WIDTH = 104;

function session(themeName: string): string {
	setTheme(themeName);
	const out: string[] = [];
	const c = new RichConsole({ width: WIDTH, forceTerminal: true, logPadding: [0, 5] });
	c.write = (s: string) => void out.push(s);

	// banner
	c.print(
		new Padding(
			new Group(
				new Text(
					' ▄▄▄· ▐ ▄ ▪  ·▄▄▄▄  ▄▄▌  \n' +
						'▐█ ▀█ •█▌▐███ ██▪ ██ ██•  \n' +
						'▄█▀▀█ ▐█▐▐▌▐█·▐█· ▐█▌██▪  \n' +
						'▐█ ▪▐▌██▐█▌▐█▌██. ██ ▐█▌▐▌\n' +
						' ▀  ▀ ▀▀ █▪▀▀▀▀▀▀▀▀• .▀▀▀ ',
					{ style: 'ascii.art', justify: 'center' }
				),
				new Text(`v [repr.number]5.8.2[/] - © 2021-2026 - github.com/anidl/multi-downloader-nx`, { justify: 'center' })
			),
			[1, 11, 1, 10]
		)
	);

	c.info('URL resolved -> service [cyan]crunchy[/], series [repr.number]GY5P48XEY[/]');
	c.info('Logged in as [green]user@example.com[/] (premium)');
	c.debug('Loaded [repr.number]2[/] key vault(s)');

	c.print(new Padding(new Rule("[rule.text]Series: Frieren: Beyond Journey's End[/]"), [1, 2]));

	const titles = new Tree('', { hideRoot: true });
	const s1 = titles.add('[repr.number]28[/] Episodes');
	s1.add(new Text('S01E01 - The Journey’s End                     [text2]jpn, eng, spa, por[/]', { style: 'text2' }));
	s1.add(new Text('S01E02 - It Didn’t Have to Be Magic            [text2]jpn, eng, spa, por[/]', { style: 'text2' }));
	s1.add(new Text('S01E03 - Killing Magic                         [text2]jpn, eng[/]', { style: 'text2' }));
	c.print(new Padding(titles, [0, 5]));

	c.print(new Padding(new Rule('[rule.text]S01E01 - The Journey’s End[/]'), [1, 2]));

	// available tracks panel
	const grid = Table.grid({ padding: [0, 1] });
	grid.columns = [{}, {}, { justify: 'right' }, {}];
	grid.addRow('[cyan]1920x1080[/]', '[text2]H.264 / avc1[/]', '[repr.number]5104[/] kb/s', '[text2]CENC[/]');
	grid.addRow('[cyan]1280x720[/]', '[text2]H.264 / avc1[/]', '[repr.number]2512[/] kb/s', '[text2]CENC[/]');
	grid.addRow('[cyan]640x360[/]', '[text2]H.264 / avc1[/]', '[repr.number]746[/] kb/s', '[text2]CENC[/]');
	c.print(new Padding(new Panel(grid, { title: '[panel.title]Available Tracks[/]', padding: [0, 1] }), [0, 5]));

	c.info('Selected [repr.number]1[/] video, [repr.number]2[/] audio, [repr.number]3[/] subtitle track(s)');
	c.info('Getting decryption keys with [cyan]widevine[/]');

	// content key tree - vault hit
	const cek = new Tree(new Text('[cyan]Widevine[/][text2](AAAAW3Bzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAADsIARIQ…)[/]'));
	cek.add('[text2]8f2c1a3b4d5e6f708192a3b4c5d6e7f8:2b7e151628aed2a6abf7158809cf4f3c[/] [text2]from Local Vault[/] [green]*[/]');
	cek.add('[text2]aabbccddeeff00112233445566778899:0123456789abcdef0123456789abcdef[/] [text2]from Local Vault[/] [green]*[/]');
	c.print(new Padding(cek, [0, 5]));
	c.debug('All [repr.number]2[/] content key(s) served from vault - licence request skipped');

	// live download table (static snapshot)
	const p = new Progress(['spinner', 'bar', '•', 'remaining', '•', 'downloaded'], { barWidth: 30 });
	const tv = p.addTask('video', { downloaded: '-' }, 100);
	// seed two samples ~8s apart so the ETA column has a real speed estimate
	p.update(tv, { completed: 20, fields: { downloaded: '121.4 MB' } });
	p.tasks[0].samples[0][0] -= 8000;
	p.tasks[0].startTime -= 8000;
	p.update(tv, { completed: 68, fields: { downloaded: '412.7 MB' } });
	const ta1 = p.addTask('audio-jpn', { downloaded: '-' }, 100);
	p.update(ta1, { completed: 100, fields: { downloaded: 'Downloaded' } });
	const ta2 = p.addTask('audio-eng', { downloaded: '-' }, 100);
	p.update(ta2, { completed: 10, fields: { downloaded: '4.4 MB' } });
	p.tasks[2].samples[0][0] -= 6000;
	p.tasks[2].startTime -= 6000;
	p.update(ta2, { completed: 41, fields: { downloaded: '18.3 MB' } });
	const ts = p.addTask('sub', { downloaded: '-' }, 100);
	p.update(ts, { completed: 100, fields: { downloaded: 'Downloaded' } });

	const dl = new Tree('', { hideRoot: true });
	const mk = (branch: Tree, label: string, taskIdx: number) => {
		const cell = Table.grid();
		cell.addRow(new Text(label, { style: 'text2' }));
		const one = new Progress(p.columns, p.opts);
		one.tasks = [p.tasks[taskIdx]];
		cell.addRow(one);
		branch.add(cell);
	};
	const vb = dl.add('[repr.number]1[/] Video');
	mk(vb, 'H.264 SDR 1920x1080 @ 5104 kb/s | avc1 | CENC', 0);
	const ab = dl.add('[repr.number]2[/] Audio');
	mk(ab, 'AAC 2.0 @ 128 kb/s | jpn | Japanese', 1);
	mk(ab, 'AAC 2.0 @ 128 kb/s | eng | English', 2);
	const sb = dl.add('[repr.number]1[/] Subtitle');
	mk(sb, 'ASS | eng | English (CC)', 3);
	c.print(new Padding(dl, [1, 5]));

	c.warn('Subtitle [text2]por-BR[/] is missing for this version, skipping');
	c.info('Muxing to [repr.path][Crunchyroll] Frieren - S01E01 [1080p].mkv[/]');
	c.error('mkvmerge reported 1 non-fatal warning');
	c.print(new Padding('Track downloads finished in [progress.elapsed]1:47[/]', [0, 5]));
	c.print(new Padding('Processed all titles in [progress.elapsed]2:14[/]', [0, 5, 1, 5]));

	return out.join('');
}

function ansiToHtml(input: string): string {
	let html = '';
	let open = false;
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const re = /\x1b\[([0-9;]*)m/g;
	let last = 0;
	let style: { fg?: string; bg?: string; bold?: boolean; dim?: boolean; underline?: boolean; italic?: boolean } = {};

	const openSpan = () => {
		const parts: string[] = [];
		if (style.fg) parts.push(`color:${style.fg}`);
		if (style.bg) parts.push(`background:${style.bg}`);
		if (style.bold) parts.push('font-weight:700');
		if (style.dim) parts.push('opacity:.65');
		if (style.underline) parts.push('text-decoration:underline');
		if (style.italic) parts.push('font-style:italic');
		if (!parts.length) return '';
		open = true;
		return `<span style="${parts.join(';')}">`;
	};

	let m: RegExpExecArray | null;
	while ((m = re.exec(input))) {
		const text = input.slice(last, m.index);
		if (text) {
			html += (open ? '' : openSpan()) + esc(text);
		}
		last = m.index + m[0].length;
		if (open) {
			html += '</span>';
			open = false;
		}
		const codes = m[1].split(';').filter(Boolean).map(Number);
		if (!codes.length || codes[0] === 0) style = {};
		for (let i = 0; i < codes.length; i++) {
			const c = codes[i];
			if (c === 1) style.bold = true;
			else if (c === 2) style.dim = true;
			else if (c === 3) style.italic = true;
			else if (c === 4) style.underline = true;
			else if (c === 38 && codes[i + 1] === 2) {
				style.fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
				i += 4;
			} else if (c === 48 && codes[i + 1] === 2) {
				style.bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
				i += 4;
			}
		}
	}
	const tail = input.slice(last);
	if (tail) html += (open ? '' : openSpan()) + esc(tail);
	if (open) html += '</span>';
	return html;
}

const themes = Object.keys(PALETTES);
const blocks = themes
	.map((t) => {
		const bg = PALETTES[t].bg;
		return `<section>
  <h2>${t}</h2>
  <pre style="background:${bg}">${ansiToHtml(session(t))}</pre>
</section>`;
	})
	.join('\n');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>aniDL - unshackle-style CLI output</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:32px; background:#14141c; color:#cdd6f4;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.sub { color:#a2a9c1; margin:0 0 28px; font-size:14px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.09em; color:#f5c2e7;
       margin:32px 0 8px; font-weight:600; }
  pre { margin:0; padding:18px 20px; border-radius:10px; overflow-x:auto;
        font-family: "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace;
        font-size:12px; line-height:1.5; border:1px solid rgba(255,255,255,.07); }
  section { margin-bottom:8px; }
</style></head>
<body>
  <h1>aniDL &mdash; unshackle-style CLI output</h1>
  <p class="sub">Rendered by <code>modules/module.rich.ts</code>. Same session shown in each built-in palette (<code>--theme</code>).</p>
  ${blocks}
</body></html>`;

fs.writeFileSync('cli-preview.html', html);
console.log('wrote cli-preview.html (' + themes.length + ' themes)');
