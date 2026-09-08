/**
 * module.rich.ts — a dependency-free re-implementation of the parts of Python's
 * `rich` library that unshackle relies on for its console presentation.
 *
 * Ported for multi-downloader-nx so the CLI can render unshackle-style output:
 * themed palettes, markup, rules, panels, trees, grids, gradient progress bars
 * and in-place `Live` regions.
 *
 * Origin: concepts from https://github.com/unshackle-dl/unshackle
 *   (unshackle/core/console.py, unshackle/core/themes.py)
 */

import { format as nodeFormat, inspect as nodeInspectRaw } from 'util';

const nodeInspect = (v: unknown) => nodeInspectRaw(v, { depth: 4, colors: false, breakLength: 120 });

/* ────────────────────────────────────────────────────────────── palettes ── */

export type Palette = Record<string, string>;

export const DEFAULT_THEME = 'catppuccin-mocha';

export const PALETTES: Record<string, Palette> = {
	'catppuccin-mocha': {
		bg: 'rgb(30,30,46)',
		text: 'rgb(205,214,244)',
		text2: 'rgb(162,169,193)',
		black: 'rgb(69,71,90)',
		bright_black: 'rgb(88,91,112)',
		red: 'rgb(243,139,168)',
		green: 'rgb(166,227,161)',
		yellow: 'rgb(249,226,175)',
		blue: 'rgb(137,180,250)',
		pink: 'rgb(245,194,231)',
		cyan: 'rgb(148,226,213)',
		gray: 'rgb(166,173,200)',
		bright_gray: 'rgb(186,194,222)',
		dark_gray: 'rgb(54,54,84)'
	},
	dracula: {
		bg: '#282a36',
		text: '#f8f8f2',
		text2: '#b8bfd8',
		black: '#21222c',
		bright_black: '#6272a4',
		red: '#ff5555',
		green: '#50fa7b',
		yellow: '#f1fa8c',
		blue: '#bd93f9',
		pink: '#ff79c6',
		cyan: '#8be9fd',
		gray: '#6272a4',
		bright_gray: '#e9e9f4',
		dark_gray: '#44475a'
	},
	nord: {
		bg: '#2e3440',
		text: '#d8dee9',
		text2: '#9aa4b8',
		black: '#3b4252',
		bright_black: '#4c566a',
		red: '#bf616a',
		green: '#a3be8c',
		yellow: '#ebcb8b',
		blue: '#81a1c1',
		pink: '#b48ead',
		cyan: '#88c0d0',
		gray: '#616e88',
		bright_gray: '#e5e9f0',
		dark_gray: '#434c5e'
	},
	gruvbox: {
		bg: '#282828',
		text: '#ebdbb2',
		text2: '#bdae93',
		black: '#504945',
		bright_black: '#665c54',
		red: '#fb4934',
		green: '#b8bb26',
		yellow: '#fabd2f',
		blue: '#83a598',
		pink: '#d3869b',
		cyan: '#8ec07c',
		gray: '#928374',
		bright_gray: '#d5c4a1',
		dark_gray: '#3c3836'
	},
	'one-dark': {
		bg: '#282c34',
		text: '#abb2bf',
		text2: '#818896',
		black: '#3b4048',
		bright_black: '#5c6370',
		red: '#e06c75',
		green: '#98c379',
		yellow: '#e5c07b',
		blue: '#61afef',
		pink: '#c678dd',
		cyan: '#56b6c2',
		gray: '#5c6370',
		bright_gray: '#b6bdca',
		dark_gray: '#3e4451'
	},
	mono: {
		bg: '#000000',
		text: '#d0d0d0',
		text2: '#9e9e9e',
		black: '#3a3a3a',
		bright_black: '#585858',
		red: '#d0d0d0',
		green: '#d0d0d0',
		yellow: '#d0d0d0',
		blue: '#d0d0d0',
		pink: '#d0d0d0',
		cyan: '#d0d0d0',
		gray: '#9e9e9e',
		bright_gray: '#c6c6c6',
		dark_gray: '#444444'
	}
};

export function resolvePalette(name?: string): Palette | undefined {
	if (!name) return PALETTES[DEFAULT_THEME];
	return PALETTES[name.toLowerCase()];
}

/* ───────────────────────────────────────────────────────────────── colour ── */

export type RGB = [number, number, number];

export function parseColor(value: string): RGB | undefined {
	if (!value) return undefined;
	const v = value.trim();
	const hex = /^#([0-9a-f]{6})$/i.exec(v);
	if (hex) {
		const n = parseInt(hex[1], 16);
		return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
	}
	const rgb = /^rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)$/i.exec(v);
	if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
	return undefined;
}

export function blendRGB(a: RGB, b: RGB, ratio: number): RGB {
	const r = Math.max(0, Math.min(1, ratio));
	return [
		Math.round(a[0] + (b[0] - a[0]) * r),
		Math.round(a[1] + (b[1] - a[1]) * r),
		Math.round(a[2] + (b[2] - a[2]) * r)
	];
}

const fg = (c: RGB) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bgSeq = (c: RGB) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
export const RESET = '\x1b[0m';

/* ──────────────────────────────────────────────────────────────── styling ── */

export interface Style {
	color?: RGB;
	bgColor?: RGB;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
}

function mergeStyle(base: Style, over: Style): Style {
	return { ...base, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) };
}

export function styleToAnsi(s: Style): string {
	let out = '';
	if (s.bold) out += '\x1b[1m';
	if (s.dim) out += '\x1b[2m';
	if (s.italic) out += '\x1b[3m';
	if (s.underline) out += '\x1b[4m';
	if (s.strike) out += '\x1b[9m';
	if (s.color) out += fg(s.color);
	if (s.bgColor) out += bgSeq(s.bgColor);
	return out;
}

/**
 * A theme maps semantic style names ("log.level.error", "repr.number") onto
 * concrete styles, exactly like rich's Theme + unshackle's palette roles.
 */
export class Theme {
	public palette: Palette;
	public styles: Record<string, Style> = {};
	public enabled = true;

	constructor(palette: Palette = PALETTES[DEFAULT_THEME], enabled = true) {
		this.palette = palette;
		this.enabled = enabled;
		this.build();
	}

	private c(name: string): RGB | undefined {
		return parseColor(this.palette[name] ?? name);
	}

	private build() {
		const p = this.palette;
		const col = (n: string): Style => ({ color: parseColor(p[n] ?? n) });
		const s: Record<string, Style> = {
			// palette roles
			text: col('text'),
			text2: col('text2'),
			red: col('red'),
			green: col('green'),
			yellow: col('yellow'),
			blue: col('blue'),
			pink: col('pink'),
			cyan: col('cyan'),
			gray: col('gray'),
			grey: col('gray'),
			black: col('black'),
			bright_black: col('bright_black'),
			bright_gray: col('bright_gray'),
			dark_gray: col('dark_gray'),
			magenta: col('pink'),
			white: col('text'),

			// generic
			bold: { bold: true },
			b: { bold: true },
			dim: { dim: true },
			d: { dim: true },
			italic: { italic: true },
			i: { italic: true },
			underline: { underline: true },
			u: { underline: true },
			strike: { strike: true },

			// rich semantic styles used by unshackle
			'ascii.art': { ...col('pink'), bold: true },
			'rule.line': col('dark_gray'),
			'rule.text': { ...col('pink'), bold: true },
			'log.time': col('bright_black'),
			'log.message': col('text'),
			'log.path': col('bright_black'),
			'log.level.debug': col('bright_black'),
			'log.level.info': col('cyan'),
			'log.level.warning': col('yellow'),
			'log.level.error': col('red'),
			'log.level.critical': { ...col('red'), bold: true },
			'logging.level.debug': col('bright_black'),
			'logging.level.info': col('cyan'),
			'logging.level.warning': col('yellow'),
			'logging.level.error': col('red'),
			'logging.level.critical': { ...col('red'), bold: true },
			'repr.number': col('cyan'),
			'repr.str': col('green'),
			'repr.bool_true': col('green'),
			'repr.bool_false': col('red'),
			'repr.none': col('pink'),
			'repr.path': col('blue'),
			'repr.url': { ...col('blue'), underline: true },
			'repr.tag_name': col('pink'),
			'progress.description': col('text'),
			'progress.percentage': col('pink'),
			'progress.elapsed': col('yellow'),
			'progress.remaining': col('cyan'),
			'progress.data.speed': col('green'),
			'progress.download': col('green'),
			'bar.complete': col('pink'),
			'bar.finished': col('green'),
			'bar.pulse': col('pink'),
			'bar.back': col('dark_gray'),
			'panel.border': col('dark_gray'),
			'panel.title': { ...col('pink'), bold: true },
			'tree.line': col('dark_gray'),
			'status.spinner': col('pink'),
			'table.header': { ...col('pink'), bold: true },
			success: col('green'),
			warning: col('yellow'),
			error: col('red'),
			info: col('cyan')
		};
		this.styles = s;
	}

	public get(name: string): Style | undefined {
		const key = name.trim();
		if (this.styles[key]) return this.styles[key];
		// support "bold cyan" style combos
		if (key.includes(' ')) {
			let acc: Style = {};
			let ok = false;
			for (const part of key.split(/\s+/)) {
				const st = this.get(part);
				if (st) {
					acc = mergeStyle(acc, st);
					ok = true;
				}
			}
			if (ok) return acc;
		}
		const direct = parseColor(key);
		if (direct) return { color: direct };
		if (key.startsWith('on ')) {
			const c = this.c(key.slice(3));
			if (c) return { bgColor: c };
		}
		return undefined;
	}
}

export let theme = new Theme();

export function setTheme(name?: string, enabled = true) {
	theme = new Theme(resolvePalette(name) ?? PALETTES[DEFAULT_THEME], enabled);
	return theme;
}

/* ─────────────────────────────────────────────────────────── text/markup ── */

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, '');
}

/** Visible width of a string, accounting for wide CJK glyphs. */
export function textWidth(s: string): number {
	const plain = stripAnsi(s);
	let w = 0;
	for (const ch of plain) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp === 0x200b) continue;
		if (
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe30 && cp <= 0xfe6f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1f64f) ||
			(cp >= 0x1f900 && cp <= 0x1f9ff)
		)
			w += 2;
		else w += 1;
	}
	return w;
}

export function padTo(s: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
	const w = textWidth(s);
	if (w >= width) return s;
	const diff = width - w;
	if (align === 'right') return ' '.repeat(diff) + s;
	if (align === 'center') {
		const l = Math.floor(diff / 2);
		return ' '.repeat(l) + s + ' '.repeat(diff - l);
	}
	return s + ' '.repeat(diff);
}

/** Truncate to a visible width, preserving ANSI sequences. */
export function truncateVisible(s: string, width: number, ellipsis = '…'): string {
	if (textWidth(s) <= width) return s;
	let out = '';
	let w = 0;
	let i = 0;
	const limit = Math.max(0, width - textWidth(ellipsis));
	while (i < s.length) {
		const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
		if (m) {
			out += m[0];
			i += m[0].length;
			continue;
		}
		const ch = String.fromCodePoint(s.codePointAt(i)!);
		const cw = textWidth(ch);
		if (w + cw > limit) break;
		out += ch;
		w += cw;
		i += ch.length;
	}
	return out + ellipsis + RESET;
}

/**
 * Render rich-style console markup: `[cyan]hi[/]`, `[bold red]x[/bold red]`,
 * `[repr.number]5[/]`. Unknown tags are left as literal text (rich behaviour).
 * Escape a literal bracket with `\[`.
 */
export function renderMarkup(input: string, base: Style = {}): string {
	if (!theme.enabled) return stripMarkup(input);
	const stack: Style[] = [base];
	let out = styleToAnsi(base);
	let i = 0;
	const src = String(input);
	while (i < src.length) {
		if (src[i] === '\\' && src[i + 1] === '[') {
			out += '[';
			i += 2;
			continue;
		}
		if (src[i] === '[') {
			const close = src.indexOf(']', i);
			if (close !== -1) {
				const tag = src.slice(i + 1, close);
				if (tag === '/' || tag === '') {
					if (tag === '/') {
						if (stack.length > 1) stack.pop();
						out += RESET + styleToAnsi(stack[stack.length - 1]);
						i = close + 1;
						continue;
					}
				} else if (tag.startsWith('/')) {
					if (theme.get(tag.slice(1))) {
						if (stack.length > 1) stack.pop();
						out += RESET + styleToAnsi(stack[stack.length - 1]);
						i = close + 1;
						continue;
					}
				} else {
					const st = theme.get(tag);
					if (st) {
						const merged = mergeStyle(stack[stack.length - 1], st);
						stack.push(merged);
						out += RESET + styleToAnsi(merged);
						i = close + 1;
						continue;
					}
				}
			}
		}
		out += src[i];
		i++;
	}
	return out + RESET;
}

/** Remove markup tags without emitting colour (for non-TTY / log files). */
export function stripMarkup(input: string): string {
	let out = '';
	let i = 0;
	const src = String(input);
	while (i < src.length) {
		if (src[i] === '\\' && src[i + 1] === '[') {
			out += '[';
			i += 2;
			continue;
		}
		if (src[i] === '[') {
			const close = src.indexOf(']', i);
			if (close !== -1) {
				const tag = src.slice(i + 1, close);
				if (tag === '/' || tag.startsWith('/') || theme.get(tag)) {
					i = close + 1;
					continue;
				}
			}
		}
		out += src[i];
		i++;
	}
	return out;
}

/* ────────────────────────────────────────────────────────── renderables ── */

export interface Renderable {
	/** Render to a list of lines, each at most `width` visible columns. */
	render(width: number): string[];
	/** Preferred (minimum sensible) width. */
	measure?(maxWidth: number): number;
}

export type RenderInput = Renderable | string;

export function toRenderable(x: RenderInput): Renderable {
	return typeof x === 'string' ? new Text(x) : x;
}

function renderLines(x: RenderInput, width: number): string[] {
	return toRenderable(x).render(width);
}

function measureOf(x: RenderInput, maxWidth: number): number {
	const r = toRenderable(x);
	if (r.measure) return r.measure(maxWidth);
	return Math.max(0, ...r.render(maxWidth).map(textWidth));
}

/** Plain (optionally markup'd, optionally wrapped) text. */
export class Text implements Renderable {
	constructor(
		public content: string,
		public opts: { style?: string; justify?: 'left' | 'center' | 'right'; wrap?: boolean; overflow?: 'fold' | 'ellipsis' | 'crop' } = {}
	) {}

	static assemble(...parts: Array<[string, string?]>): Text {
		return new Text(parts.map(([t, s]) => (s ? `[${s}]${t}[/]` : t)).join(''));
	}

	measure(maxWidth: number): number {
		return Math.min(maxWidth, Math.max(0, ...String(this.content).split('\n').map((l) => textWidth(stripMarkup(l)))));
	}

	render(width: number): string[] {
		const baseStyle = this.opts.style ? theme.get(this.opts.style) ?? {} : {};
		const rawLines = String(this.content).split('\n');
		const out: string[] = [];
		for (const raw of rawLines) {
			const plainW = textWidth(stripMarkup(raw));
			if (plainW <= width || width <= 0) {
				out.push(this.justify(renderMarkup(raw, baseStyle), plainW, width));
				continue;
			}
			if (this.opts.overflow === 'ellipsis') {
				out.push(truncateVisible(renderMarkup(raw, baseStyle), width));
				continue;
			}
			if (this.opts.wrap === false || this.opts.overflow === 'crop') {
				out.push(truncateVisible(renderMarkup(raw, baseStyle), width, ''));
				continue;
			}
			// fold: wrap on words, preserving markup by wrapping the plain text then
			// re-rendering each produced chunk (markup spans are per-line in practice).
			for (const chunk of wrapMarkup(raw, width)) {
				out.push(this.justify(renderMarkup(chunk, baseStyle), textWidth(stripMarkup(chunk)), width));
			}
		}
		return out;
	}

	private justify(rendered: string, plainW: number, width: number): string {
		const j = this.opts.justify ?? 'left';
		if (j === 'left' || width <= 0 || plainW >= width) return rendered;
		const diff = width - plainW;
		if (j === 'right') return ' '.repeat(diff) + rendered;
		const l = Math.floor(diff / 2);
		return ' '.repeat(l) + rendered;
	}
}

/** Word-wrap a markup string to `width` visible columns, keeping tags intact. */
export function wrapMarkup(src: string, width: number): string[] {
	const tokens = src.split(/(\s+)/);
	const lines: string[] = [];
	let cur = '';
	let curW = 0;
	for (const tok of tokens) {
		const tw = textWidth(stripMarkup(tok));
		if (curW + tw > width && curW > 0) {
			lines.push(cur.replace(/\s+$/, ''));
			cur = '';
			curW = 0;
			if (/^\s+$/.test(tok)) continue;
		}
		if (tw > width && !/^\s+$/.test(tok)) {
			// hard-break an over-long token
			let rest = tok;
			while (textWidth(stripMarkup(rest)) > width) {
				let take = '';
				for (const ch of rest) {
					if (textWidth(stripMarkup(take + ch)) > width - curW) break;
					take += ch;
				}
				if (!take) break;
				lines.push(cur + take);
				rest = rest.slice(take.length);
				cur = '';
				curW = 0;
			}
			cur = rest;
			curW = textWidth(stripMarkup(rest));
			continue;
		}
		cur += tok;
		curW += tw;
	}
	if (cur.trim() !== '' || lines.length === 0) lines.push(cur.replace(/\s+$/, ''));
	return lines;
}

/** Vertical stack of renderables (rich.console.Group). */
export class Group implements Renderable {
	public items: RenderInput[];
	constructor(...items: RenderInput[]) {
		this.items = items;
	}
	measure(maxWidth: number): number {
		return Math.max(0, ...this.items.map((i) => measureOf(i, maxWidth)));
	}
	render(width: number): string[] {
		return this.items.flatMap((i) => renderLines(i, width));
	}
}

export type PaddingDims = number | [number, number] | [number, number, number, number];

function unpackPadding(p: PaddingDims): [number, number, number, number] {
	if (typeof p === 'number') return [p, p, p, p];
	if (p.length === 2) return [p[0], p[1], p[0], p[1]];
	return p;
}

/** rich.padding.Padding — the (0, 5) indent that gives unshackle its look. */
export class Padding implements Renderable {
	constructor(
		public inner: RenderInput,
		public pad: PaddingDims = 0,
		public expand = true
	) {}
	measure(maxWidth: number): number {
		const [, r, , l] = unpackPadding(this.pad);
		return Math.min(maxWidth, measureOf(this.inner, Math.max(1, maxWidth - l - r)) + l + r);
	}
	render(width: number): string[] {
		const [top, right, bottom, left] = unpackPadding(this.pad);
		const inner = Math.max(1, width - left - right);
		const lines = renderLines(this.inner, inner);
		const out: string[] = [];
		const blank = this.expand ? ' '.repeat(Math.min(width, left + inner + right)) : '';
		for (let i = 0; i < top; i++) out.push(blank);
		for (const l of lines) out.push(' '.repeat(left) + l + (this.expand ? ' '.repeat(Math.max(0, right)) : ''));
		for (let i = 0; i < bottom; i++) out.push(blank);
		return out;
	}
}

/** rich.rule.Rule — a horizontal divider with an optional centred title. */
export class Rule implements Renderable {
	constructor(
		public title = '',
		public opts: { characters?: string; style?: string; align?: 'left' | 'center' | 'right' } = {}
	) {}
	render(width: number): string[] {
		const ch = this.opts.characters ?? '─';
		const lineStyle = theme.get(this.opts.style ?? 'rule.line') ?? {};
		const paint = (s: string) => (theme.enabled ? styleToAnsi(lineStyle) + s + RESET : s);
		if (!this.title) return [paint(ch.repeat(Math.max(0, width)))];
		const titleTxt = ' ' + renderMarkup(this.title) + ' ';
		const tw = textWidth(titleTxt);
		if (tw + 4 > width) return [paint(ch.repeat(Math.max(0, width)))];
		const align = this.opts.align ?? 'center';
		let left: number;
		if (align === 'left') left = 2;
		else if (align === 'right') left = width - tw - 2;
		else left = Math.floor((width - tw) / 2);
		const right = width - tw - left;
		return [paint(ch.repeat(left)) + titleTxt + paint(ch.repeat(Math.max(0, right)))];
	}
}

export const BOX = {
	ROUNDED: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
	SQUARE: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
	HEAVY: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
	DOUBLE: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' }
};

/** rich.panel.Panel */
export class Panel implements Renderable {
	constructor(
		public inner: RenderInput,
		public opts: {
			title?: string;
			subtitle?: string;
			box?: typeof BOX.ROUNDED;
			borderStyle?: string;
			padding?: PaddingDims;
			expand?: boolean;
		} = {}
	) {}
	measure(maxWidth: number): number {
		const [, pr, , pl] = unpackPadding(this.opts.padding ?? [0, 1]);
		return Math.min(maxWidth, measureOf(this.inner, Math.max(1, maxWidth - 2 - pl - pr)) + 2 + pl + pr);
	}
	render(width: number): string[] {
		const box = this.opts.box ?? BOX.ROUNDED;
		const bs = theme.get(this.opts.borderStyle ?? 'panel.border') ?? {};
		const paint = (s: string) => (theme.enabled ? styleToAnsi(bs) + s + RESET : s);
		const outer = this.opts.expand === false ? Math.min(width, this.measure(width)) : width;
		const [pt, pr, pb, pl] = unpackPadding(this.opts.padding ?? [0, 1]);
		const innerW = Math.max(1, outer - 2 - pl - pr);
		const body = renderLines(this.inner, innerW);

		const mkEdge = (l: string, r: string, title?: string) => {
			const bar = outer - 2;
			if (!title) return paint(l + box.h.repeat(bar) + r);
			const t = ' ' + renderMarkup(title) + ' ';
			const tw = textWidth(t);
			if (tw + 2 > bar) return paint(l + box.h.repeat(bar) + r);
			const lead = Math.floor((bar - tw) / 2);
			return paint(l + box.h.repeat(lead)) + t + paint(box.h.repeat(bar - tw - lead) + r);
		};

		const out: string[] = [mkEdge(box.tl, box.tr, this.opts.title)];
		const padLine = () => paint(box.v) + ' '.repeat(outer - 2) + paint(box.v);
		for (let i = 0; i < pt; i++) out.push(padLine());
		for (const line of body) {
			out.push(paint(box.v) + ' '.repeat(pl) + padTo(line, innerW) + ' '.repeat(pr) + paint(box.v));
		}
		for (let i = 0; i < pb; i++) out.push(padLine());
		out.push(mkEdge(box.bl, box.br, this.opts.subtitle));
		return out;
	}
}

/** rich.tree.Tree */
export class Tree implements Renderable {
	public children: Tree[] = [];
	constructor(
		public label: RenderInput,
		public opts: { hideRoot?: boolean; guideStyle?: string } = {}
	) {}
	add(label: RenderInput, opts?: { guideStyle?: string }): Tree {
		const node = new Tree(label, { guideStyle: opts?.guideStyle ?? this.opts.guideStyle });
		this.children.push(node);
		return node;
	}
	measure(maxWidth: number): number {
		return maxWidth;
	}
	render(width: number): string[] {
		const gs = theme.get(this.opts.guideStyle ?? 'tree.line') ?? {};
		const paint = (s: string) => (theme.enabled ? styleToAnsi(gs) + s + RESET : s);
		const out: string[] = [];
		const walk = (node: Tree, prefixFirst: string, prefixRest: string, isRoot: boolean) => {
			if (!(isRoot && this.opts.hideRoot)) {
				const avail = Math.max(1, width - textWidth(stripAnsi(prefixFirst)));
				const lines = renderLines(node.label, avail);
				lines.forEach((l, i) => out.push((i === 0 ? paint(prefixFirst) : paint(prefixRest)) + l));
			}
			const kids = node.children;
			kids.forEach((kid, idx) => {
				const last = idx === kids.length - 1;
				const childFirst = (isRoot && this.opts.hideRoot ? '' : prefixRest) + (last ? '└── ' : '├── ');
				const childRest = (isRoot && this.opts.hideRoot ? '' : prefixRest) + (last ? '    ' : '│   ');
				walk(kid, childFirst, childRest, false);
			});
		};
		walk(this, '', '', true);
		return out;
	}
}

export interface ColumnSpec {
	header?: string;
	justify?: 'left' | 'right' | 'center';
	style?: string;
	width?: number;
	ratio?: number;
	noWrap?: boolean;
}

/**
 * rich.table.Table — supports `Table.grid()` (invisible layout table, what
 * unshackle uses everywhere) and bordered tables with headers.
 */
export class Table implements Renderable {
	public rows: RenderInput[][] = [];
	public columns: ColumnSpec[] = [];
	public showHeader = false;
	public showEdge = false;
	public padding: [number, number] = [0, 0];
	public expand = false;
	public title?: string;
	public box = BOX.ROUNDED;

	static grid(opts: { padding?: [number, number]; expand?: boolean; columns?: ColumnSpec[] } = {}): Table {
		const t = new Table();
		t.showHeader = false;
		t.showEdge = false;
		t.padding = opts.padding ?? [0, 0];
		t.expand = opts.expand ?? false;
		t.columns = opts.columns ?? [];
		return t;
	}

	addColumn(spec: ColumnSpec = {}) {
		this.columns.push(spec);
		return this;
	}

	addRow(...cells: RenderInput[]) {
		this.rows.push(cells);
		while (this.columns.length < cells.length) this.columns.push({});
		return this;
	}

	/** Replace an existing row in place — used by the live download table. */
	setRow(index: number, ...cells: RenderInput[]) {
		this.rows[index] = cells;
	}

	measure(maxWidth: number): number {
		const widths = this.computeWidths(maxWidth);
		const [, hp] = this.padding;
		const borders = this.showEdge ? this.columns.length + 1 : Math.max(0, this.columns.length - 1);
		return Math.min(maxWidth, widths.reduce((a, b) => a + b, 0) + borders + hp * 2 * this.columns.length);
	}

	private computeWidths(width: number): number[] {
		const n = this.columns.length;
		if (n === 0) return [];
		const [, hp] = this.padding;
		const sepCount = this.showEdge ? n + 1 : Math.max(0, n - 1);
		const avail = Math.max(n, width - sepCount - hp * 2 * n);
		const natural: number[] = [];
		for (let c = 0; c < n; c++) {
			const spec = this.columns[c];
			if (spec.width) {
				natural.push(spec.width);
				continue;
			}
			let w = spec.header ? textWidth(stripMarkup(spec.header)) : 0;
			for (const row of this.rows) if (row[c] !== undefined) w = Math.max(w, measureOf(row[c], avail));
			natural.push(w);
		}
		const total = natural.reduce((a, b) => a + b, 0);
		if (total <= avail) {
			if (this.expand && total < avail) {
				const flexIdx = this.columns.map((c, i) => (c.ratio ? i : -1)).filter((i) => i >= 0);
				const targets = flexIdx.length ? flexIdx : [n - 1];
				let extra = avail - total;
				for (const i of targets) {
					const share = Math.floor(extra / targets.length);
					natural[i] += share;
				}
				extra -= Math.floor(extra / targets.length) * targets.length;
				natural[targets[targets.length - 1]] += extra;
			}
			return natural;
		}
		// shrink flexible columns proportionally
		const scale = avail / total;
		const scaled = natural.map((w) => Math.max(1, Math.floor(w * scale)));
		let diff = avail - scaled.reduce((a, b) => a + b, 0);
		let i = 0;
		while (diff > 0) {
			scaled[i % n]++;
			diff--;
			i++;
		}
		return scaled;
	}

	render(width: number): string[] {
		const n = this.columns.length;
		if (n === 0) return [];
		const widths = this.computeWidths(width);
		const [vp, hp] = this.padding;
		const bs = theme.get('panel.border') ?? {};
		const paint = (s: string) => (theme.enabled ? styleToAnsi(bs) + s + RESET : s);
		const out: string[] = [];
		const pad = ' '.repeat(hp);

		const renderRow = (cells: RenderInput[], headerStyle?: string): string[] => {
			const cols = widths.map((w, c) => {
				const cell = cells[c] ?? '';
				const spec = this.columns[c] ?? {};
				const styled =
					typeof cell === 'string' && (headerStyle || spec.style)
						? new Text(cell, { style: headerStyle ?? spec.style, justify: spec.justify, overflow: spec.noWrap ? 'ellipsis' : 'fold' })
						: cell;
				return renderLines(styled, w);
			});
			const height = Math.max(1, ...cols.map((c) => c.length));
			const lines: string[] = [];
			for (let r = 0; r < height; r++) {
				const parts = cols.map((c, ci) => {
					const spec = this.columns[ci] ?? {};
					return pad + padTo(c[r] ?? '', widths[ci], spec.justify ?? 'left') + pad;
				});
				lines.push(this.showEdge ? paint(this.box.v) + parts.join(paint(this.box.v)) + paint(this.box.v) : parts.join(''));
			}
			return lines;
		};

		const edge = (l: string, m: string, r: string) =>
			paint(l + widths.map((w) => this.box.h.repeat(w + hp * 2)).join(m) + r);

		if (this.showEdge) out.push(edge(this.box.tl, '┬', this.box.tr));
		if (this.showHeader) {
			out.push(...renderRow(this.columns.map((c) => c.header ?? ''), 'table.header'));
			if (this.showEdge) out.push(edge('├', '┼', '┤'));
		}
		this.rows.forEach((row, i) => {
			out.push(...renderRow(row));
			if (vp && i < this.rows.length - 1) out.push('');
		});
		if (this.showEdge) out.push(edge(this.box.bl, '┴', this.box.br));
		return out;
	}
}

/* ─────────────────────────────────────────────────────────────── progress ── */

export interface TaskState {
	id: number;
	description: string;
	completed: number;
	total: number | null;
	started: boolean;
	finished: boolean;
	startTime: number;
	stopTime?: number;
	fields: Record<string, any>;
	samples: Array<[number, number]>;
}

export function formatBytes(n: number): string {
	if (!isFinite(n) || n <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(secs: number, compact = true): string {
	if (!isFinite(secs) || secs < 0) return compact ? '-:--:--' : '--:--';
	const s = Math.floor(secs % 60);
	const m = Math.floor((secs / 60) % 60);
	const h = Math.floor(secs / 3600);
	if (h > 0 || !compact) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * unshackle's GradientPulseBarColumn: a bar that blends pink→blue across the
 * completed portion and animates a pulse while the task total is unknown.
 */
export class GradientBar implements Renderable {
	constructor(
		public task: TaskState,
		public width?: number
	) {}
	measure(maxWidth: number): number {
		return this.width ?? Math.min(40, maxWidth);
	}
	render(width: number): string[] {
		const w = Math.max(4, this.width ?? width);
		const start = parseColor(theme.palette.pink) ?? [245, 194, 231];
		const end = parseColor(theme.palette.blue) ?? [137, 180, 250];
		const back = parseColor(theme.palette.dark_gray) ?? [54, 54, 84];
		const done = parseColor(theme.palette.green) ?? [166, 227, 161];
		const t = this.task;

		if (!t.started || t.total === null) {
			// indeterminate pulse
			const phase = (Date.now() / 90) % (w * 2);
			let s = '';
			for (let i = 0; i < w; i++) {
				const dist = Math.abs(i - (phase > w ? w * 2 - phase : phase));
				const ratio = Math.max(0, 1 - dist / (w / 4));
				const col = blendRGB(back, start, ratio);
				s += theme.enabled ? fg(col) + '━' : '━';
			}
			return [s + (theme.enabled ? RESET : '')];
		}

		const pct = t.total > 0 ? Math.max(0, Math.min(1, t.completed / t.total)) : 0;
		const filled = Math.round(pct * w);
		let s = '';
		for (let i = 0; i < w; i++) {
			if (i < filled) {
				const col = t.finished ? done : blendRGB(start, end, w > 1 ? i / (w - 1) : 0);
				s += theme.enabled ? fg(col) + '━' : '━';
			} else {
				s += theme.enabled ? fg(back) + '━' : '─';
			}
		}
		return [s + (theme.enabled ? RESET : '')];
	}
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner implements Renderable {
	constructor(
		public text: RenderInput = '',
		public opts: { style?: string; finishedText?: string; finished?: boolean } = {}
	) {}
	static frame(): string {
		return SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
	}
	measure(maxWidth: number): number {
		return Math.min(maxWidth, 2 + measureOf(this.text, maxWidth - 2));
	}
	render(width: number): string[] {
		const st = theme.get(this.opts.style ?? 'status.spinner') ?? {};
		const glyph = this.opts.finished ? this.opts.finishedText ?? '' : Spinner.frame();
		const head = glyph ? (theme.enabled ? styleToAnsi(st) + glyph + RESET : glyph) + ' ' : '';
		const body = renderLines(this.text, Math.max(1, width - textWidth(stripAnsi(head))));
		return body.map((l, i) => (i === 0 ? head : ' '.repeat(textWidth(stripAnsi(head)))) + l);
	}
}

export type ProgressColumn =
	| 'spinner'
	| 'bar'
	| 'percentage'
	| 'elapsed'
	| 'remaining'
	| 'downloaded'
	| 'speed'
	| 'description'
	| string;

/** rich.progress.Progress — a set of tasks each rendered as one line. */
export class Progress implements Renderable {
	public tasks: TaskState[] = [];
	private nextId = 0;
	constructor(
		public columns: ProgressColumn[] = ['spinner', 'bar', '•', 'remaining', '•', 'downloaded'],
		public opts: { barWidth?: number } = {}
	) {}

	addTask(description = '', fields: Record<string, any> = {}, total: number | null = null): number {
		const t: TaskState = {
			id: this.nextId++,
			description,
			completed: 0,
			total,
			started: total !== null,
			finished: false,
			startTime: Date.now(),
			fields,
			samples: []
		};
		this.tasks.push(t);
		return t.id;
	}

	getTask(id: number): TaskState | undefined {
		return this.tasks.find((t) => t.id === id);
	}

	update(id: number, patch: Partial<Omit<TaskState, 'id' | 'fields'>> & { fields?: Record<string, any>; advance?: number }) {
		const t = this.getTask(id);
		if (!t) return;
		if (patch.advance) t.completed += patch.advance;
		if (patch.completed !== undefined) t.completed = patch.completed;
		if (patch.total !== undefined) {
			t.total = patch.total;
			if (patch.total !== null) t.started = true;
		}
		if (patch.description !== undefined) t.description = patch.description;
		if (patch.started !== undefined) t.started = patch.started;
		if (patch.fields) Object.assign(t.fields, patch.fields);
		if (t.total !== null && t.completed >= t.total && t.total > 0) {
			if (!t.finished) t.stopTime = Date.now();
			t.finished = true;
		}
		const now = Date.now();
		t.samples.push([now, t.completed]);
		while (t.samples.length > 2 && now - t.samples[0][0] > 10_000) t.samples.shift();
	}

	private speed(t: TaskState): number | null {
		if (t.samples.length < 2) return null;
		const [t0, c0] = t.samples[0];
		const [t1, c1] = t.samples[t.samples.length - 1];
		const dt = (t1 - t0) / 1000;
		if (dt <= 0) return null;
		return (c1 - c0) / dt;
	}

	measure(maxWidth: number): number {
		return maxWidth;
	}

	render(width: number): string[] {
		return this.tasks.map((t) => this.renderTask(t, width));
	}

	private renderTask(t: TaskState, width: number): string {
		const parts: string[] = [];
		const fixed: string[] = [];
		let barIndex = -1;
		for (const col of this.columns) {
			switch (col) {
				case 'spinner':
					fixed.push(t.finished ? ' ' : renderMarkup(`[pink]${Spinner.frame()}[/]`));
					break;
				case 'bar':
					barIndex = fixed.length;
					fixed.push('');
					break;
				case 'percentage': {
					const pct = t.total ? Math.min(100, (t.completed / t.total) * 100) : 0;
					fixed.push(renderMarkup(`[progress.percentage]${pct.toFixed(1).padStart(5)}%[/]`));
					break;
				}
				case 'elapsed':
					fixed.push(renderMarkup(`[progress.elapsed]${formatDuration(((t.stopTime ?? Date.now()) - t.startTime) / 1000)}[/]`));
					break;
				case 'remaining': {
					if (t.finished) {
						fixed.push(renderMarkup(`[progress.elapsed]${formatDuration(((t.stopTime ?? Date.now()) - t.startTime) / 1000)}[/]`));
						break;
					}
					const sp = this.speed(t);
					const left = sp && sp > 0 && t.total ? (t.total - t.completed) / sp : NaN;
					fixed.push(renderMarkup(`[progress.remaining]${isFinite(left) ? formatDuration(left) : '-:--'}[/]`));
					break;
				}
				case 'downloaded': {
					const v = t.fields.downloaded;
					fixed.push(renderMarkup(`[progress.data.speed]${v === undefined ? '-' : v}[/]`));
					break;
				}
				case 'speed': {
					const sp = this.speed(t);
					fixed.push(renderMarkup(`[progress.data.speed]${sp ? formatBytes(sp) + '/s' : '-'}[/]`));
					break;
				}
				case 'description':
					fixed.push(renderMarkup(`[progress.description]${t.description}[/]`));
					break;
				default:
					fixed.push(renderMarkup(`[text2]${col}[/]`));
			}
		}
		const gap = 1;
		const nonBar = fixed.filter((_, i) => i !== barIndex);
		const usedWidth = nonBar.reduce((a, s) => a + textWidth(stripAnsi(s)), 0) + gap * Math.max(0, fixed.length - 1);
		if (barIndex >= 0) {
			const barW = Math.max(4, Math.min(this.opts.barWidth ?? 40, width - usedWidth));
			fixed[barIndex] = new GradientBar(t, barW).render(barW)[0];
		}
		parts.push(...fixed);
		return truncateVisible(parts.join(' '), width, '');
	}
}

/* ─────────────────────────────────────────────────────────────────── live ── */

/**
 * rich.live.Live — repaints a renderable in place. Falls back to a single
 * final render when stdout is not a TTY (CI logs, GUI mode, piped output).
 */
export class Live {
	private timer?: NodeJS.Timeout;
	private lastHeight = 0;
	private stopped = false;
	private started = false;

	constructor(
		public renderable: RenderInput,
		public opts: { console?: RichConsole; refreshPerSecond?: number; transient?: boolean } = {}
	) {}

	private get con(): RichConsole {
		return this.opts.console ?? console_;
	}

	start() {
		if (this.started) return this;
		this.started = true;
		if (!this.con.isTerminal) return this;
		this.con.hideCursor();
		this.con.setLive(this);
		this.refresh();
		const hz = this.opts.refreshPerSecond ?? 12.5;
		this.timer = setInterval(() => this.refresh(), Math.max(20, 1000 / hz));
		if (typeof this.timer.unref === 'function') this.timer.unref();
		return this;
	}

	update(renderable: RenderInput, refresh = false) {
		this.renderable = renderable;
		if (refresh) this.refresh();
	}

	/** Erase the live region so normal output can be written above it. */
	clear() {
		if (!this.con.isTerminal || this.lastHeight === 0) return;
		this.con.write(`\x1b[${this.lastHeight}A`);
		for (let i = 0; i < this.lastHeight; i++) this.con.write('\x1b[2K\x1b[1B');
		this.con.write(`\x1b[${this.lastHeight}A`);
		this.lastHeight = 0;
	}

	refresh() {
		if (this.stopped || !this.con.isTerminal) return;
		const lines = renderLines(this.renderable, this.con.width);
		this.clear();
		for (const l of lines) this.con.write(l + '\n');
		this.lastHeight = lines.length;
	}

	stop() {
		if (this.stopped) return;
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		if (this.con.isTerminal) {
			if (this.opts.transient) this.clear();
			else this.refresh();
			this.con.showCursor();
			this.con.setLive(undefined);
		} else if (!this.opts.transient) {
			// non-TTY: emit the final state once
			for (const l of renderLines(this.renderable, this.con.width)) this.con.write(stripAnsi(l) + '\n');
		}
	}

	/** Run `fn` with the live region active, guaranteeing cleanup. */
	static async with<T>(renderable: RenderInput, opts: Live['opts'], fn: (live: Live) => Promise<T>): Promise<T> {
		const live = new Live(renderable, opts).start();
		try {
			return await fn(live);
		} finally {
			live.stop();
		}
	}
}

/* ──────────────────────────────────────────────────────────────── console ── */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';

/**
 * Reproduce log4js/`util.format` argument handling so existing call sites such
 * as `console.info('Your Country: %s', country)` keep substituting correctly.
 * Errors render as their stack, matching the previous logger.
 */
export function formatArgs(args: any[]): string {
	if (args.length === 0) return '';
	const mapped = args.map((a) => (a instanceof Error ? a.stack || a.message : a));
	if (typeof mapped[0] === 'string') {
		return nodeFormat(mapped[0], ...mapped.slice(1));
	}
	return mapped.map((a) => (typeof a === 'string' ? a : nodeInspect(a))).join(' ');
}


export interface RichConsoleOptions {
	width?: number;
	forceTerminal?: boolean;
	noColor?: boolean;
	stream?: NodeJS.WriteStream;
	showTime?: boolean;
	timeFormat?: (d: Date) => string;
	levelWidth?: number;
	logPadding?: PaddingDims;
}

/**
 * ComfyConsole equivalent: the padded, level-column log renderer that gives
 * unshackle its signature output, plus print/rule/panel helpers.
 */
export class RichConsole {
	public stream: NodeJS.WriteStream;
	public showTime: boolean;
	public timeFormat: (d: Date) => string;
	public levelWidth: number;
	public logPadding: PaddingDims;
	public quiet = false;
	public level: LogLevel = 'info';
	private forcedWidth?: number;
	private forceTerminal?: boolean;
	private live?: Live;
	private lastTime = '';
	private sinks: Array<(level: LogLevel, text: string) => void> = [];

	constructor(opts: RichConsoleOptions = {}) {
		this.stream = opts.stream ?? process.stdout;
		this.showTime = opts.showTime ?? false;
		this.timeFormat = opts.timeFormat ?? ((d) => d.toLocaleTimeString('en-GB', { hour12: false }));
		this.levelWidth = opts.levelWidth ?? 8;
		this.logPadding = opts.logPadding ?? [0, 5];
		this.forcedWidth = opts.width;
		this.forceTerminal = opts.forceTerminal;
		if (opts.noColor) theme.enabled = false;
	}

	get isTerminal(): boolean {
		if (this.forceTerminal !== undefined) return this.forceTerminal;
		return Boolean(this.stream.isTTY) && process.env.TERM !== 'dumb' && process.env.isGUI !== 'true';
	}

	get width(): number {
		if (this.forcedWidth) return this.forcedWidth;
		const cols = this.stream.columns;
		return Math.max(40, Math.min(cols || 120, 200));
	}

	setLive(live?: Live) {
		this.live = live;
	}

	/** Register an extra destination (e.g. the log4js file appender). */
	addSink(fn: (level: LogLevel, text: string) => void) {
		this.sinks.push(fn);
	}

	write(s: string) {
		this.stream.write(s);
	}

	hideCursor() {
		if (this.isTerminal) this.stream.write('\x1b[?25l');
	}

	showCursor() {
		if (this.isTerminal) this.stream.write('\x1b[?25h');
	}

	/** Print a renderable (or markup string) above any active Live region. */
	print(renderable: RenderInput = '', opts: { justify?: 'left' | 'center' | 'right' } = {}) {
		if (this.quiet) return;
		const width = this.width;
		let lines = renderLines(
			typeof renderable === 'string' ? new Text(renderable, { justify: opts.justify }) : renderable,
			width
		);
		if (opts.justify && typeof renderable !== 'string') {
			lines = lines.map((l) => {
				const w = textWidth(stripAnsi(l));
				if (w >= width) return l;
				const diff = width - w;
				if (opts.justify === 'center') return ' '.repeat(Math.floor(diff / 2)) + l;
				if (opts.justify === 'right') return ' '.repeat(diff) + l;
				return l;
			});
		}
		this.emit(lines);
	}

	private emit(lines: string[]) {
		const live = this.live;
		if (live) live.clear();
		for (const l of lines) this.write((this.isTerminal ? l : stripAnsi(l)) + '\n');
		if (live) live.refresh();
	}

	private levelText(level: LogLevel): string {
		const label = level === 'warning' ? 'WARNING' : level.toUpperCase();
		return renderMarkup(`[log.level.${level}]${padTo(label, this.levelWidth)}[/]`);
	}

	/** The core log renderer — time column, level column, padded message. */
	writeLog(level: LogLevel, ...args: any[]) {
		const order: LogLevel[] = ['debug', 'info', 'warning', 'error', 'critical'];
		if (order.indexOf(level) < order.indexOf(this.level)) return;

		// log4js applied util.format semantics, so `console.info('Country: %s', c)`
		// must keep working across the ~500 existing call sites.
		const message = formatArgs(args);

		for (const sink of this.sinks) sink(level, stripMarkup(message));
		if (this.quiet) return;

		const [, right, , left] = unpackPadding(this.logPadding);
		let gutter = '';
		if (this.showTime) {
			const t = this.timeFormat(new Date());
			gutter += (t === this.lastTime ? ' '.repeat(textWidth(t)) : renderMarkup(`[log.time]${t}[/]`)) + ' ';
			this.lastTime = t;
		}
		// INFO is the "quiet" default level: no label, matching unshackle's look
		const showLabel = level !== 'info';
		const levelCol = showLabel ? this.levelText(level) + ' ' : '';
		const indent = left;
		const msgWidth = Math.max(20, this.width - indent - right - textWidth(stripAnsi(gutter)) - textWidth(stripAnsi(levelCol)));
		const body = new Text(message, { overflow: 'fold' }).render(msgWidth);
		const hang = ' '.repeat(indent + textWidth(stripAnsi(gutter)) + textWidth(stripAnsi(levelCol)));
		this.emit(body.map((l, i) => (i === 0 ? ' '.repeat(indent) + gutter + levelCol : hang) + l));
	}

	debug = (...a: any[]) => this.writeLog('debug', ...a);
	info = (...a: any[]) => this.writeLog('info', ...a);
	warn = (...a: any[]) => this.writeLog('warning', ...a);
	error = (...a: any[]) => this.writeLog('error', ...a);
	critical = (...a: any[]) => this.writeLog('critical', ...a);
	/** Alias kept for drop-in compatibility with the old log4js logger. */
	log = (...a: any[]) => this.writeLog('info', ...a);

	/** `console.print(Padding(Rule(...), (1, 2)))` — unshackle's section header. */
	rule(title = '', pad: PaddingDims = [1, 2]) {
		this.print(new Padding(new Rule(title), pad));
	}

	/** A transient spinner status line, padded like unshackle's. */
	status(text: RenderInput, pad: PaddingDims = [0, 5]): Live {
		return new Live(new Padding(new Spinner(text), pad), { console: this, transient: true, refreshPerSecond: 12.5 }).start();
	}
}

export const console_ = new RichConsole();
export default console_;
