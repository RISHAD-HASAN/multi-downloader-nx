# Merge Report — `multi-downloader-nx` × `unshackle` × forks

This branch (`unshackle-merge`) enriches [`anidl/multi-downloader-nx`](https://github.com/anidl/multi-downloader-nx)
with features harvested from its fork network and from
[`unshackle-dl/unshackle`](https://github.com/unshackle-dl/unshackle).

**Base:** `anidl/multi-downloader-nx` @ `5021398` (v5.8.2)

---

## Why this is a port, not a merge

The two projects do not share a language or a runtime:

| | multi-downloader-nx | unshackle |
|---|---|---|
| Language | TypeScript / Node ≥ 22 | Python 3.11–3.14 |
| Size | ~16k LOC | ~85k LOC |
| Scope | Crunchyroll / HiDive / ADN, CLI + Electron-style GUI | Generic movie/TV/music archival, per-service plugins |
| Licence | MIT | GPL-3.0 |

`git merge` between them is meaningless. So aniDL stays the base and the
valuable unshackle *capabilities* were re-implemented in TypeScript, with no
Python at runtime. Every ported file carries an `Origin:` comment pointing at
the upstream source it was modelled on.

> **Licence note:** unshackle is GPL-3.0 and aniDL is MIT. Nothing was copied
> verbatim — `module.rich.ts` and the vault layer are independent
> re-implementations of the *design*. If you intend to redistribute this,
> review the licence implications yourself.

---

## 1. unshackle-style CLI output

The visual language of unshackle comes entirely from Python's `rich`, which has
no Node equivalent that matches it. So `rich` was re-created, dependency-free.

### `modules/module.rich.ts` *(new)*
A focused port of the `rich` primitives unshackle uses:

- **Themes / palettes** — `catppuccin-mocha` (default), `dracula`, `nord`, `gruvbox`, `one-dark`, `mono`, with the same semantic style roles (`text2`, `repr.number`, `log.level.error`, `progress.elapsed`, …).
- **Markup** — `[cyan]…[/]`, `[bold red]…[/bold red]`, `[repr.number]5[/]`. Unknown tags stay literal, exactly like `rich`, so existing log strings such as `[INFO]` or `[1080p]` are untouched.
- **Renderables** — `Text` (wrapping, justify, fold/ellipsis), `Group`, `Padding`, `Rule`, `Panel`, `Tree`, `Table`/`Table.grid`.
- **Progress** — `Progress` with a `GradientBar` reproducing unshackle's `GradientPulseBarColumn` (pink→blue gradient, pulse animation while the total is unknown), spinner, live ETA from a rolling 10s speed window, byte formatting.
- **`Live`** — in-place repainting region that correctly yields to log lines printed above it, and degrades to a single final render when stdout is not a TTY (GUI mode, CI, pipes).
- **`RichConsole`** — the `ComfyConsole` log renderer: level column, `(0, 5)` padding, hanging indent on wrap, CJK-aware width measurement.

### `modules/module.console.ts` *(new)*
aniDL-specific presentation built on the above: ASCII banner, section rules,
`listingPanel`, `tracksTree`, `cekTree` (content-key tree), and `DownloadTable`
(the live per-track tree with its own progress bar).

### `modules/log.ts` *(rewritten)*
Drop-in replacement for the old log4js logger. `console.info/warn/error/debug/log`
behave identically for all ~500 existing call sites, but now render through
`RichConsole` — while `logs/latest.log` keeps receiving plain, un-styled text.
Colour is disabled automatically under `isGUI=true`, `NO_COLOR`, or `--noColor`.

**New options:** `--theme <palette>`, `--noColor`.
**Env overrides:** `ANIDL_THEME`, `ANIDL_NO_COLOR`, `ANIDL_LOG_LEVEL`.

Preview of all six palettes: `cli-preview.html` (regenerate with `pnpm preview:cli`).

---

## 2. Content key vaults

Ported from `unshackle/core/vault.py`, `core/vaults.py`, `vaults/*`.

### `modules/module.vault.ts` *(new)*
- `Vault` abstract base; `Vaults` manager that queries **local vaults first**, then network vaults, and writes newly-obtained keys back to every vault that isn't `no_push`.
- **`SQLiteVault`** — uses Node's built-in `node:sqlite` (Node ≥ 22.5). The schema (one table per service, `kid` / `key_`) is **byte-compatible with unshackle/devine vaults**, so an existing `key_vault.db` can be pointed at directly.
- **`JSONVault`** — zero-dependency fallback for older Node builds.
- **`APIVault`** — remote HTTP vault speaking unshackle's API protocol (`GetKey`/`GetKeys`/`InsertKey`/`InsertKeys` with an `X-Secret-Key` header).

### `modules/module.drm-cache.ts` *(new)*
- **PSSH KID extraction** — handles v1 boxes (KIDs in the header), Widevine protobuf payloads (`repeated bytes key_id = 2`), and PlayReady `WRMHEADER` XML (including the little-endian GUID fix-up).
- **`resolveKeys()`** — looks the KIDs up in the vault chain; **the licence server is only contacted if at least one KID is still unknown**. Fresh keys are pushed back. Prints the unshackle content-key tree annotated with the vault each key came from.

### Wiring
`modules/cdm.ts` — `getKeysWVD` / `getKeysPRD` now route through `resolveKeys`;
the raw licence requests became private `requestKeys*` functions. `crunchy.ts`
and `hidive.ts` pass their service namespace at all 6 call sites.

**Config:** `config/vaults.yml` (new, opt-in, SQLite enabled by default).

Re-downloading an episode — or grabbing another dub that shares keys — now skips
the licence round-trip entirely.

---

## 3. Features merged from forks

Fork network surveyed: 136 forks, 15 genuinely ahead of upstream.

| Source | Feature | Status |
|---|---|---|
| **erolus77/multi-downloader-nx-dots** | Subtitle sorting; `--signSubsForced`; `--scaledBorderAndShadow` for CC subs; VTT/ASS conversion fixes; filename whitespace→dots | ✅ merged |
| **xNabil/multi-downloader-nx** | `--outputDir` — separate temp download dir from final output dir ([#1221](https://github.com/anidl/multi-downloader-nx/issues/1221)) | ✅ merged |
| **Yurasubs/multi-downloader-nx** | `-u/--url` auto service + ID detection (`modules/module.url.ts`) | ✅ merged |
| **Yurasubs** | `-F/--list-formats` flag | ✅ merged (flag + docs) |
| **Yurasubs** | `--majin` high-bitrate CENC DASH flag | ✅ flag merged |
| **Yurasubs** | Cross-platform env-var expansion in `bin-path.yml` (`%VAR%`, `${VAR}`, `$VAR`, `~`) | ✅ merged |
| **Yurasubs** | `modules/module.working-dir.ts` extraction (breaks an import cycle) | ✅ merged |
| **MikoGome** | Audio track ordering by `--dubLang` | ⏭️ already upstream |
| **MikoGome** | Hard-coded VTT font-size/outline tweak | ❌ skipped — conflicts with erolus77's *configurable* `scaledBorderAndShadow`, which is strictly better |
| **pcela** | Download-archive overhaul, raw JSON export, `oceanveil` service | ⏭️ deferred — 110 commits incl. an unrelated service and a large `module.args.ts` rewrite; too invasive to land safely alongside the console rewrite |
| **someonelike-u** | 121 commits | ❌ skipped — almost entirely CI/release-workflow churn |
| **agryo**, **OUTLAWS8R** | Personal customisations, husky removal, translations | ❌ skipped — not general-purpose |

### Deliberate deviations from the forks

- **`module.merger.ts`** — erolus77's patch declared `signSubsForced?: argv.signSubsForced`, which is not valid TypeScript (`argv` is a value, not a namespace) and fails `tsc`. Corrected to the literal union `'yes' | 'default' | 'no'`.
- **`module.merger.ts`** — the same patch removed the ` [Simulcast]` / ` [Uncut]` video track labels. That's a personal preference and a regression for everyone else, so upstream behaviour was restored.
- **Yurasubs' bun migration** — their fork replaces pnpm with bun and deletes `pnpm-lock.yaml`. Not adopted; the project stays on pnpm.

---

## Verification

```bash
pnpm exec tsc --noEmit      # clean — 0 errors
pnpm test:all               # vault + console suites
pnpm preview:cli            # regenerate cli-preview.html
```

`tests/vault.test.ts` covers:
- PSSH KID extraction — v0 protobuf, v1 header, malformed input
- JSON vault — insert, dedupe, case-insensitive lookup, null-key rejection
- SQLite vault round-trip (auto-skips below Node 22.5)
- `resolveKeys` — licence fetched once, second run fully vault-served
- `enabled: false` correctly bypasses the cache

`tests/console.test.ts` covers the log4js-compatibility surface:
- `util.format` substitution (`%s`, `%d`, `%i`, multi-arg, objects)
- Error objects rendering with level label + stack
- Log level filtering
- Markup applied for known tags, while `[INFO]` / `[Crunchyroll]` / `[1080p]` stay literal
- `--noColor` producing byte-clean plain text
- Wrapping width + hanging indent
- CJK-aware width measurement (Japanese titles)

### Regressions fixed during verification

**The live download view was built but never wired in.** `module.console.ts`
shipped `DownloadTable` / `tracksTree` and they passed their unit tests, but no
caller used them — so the CLI printed the original per-chunk
`48 of 355 parts downloaded [14%]` lines and none of the unshackle download UI.
Now wired end to end:

- `modules/module.download-ui.ts` (new) owns a single live session: a track tree
  grouped by type, each row with spinner, gradient bar, ETA and transferred/speed,
  repainted atomically by `Live`.
- `hls-download.ts` gained a `trackKey` option and reports **per part** (not per
  chunk of `partsize`), so the bar moves smoothly; the old text line is suppressed
  while the live view owns that track.
- `crunchy.ts` opens the session after quality selection, tags the video/audio
  streams, marks `Downloaded`/`FAILED`, and renders the available qualities as a
  track tree instead of a flat list.
- The session is closed **before** decryption, because shaka-packager and
  mp4decrypt write straight to stdout and would corrupt the live region.
- GUI mode never activates it, and non-TTY output degrades to a single final render.

`tests/download-ui.test.ts` asserts the wiring itself, so it cannot silently
regress again.



**Packaged builds silently lost the key vault.** `modules/build.ts` copies config
files into the build output individually, and `config/vaults.yml` was not on that
list — so every `build-windows-*-cli` binary would start with vaults disabled and
no error. Fixed by shipping `vaults.yml`, plus `loadVaultCfg()` now falls back to
a local SQLite vault when the file is absent. `tests/build.test.ts` fails if any
shipped config file is ever dropped from the copy list again.

Also verified that `require('node:sqlite')` survives esbuild bundling + minify
(pkg targets `node24`, which has it), and that the vault reads/writes correctly
from inside a bundled binary with a devine-compatible schema.



The original logger was log4js, which applies `util.format`. The first version of
the rich console joined arguments with a space instead, so 29 call sites like
`console.info('Your Country: %s', country)` printed a literal `%s`. `RichConsole`
now formats through `util.format`; covered by `tests/console.test.ts`.

Smoke-tested live: `--help`, banner rendering in all themes, and
`--url https://www.crunchyroll.com/series/GY5P48XEY/...` resolving against the
real Crunchyroll API.

---

## Files added

```
modules/module.rich.ts          rich-equivalent rendering engine
modules/module.console.ts       aniDL console presentation
modules/module.vault.ts         Vault / Vaults / SQLite / JSON / API
modules/module.drm-cache.ts     PSSH parsing + vault-backed key resolution
modules/module.url.ts           URL → service + ID  (fork: Yurasubs)
modules/module.working-dir.ts   workingDir extraction (fork: Yurasubs)
config/vaults.yml               vault configuration
tests/vault.test.ts             vault test suite
scripts/render-cli-preview.ts   HTML preview generator
cli-preview.html                rendered preview (all 6 themes)
```

## Files modified

```
modules/log.ts                  rewritten on top of RichConsole
modules/cdm.ts                  licence calls routed through the vault
modules/module.cfg-loader.ts    vault config, env expansion, workingDir import
modules/module.args.ts          --url, --list-formats, --majin, --theme, --noColor
modules/module.app-args.ts      matching argv types
modules/module.merger.ts        signSubsForced (+ type fix)
modules/module.vtt2ass.ts       scaledBorderAndShadow
modules/module.vttconvert.ts    subtitle conversion fixes
modules/module.filename.ts      filename option
index.ts                        banner, theme, vault init, --url routing
crunchy.ts / hidive.ts / adn.ts vault service namespace, outputDir
config/cli-defaults.yml         new defaults
```
