# Fork changes

Forked from [anidl/multi-downloader-nx](https://github.com/anidl/multi-downloader-nx) at `5021398` (v5.8.2).

Two things drove this fork: CLI output that reads like a progress UI instead of a
wall of log lines, and content keys cached so re-downloading an episode does not
hit the licence server again. The rest is fixes for what broke along the way.

> [unshackle](https://github.com/unshackle-dl/unshackle) is Python and GPL-3.0,
> this fork is TypeScript and MIT. Nothing was copied: the console layer and the
> vaults are independent reimplementations of the same ideas. Check the licensing
> yourself before redistributing.

## Console

`modules/module.rich.ts` is a dependency-free subset of Python's `rich`: themes,
markup, panels/trees/tables, gradient progress bars and a `Live` region that
repaints in place.

- `module.console.ts` - banner, section rules, track trees, content key trees.
- `module.download-ui.ts` - one live view per episode: video, every dub and the
  subtitles in the same tree, each row with its own bar, ETA and speed, moving
  Downloading -> Decrypting -> Decrypted in place.
- `log.ts` - the same `console.info/warn/error/debug` surface as before, so the
  existing call sites are untouched. `logs/latest.log` still gets plain text.

Flags: `--theme` (catppuccin-mocha, dracula, nord, gruvbox, one-dark, mono) and
`--noColor`. Env: `ANIDL_THEME`, `ANIDL_NO_COLOR`, `ANIDL_LOG_LEVEL`.

Playlist URLs, part counts, temp paths, init-part chatter and the quality listing
are all `--debug` only. Listings follow the request: `--srz` shows seasons,
`--srz -s` shows episodes, adding `-e` shows neither and goes straight to the
download. A finished run ends on a single `<path> done`.

## Key vaults

`modules/module.vault.ts` and `module.drm-cache.ts`. KIDs are parsed out of the
PSSH (v1 box header, Widevine protobuf, PlayReady WRMHEADER), looked up locally,
then over the network; only missing keys cause a licence call, and anything new is
written back.

Backends: SQLite (`node:sqlite`, needs Node >= 22.5), a JSON fallback and a remote
HTTP one. The SQLite layout matches devine's, so an existing `key_vault.db` works
as-is. Configure in `config/vaults.yml`.

## Pulled in from other forks

- **erolus77** - subtitle sorting, `--signSubsForced`, `--scaledBorderAndShadow`,
  dots in filenames.
- **xNabil** - `--outputDir`, so the temp download directory and the final output
  directory can differ.
- **Yurasubs** - `-u/--url` (works out the service and ID for you),
  `-F/--list-formats`, `--majin`, env var expansion in `bin-path.yml`.

Not taken: the bun migration and lockfile deletion, the CI churn, and pcela's
branch (drags in an unrelated service and rewrites the argument parser).

### Yurasubs update (2026-09-25)

Adapted, not merged: the Rich console, key vaults, pnpm build and tests stay.

- Crunchyroll stream comparison from `1a099fe`, `a16a4cf`, `88c9973`, `5daabd5`,
  `ea46829`: Majin VBR is compared against CBR 0/1, whole-file size and actual
  bitrate are probed for SegmentBase video, duration and estimated sizes are
  shown, and `--cbr 0|1` is accepted (it wins over `--majin`). Selection is per
  dub, and a missing encode falls back cleanly.
- `-F/--list-formats` actually works now. The flag was declared but no service
  acted on it; it lists formats without downloading, muxing or marking the
  episode as downloaded.
- Safe parts of `7d745da`/`23cb208`: no hard-coded Crunchyroll `Host` header,
  CMS/content API fallback on 403, direct binary-path environment variables and
  `BIN_DIR`/`PATH/bin`. Upstream's global TLS-verification bypass was **not**
  adopted.
- Safe, non-GUI fixes from `4ae07eb`: filename overrides no longer mutate
  variables across episodes, time formatting handles rounding, ffmpeg maps the
  chapter input after subtitles and skips missing files on cleanup. Subprocesses stay shell-free
  and quiet, `7z` is invoked without a shell, and the updater uses an absolute
  path. A damaged download archive is backed up instead of being overwritten or
  blocking future downloads.

Fixes the ports needed:

- erolus77 declared `signSubsForced?: argv.signSubsForced`, which is not valid TS,
  and quietly dropped the mkvmerge track labels. Both are fixed.
- The majin URL rewrite was not idempotent (a second pass produced
  `/static/majin/majin/`) and rewrote HLS URLs into dead links.
- Majin was latched globally once auto-detection succeeded, so a title with a
  majin encode for one dub and not another 404'd with `NoSuchKey` and killed the
  episode. It is decided per version now, and an explicit `--majin` with no encode
  falls back with a warning.

## Fixes on top of upstream

- `Helper.exec` used `stdio: 'inherit'`, so shaka-packager and mkvmerge wrote
  straight to the terminal. Output is captured and replayed on failure or under
  `--debug`.
- Network errors were unreadable: fetch wraps everything as
  `TypeError: fetch failed`, `extFn.getData` read `error.res.statusText` (absent
  for transport errors, hence `Part 130: undefined`), and `downloadPart` threw a
  bare `Error()`. `module.error.ts` unwraps the cause chain and maps the common
  codes to advice - ECONNRESET and connect timeouts point at `--partsize`.
- `build.ts` never copied `config/vaults.yml`, so packaged binaries ran without
  vaults.
- The anonymous branch of `refreshToken` ignored `silent` and printed `USER:`
  twice.
- The episode listing used a `\r\t` cursor hack that fought the padded renderer.
- `Req.getData` logged non-OK responses before the `silent` check, so the majin
  probe's expected 404 showed up as an error.
- The `DUAL.` filename tag was derived from the dubs *requested*, so a second dub
  that failed still left `DUAL.` in the name. It is recomputed from the audio
  tracks that completed (`actualAudioTag` in `crunchy.ts`).
- FFmpeg muxing never set a default audio track while mkvmerge did, so players
  could pick the wrong dub. `Merger.defaultAudioIndex()` finds the configured
  default language and emits `-disposition:a:N default` (`0` on the rest) whenever
  there is a choice.
- A template without `${audio}` dropped the `DUAL.` tag silently, since the tag
  only reaches the name through that variable. `applyActualAudioTag` seeds the
  variable when the template asks for it, and the run reports the outcome: info
  when the tag was added, a warning with the fix when two dubs completed without a
  place for it, and a note when only one requested dub finished.

## Download pipeline

- `modules/hls-download.ts` transferred one `--partsize` batch at a time and
  every batch waited for its slowest part before the next one started. It now
  runs a fixed worker pool over the whole playlist with a single ordered writer,
  so one straggler no longer idles the other connections. The same harness (201
  parts, 25 ms server delay) went from 104-109 MB/s to 144-156 MB/s (~+40%) at
  20 threads. Every part sharing a key URI also shares one in-flight key fetch
  (21 requests for a single key at 20 threads, now 1).
- The `.resume` marker carries the exact byte count on disk. A crash that left
  bytes past the last committed part used to make the next run append at the
  wrong offset; a resume now trims the file back to the marker first, and a part
  only counts as committed once its last byte reached the handle.
- Decrypting a track used to be a silent gap in the log. Each track now logs its
  duration (`Decrypted video in 12.3s`) and each mux logs
  `[ffmpeg] Muxing took ...`, so download, decrypt and mux can be told apart.
- A finished track is renamed into place (`Helper.moveFile`, copy fallback only
  across volumes) instead of copied and then unlinked; `copyFileSync` wrote every
  decrypted byte a second time (~3.4 s per GiB on the test disk). A failed
  decryption also deletes its half-written output.
- `module.merger.ts` muxes with the same background runner and reports how long
  ffmpeg/mkvmerge took, instead of freezing the process while a multi-GB file is
  remuxed.
- Tracks transferring at the same time can both hit the "file already exists"
  prompt; `Helper.question` now queues prompts so each answer belongs to one
  question instead of two readline interfaces reading the same stdin. Captured
  subprocess output is capped at the last 512 KB per stream, so a chatty
  `--show-progress` decrypt cannot buffer a whole multi-GB run in memory.

## Crunchyroll only

This fork is used for Crunchyroll, so the HiDive and ADN services are gone:
`adn.ts`, `hidive.ts`, their GUI handlers and their `@types` declarations are
removed, along with the URL/API/args/archive/language plumbing, docs and package
metadata that only existed for them. Modules that no service imported any more
(cookie-file parsing, the old `vttconvert`, four unused `@types` files) and the
HiDive-only `--simul`, `--removeBumpers`, `--originalFontSize` and
`--combineLines` options went with them. Remaining comments were cut back to
plain one-liners, and commented-out code was deleted.

## Known limitations

Within an episode the video and audio DASH tracks overlap -
`module.crunchy-transfer.ts` starts them as one batch, tracks what is in flight,
waits for every sibling to settle before surfacing a failure, and records which
audio tracks completed. Dubs are still sequential between themselves, and the CDN
concern stands: more live connections against a CDN that already throttles at
higher `--partsize`. A shared concurrency budget across dubs and episodes is still
open.

## Tests

```
pnpm test:all
```

Twelve suites: `vault`, `console`, `download-ui`, `error`, `majin`, `bin`,
`upstream`, `archive`, `filename`, `hls`, `crunchy-concurrency`,
`crunchy-dual-tag`. They cover vault round-trips and PSSH parsing, the console
renderer (including `%s` formatting and CJK widths), live-view lifecycle, error
unwrapping against real undici failures, offline Majin/CBR comparisons, binary
discovery, format-only exits, CMS/content-API fallbacks, corrupt-archive
recovery, filename rules, the HLS downloader against a local HTTP server
(in-order byte-exact parts, one key fetch per URI, resume from a prefix, absolute
IVs, a failed part keeping a contiguous prefix whose marker records the byte
count, the init part), the concurrent DASH transfer batch (overlap, failure
isolation, completed-audio DUAL tagging, FFmpeg default-audio dispositions) and
the two-dub download flow end to end (the tag landing through `${audio}`, and
the warning when the template has none).
