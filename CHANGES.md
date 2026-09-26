# Changes in this fork

Forked from [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx)
at `5021398` (v5.8.2).

Two things drove this: I wanted the CLI output to look like
[unshackle](https://github.com/unshackle-dl/unshackle) instead of a wall of log
lines, and I wanted content keys cached so re-downloading an episode doesn't hit
the licence server again. Everything else came out of fixing what broke along
the way.

Note on unshackle: it's Python and GPL-3.0, this is TypeScript and MIT. Nothing
was copied. The console layer and the vaults are reimplementations of the ideas.
Worth a look at the licensing yourself before redistributing.

## Console

`modules/module.rich.ts` is a small reimplementation of the bits of Python's
`rich` that the output needs: themes, markup, panels/trees/tables, gradient
progress bars, and a `Live` region that repaints in place. No dependencies -
the Node ports either don't handle the Live refresh properly or are huge.

On top of that:

- `module.console.ts` - banner, section rules, track trees, content key trees.
- `module.download-ui.ts` - one live view per episode. Video, every dub and the
  subtitles all sit in the same tree, each row with its own bar, ETA and
  transferred/speed, and each row moves Downloading -> Decrypting -> Decrypted
  in place.
- `log.ts` - same `console.info/warn/error/debug` surface as before so the ~500
  existing call sites are untouched. `logs/latest.log` still gets plain text.

New flags: `--theme` (catppuccin-mocha, dracula, nord, gruvbox, one-dark, mono)
and `--noColor`. Env: `ANIDL_THEME`, `ANIDL_NO_COLOR`, `ANIDL_LOG_LEVEL`.

Output was trimmed a lot. Playlist URLs, part counts, temp paths, init-part
chatter and the available-quality listing are all `--debug` now. Listings follow
the request: `--srz` shows seasons, `--srz -s` shows episodes, adding `-e` shows
neither and goes straight to the download. Finishes on a single `<path> done`.

## Key vaults

`modules/module.vault.ts` and `module.drm-cache.ts`. KIDs are parsed out of the
PSSH (v1 box header, Widevine protobuf, PlayReady WRMHEADER), looked up locally
first and then over the network, and only the missing ones cause a licence call.
Anything new is written back.

Backends: SQLite (via `node:sqlite`, needs Node >= 22.5), a JSON fallback, and a
remote HTTP one. The SQLite layout matches devine's, so an existing
`key_vault.db` works as-is. Configure in `config/vaults.yml`.

## Pulled in from other forks

- **erolus77** - subtitle sorting, `--signSubsForced`, `--scaledBorderAndShadow`,
  dots in filenames.
- **xNabil** - `--outputDir`, so the temp download dir and the final output dir
  can differ.
- **Yurasubs** - `-u/--url` (works out the service and ID for you),
  `-F/--list-formats`, `--majin`, env var expansion in `bin-path.yml`.

Skipped: the bun migration and the lockfile deletion, the CI churn, and pcela's
branch (110 commits, drags in an unrelated service and rewrites the arg parser).

### Yurasubs comparison and update (2026-09-25)

Both forks branch from `anidl/multi-downloader-nx` at `5021398`. At the time of
this update, our `7289b36` had 27 commits not in Yurasubs' `41422ed`, and
Yurasubs had 20 commits not in ours. Several older Yurasubs features had already
been reimplemented here; these are **adapted ports**, not a merge that discards
this fork's Rich console, key vaults, pnpm build, or tests.

- Ported the newer Crunchyroll stream comparison from `1a099fe`, `a16a4cf`,
  `88c9973`, `5daabd5`, and `ea46829`: evaluate Majin VBR against CBR 0/1,
  probe whole-file size and actual bitrate for SegmentBase video, show duration
  and estimated quality/download sizes, and accept `--cbr 0|1` (higher priority
  than `--majin`). Selection is **per dub**; missing encodes fall back cleanly.
  The URL transforms ignore HLS and are idempotent.
- Completed the earlier `fad4424` `-F/--list-formats` port. The flag was already
  declared, but none of the three services acted on it; it now lists formats
  without downloading, muxing or marking an episode downloaded.
- Brought in the safe parts of `7d745da`/`23cb208`: remove the hard-coded
  Crunchyroll `Host` header, fall back between CMS and content APIs on 403,
  support direct binary-path environment variables and `BIN_DIR`/`PATH/bin`.
  **Did not** adopt upstream's global TLS-verification bypass.
- Adapted safe, non-GUI fixes from `4ae07eb`: filename overrides no longer
  mutate variables across episodes; ADN uses secure random bytes and accepts
  malformed cookie values; time formatting handles rounding; ffmpeg maps the
  chapter input after subtitles and skips missing files on cleanup. Shell-free
  subprocess execution retains this fork's quiet Rich live view; zipping also
  invokes `7z` without a shell, and updater metadata uses an absolute path.
  A damaged download archive is backed up instead of being silently overwritten
  or preventing future downloads.
- Kept pnpm and the custom console/GUI intact. Adapted `beca745` lint rules
  for intentional test/preview logging and ANSI escape-code expressions, so
  the existing lint command passes without changing rendering behavior.
- Upstream's `41422ed` is a documentation/version bump; our package was already
  at 5.8.2, so only the new options were documented here.

Kept separate: upstream's bun/GUI migration, GitHub Actions release/CI workflows
(which this fork intentionally removed), and unrelated GUI changes. Copying those
commits wholesale would replace local functionality instead of integrating it.
The comparisons and parser run against offline MPD fixtures in `tests/majin.test.ts`;
live streaming still requires a valid service account.

Some of these needed fixing before they'd work:

- erolus77 declared `signSubsForced?: argv.signSubsForced`, which isn't valid TS
  and fails `tsc`. Same patch quietly dropped the `[Simulcast]`/`[Uncut]` track
  labels, so those are back.
- Yurasubs' majin URL rewrite wasn't idempotent (second pass gave
  `/static/majin/majin/`) and it rewrote HLS URLs into dead links.
- Bigger one: majin was latched globally once auto-detection succeeded. A title
  can have a majin encode for one dub and not another, so the second version
  404s with `NoSuchKey` and kills the whole episode. It's decided per version
  now, and an explicit `--majin` with no encode falls back with a warning.

## Fixes on top of upstream

- `Helper.exec` ran subprocesses with `stdio: 'inherit'`, so shaka-packager and
  mkvmerge dumped straight to the terminal. Captured now, replayed only on
  failure or under `--debug`.
- Network errors were unreadable. Node's fetch wraps everything as
  `TypeError: fetch failed` and hides the cause; `extFn.getData` read
  `error.res.statusText` which doesn't exist for transport errors (hence
  `Part 130: undefined`); and `downloadPart` threw a bare `Error()` so the final
  line had no reason at all. `module.error.ts` unwraps the chain and maps the
  common codes to something useful - ECONNRESET and connect timeouts now tell you
  to drop `--partsize`.
- `build.ts` never copied `config/vaults.yml`, so packaged binaries silently ran
  without vaults.
- The anonymous branch of `refreshToken` ignored `silent`, printing `USER:` twice.
- The episode listing indented with a `\r\t` cursor hack, which fought the padded
  renderer.
- `Req.getData` logged non-OK responses before the `silent` check, so the majin
  probe's expected 404 showed up as an error.
- The `DUAL.` filename tag came from the number of dubs *requested*, so a second
  dub that failed to download still left `DUAL.` in the final name. The tag is
  now recomputed from the audio tracks that actually completed before the output
  filename is built (`actualAudioTag` in `crunchy.ts`).
- FFmpeg muxing never set a default audio track while mkvmerge did, so players
  could pick the wrong dub. `Merger.defaultAudioIndex()` finds the stream that
  matches the configured default audio language, and FFmpeg gets
  `-disposition:a:N default` (and `0` on the rest) whenever there is a choice.
- A filename template without `${audio}` dropped the `DUAL.` tag without a word:
  the tag only reaches the name through that variable. `applyActualAudioTag` now
  also seeds the variable when the template asks for it, and the end of a
  download reports the tag - an info line when `DUAL.` was added, a warning with
  the fix when two dubs completed but the template has no `${audio}`, and a note
  when only one of the requested dubs finished. `${audio}` is now listed in the
  documented template variables.

## Not done

Within one episode the video and audio DASH tracks now overlap -
`module.crunchy-transfer.ts` starts both transfers as a batch, tracks which are
in flight, waits for every sibling to settle before surfacing a failure, and
records which audio tracks completed. Dubs are still sequential between
themselves, and the CDN concern stands: overlapping tracks multiplies the number
of live connections against a CDN that already throttles at higher `--partsize`.
A shared concurrency budget across dubs and episodes is still open.

## Tests

```
pnpm test:all
```

Thirteen suites: `vault`, `console`, `build`, `download-ui`, `error`, `majin`,
`bin`, `upstream`, `archive`, `filename`, `listing`, `crunchy-concurrency`,
`crunchy-dual-tag`. They
cover vault round-trips and PSSH parsing, the console renderer (including `%s`
formatting and CJK widths), the packaged-build config manifest, live-view
wiring, error unwrapping against real undici failures, offline Majin/CBR
comparisons, binary discovery, format-only exits, CMS/content-API fallbacks,
corrupt-archive recovery, filename rules, listing modes, and the concurrent DASH
transfer batch (track overlap, failure isolation, completed-audio DUAL tagging
and FFmpeg default-audio dispositions), and the two-dub download flow end to end
(the `DUAL.` tag landing through `${audio}`, and the warning when the template
has no `${audio}`).
