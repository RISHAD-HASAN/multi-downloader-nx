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

## Not done

Downloads are still sequential - video, then each dub. Overlapping them means a
real refactor of `downloadMediaList` and, more to the point, multiplying the
number of live connections against a CDN that already throttles at higher
`--partsize`. Would need a shared concurrency budget, not just `Promise.all`.

## Tests

```
pnpm test:all
```

Eight suites: `vault`, `console`, `build`, `download-ui`, `error`, `majin`,
`filename`, `listing`. They cover the vault round-trip and PSSH parsing, the
console renderer (including `%s` formatting and CJK widths), the packaged-build
config manifest, the live-view wiring, error unwrapping against real undici
failures, the majin URL rules, filename rules and the listing modes.
