# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-endpoint image generation API built on Bun's native HTTP server (`Bun.serve` — **not** Express, despite what `README.md` says) and `@napi-rs/canvas` (Skia bindings). It renders `assets/images/template.png` at a requested size, overlays day-counter/countdown text inside an iOS-style "liquid glass" panel, and returns a **WebP** image (the README's PNG/Express/10-minute-cache claims are all stale).

Deployment target is a **Raspberry Pi 3B+ (1GB RAM, shared with the OS)**. This constraint explains most of the non-obvious code: `AppConstants.MAX_CACHED_IMAGES = 8`, the pooled blur canvas, blurring only the panel region instead of the whole image, no `shadowBlur` on `fillText`, and `mem_limit: 256m` in `docker-compose.yaml`. Keep changes memory- and CPU-frugal.

## Commands

```bash
bun install              # install deps
bun run start:dev        # run from source (src/index.ts)
bun run build            # bundle to dist/ (minified, @napi-rs/canvas kept external)
bun run start            # build, then run the bundle (dist/index.js)
bun run build:docker     # multi-arch buildx build + push (day-counter:latest)
```

No test suite, linter, or formatter is configured. There is no typecheck script either — use `bunx tsc --noEmit` if you need one (`tsconfig.json` is `strict` + `noUncheckedIndexedAccess`).

**Asset paths in `src/constants/app.ts` are relative**, so the process must be started with the project root (or `/app` in the container) as CWD, or font/template loading fails.

Manual smoke test:

```bash
curl -o out.webp "http://localhost:3000/day-counter?width=1179&height=2556"
```

Bun auto-loads `.env` from the project root; there is no dotenv dependency.

## Configuration

All config is env-driven, parsed and validated once at startup by `loadEnv()` in `src/preload/env.ts`. Invalid values **throw at boot** — there is no runtime fallback beyond the defaults in the destructuring. `.env.example` is incomplete: it omits `NODE_ENV` (`development` | `test` | `production`) and `HOST` (default `0.0.0.0`), both of which are validated.

Validated vars: `NODE_ENV`, `HOST`, `PORT` (1–65535), `FONT_SIZE`, `DEFAULT_HEIGHT`, `DEFAULT_WIDTH` (integers), `PERSON_NAME_{1,2}` (non-blank, ≤ 30 chars), `PERSON_BIRTHDAY_{1,2}` and `ANNIVERSARY`.

**Dates in env are `DD/MM/YYYY` with a Buddhist-era year** — `01/03/2569` means 1 March 2026 CE. `parseEnvDate()` validates them at boot: shape (`RegexConstants.DATE`), that the date actually exists (`31/02/2569` is rejected), and that the year falls in `CalendarConstants.MIN/MAX_BUDDHIST_YEAR` (2400–2700). That last check exists to catch a Gregorian year typed in by mistake — without it `01/03/2026` would silently resolve to 1483 CE. Nothing reaches render time as `"Invalid date"` any more; bad config fails the boot.

## Architecture

### Boot order and the import cycle

`src/index.ts` imports `src/preload.ts`, which drives startup. The real order is **not** the order `preload.ts` reads, because imported module bodies evaluate before the importer's own statements:

1. `src/preload/font.ts` — registers `assets/fonts/Prompt-Bold.ttf` with `GlobalFonts` at import time.
2. `src/preload/template.ts` — installs an `fs.watch` on the template at import time (throws at boot if the file is missing). The image itself loads **lazily** on the first `getTemplate()` call, not at import. A module-level `loading` promise dedupes concurrent loads/reloads, and every successful load calls `clearCanvasCache()`. The watcher is debounced (`TEMPLATE_RELOAD_DEBOUNCE_MS`) because `fs.watch` fires several events per file write.
3. *Then* `export const Config = loadEnv()` runs in `preload.ts`, validating `process.env` into the typed `Env` object.

So font registration and the watcher happen **before** env validation — a bad `PORT` still logs `load Font` first.

`preload.ts` → `preload/template.ts` → `services/day-counter.ts` → `preload.ts` is a **circular import**. It works only because `day-counter.ts` touches `Config` exclusively inside function bodies. Reading `Config.X` at module top level there (or in anything else `template.ts` pulls in) throws `Cannot access 'Config' before initialization` at boot.

### Request path

`src/index.ts` starts the server, kicks off `warmup()` **without awaiting it** (so `/health` answers immediately), and wires `SIGINT`/`SIGTERM` to `server.stop(false)` + a 5s drain window before `process.exit(0)`.

`src/server.ts` is a hand-rolled route table inside `Bun.serve`'s `fetch` (no router, `reusePort: true`): `/` (JSON hello), `/health` (`ok`), `/day-counter` → `dayCounter`, else 404. The whole handler is wrapped in try/catch → 500. Every request is logged unconditionally, query string included.

`src/services/day-counter.ts` holds all the logic:

- `dayCounter(searchParams)` — reads `width`/`height` (falling back to `Config.DEFAULT_WIDTH/HEIGHT`), rejects anything outside `AppConstants.MIN_*`/`MAX_*` (1500 × 3000) with a **400 "Unsupported size"** (non-numeric input becomes `NaN` and lands here too), and races generation against `RENDER_TIMEOUT_MS`. A timeout rejects out of the handler and surfaces as the generic 500; it does **not** cancel the render, and the entry stays cached so the next request picks up the finished result.
- **Two caches, both keyed on today's date in `Asia/Bangkok`**, cleared when the date rolls over:
  - `cachedCanvas: Map<string, Promise<Buffer>>` keyed `"${w}x${h}"`. It stores the **promise** synchronously so concurrent requests for one size share a single render; a rejected render deletes its own key. Insertion-order (FIFO, not LRU) eviction once `MAX_CACHED_IMAGES` is reached.
  - `cachedText` — the generated lines, shared across all sizes for a given day.
- `genCanvas(w, h, today)` draws the template **cover**-style (scaled to fill, overflow cropped — the Thai comment is right, the old "contain" description was not), then `drawGlassPanel` and the text lines, and encodes WebP at quality 85.
- `drawGlassPanel` fakes iOS Liquid Glass: soft drop shadow, a blur of **only the cropped background region under the panel** (plus a bleed margin) rendered through the pooled module-level `blurCanvas`, then a milky tint, a top sheen gradient, and a hairline border. Text is drawn left-aligned with no shadow because the panel already provides contrast.
- `calculate(input, todayStr?)` does the date math via `src/utils/date.ts`: elapsed time (`{y}y{m}m{d}d | {total}d`) plus days until the next yearly occurrence. `input` is the raw env string (`DD/MM/YYYY`, Buddhist year); it is already validated at boot, so the `"Invalid date"` fallback is defence in depth rather than a path you should hit. `today` is threaded in from the caller so all lines in one image agree on the date.

Constants are split by concern under `src/constants/`: `app.ts` (asset paths, font name, query param names, size limits, cache cap, render/rollover tuning), `headers.ts`, `regex.ts`, `res.ts`, `tz.ts` (timezone + the fixed UTC+7 offset, locale, and `CalendarConstants` for the Buddhist-era env date format).

### Keeping renders off the request path

A full 1179 × 2556 render is ~390ms on a dev desktop, of which `canvas.encode("webp", 85)` alone is ~150–180ms (lowering quality barely helps — q50 only saves ~13%). On the Pi that is seconds, so nothing that can be precomputed should happen while a request waits:

- `warmup()` (exported, called from `index.ts`) loads the template, renders `DEFAULT_WIDTH × DEFAULT_HEIGHT`, then arms the rollover timer.
- `hotSizes` remembers every `w × h` ever requested (same FIFO cap as the image cache) and **survives the date rollover**, which `cachedCanvas` does not. It is what pre-warming iterates over.
- A timer fires at the next Bangkok midnight + `ROLLOVER_GRACE_MS` and re-renders every hot size **sequentially in the background**, then re-arms itself. Re-arming happens *before* the warm so a failed render can't break the chain. The timer is `unref()`'d so it never blocks shutdown.
- `clearCanvasCache()` also schedules a debounced background warm (`WARM_DEBOUNCE_MS`), so a template edit doesn't push the re-render onto the next visitor.
- `renderWithSlot` gates every render through a `MAX_CONCURRENT_RENDERS` semaphore. Requests for the *same* size still share one promise; the semaphore only bounds *distinct* sizes, which is what would otherwise blow the 2-CPU / 256m container budget.
- `getToday()` lives in `src/utils/date.ts` — see below.

### Date math lives in `src/utils/date.ts` (dayjs)

The only date dependency is **dayjs** with the `utc` and `customParseFormat` plugins (~12 KB bundled; the bundle is 23.35 KB total). Every calendar date in the system is a **UTC-midnight `Dayjs`**, so day diffs are always whole days with no time component to round.

- **Timezone is a fixed `UTC+7`, not `dayjs.tz()`.** Thailand has used UTC+7 since 1920 and has never observed DST, so `TZConstants.TH_UTC_OFFSET_MINUTES` is correct and `dayjs().utcOffset(420)` is ~54× faster than `dayjs().tz("Asia/Bangkok")`, which rebuilds an `Intl.DateTimeFormat` on every call. `getToday()` runs on every request, so this matters. Do **not** "fix" this by switching to the timezone plugin.
- `diffYearsMonthsDays` does **not** use `to.diff(from, "month")`. dayjs counts a clamped month as a whole month, which makes every end-of-month base come out one month too high (`1999-03-31 → 2024-02-29` would be `24y11m0d` instead of the correct `24y10m29d`). The rule that works: decide the whole-month count by comparing the target against the **unclamped** anchor, then let `dayjs.add(n, "month")` clamp. Verified equal to the previous `Temporal`-based implementation across 548,160 date pairs (bases 1996–2030 × targets 2024–2028), zero differences in either output line.
- `parseIsoDate` / `parseEnvDate` use dayjs **strict** parsing, so `2026-02-31` and `29/02/2569` are rejected rather than silently rolled over.
- `nextMidnightMs` is today's UTC-midnight plus one day, minus the fixed offset.
- `nextYearlyOccurrence` relies on `dayjs.year(y)` clamping Feb 29 → Feb 28 in non-leap years while returning Feb 29 in leap ones, so the occurrence is recomputed per candidate year. An earlier `Temporal` version clamped once and *then* added a year, which made the next occurrence after a Feb-29 birthday land on Feb 28 of a leap year — one day early. That bug is fixed; it only ever affected Feb-29 dates.

## Notable non-obvious behavior

- `clearCanvasCache()` drops **in-flight** entries too, so any render racing a template reload is thrown away. `warmup()` deliberately awaits `getTemplate()` *before* rendering anything, because otherwise the lazy first template load wipes the first request's own in-flight entry and it has to render twice.
- `Cache-Control` on `/day-counter` is `max-age=min(IMAGE_MAX_AGE_SECONDS, seconds until Bangkok midnight)`, so a client cache can never span the day boundary and show yesterday's counts. It shrinks to single digits just before midnight.
- `FONT_SIZE` is absolute and independent of the requested `width`/`height`. The panel is sized from the measured text (`panelX = w / 10`, vertically centred) and clamped to the canvas, but the text itself is **neither wrapped nor truncated** — long names or small requested sizes overflow the panel.
- Timezone is hardcoded to `Asia/Bangkok` (`TZConstants.TH`) for all date logic and log timestamps, independent of the container's `TZ`.
- Comments and identifiers are mixed Thai/English in `day-counter.ts`; that is existing convention, not an error.
- `docker-compose.yaml` mounts `./template:/app/assets/images:ro`, so the container picks up template edits without a restart via the `fs.watch` reload path. That `./template` directory is **not** in the repo — create it and drop a `template.png` in before running compose.
- The Dockerfile runs as the non-root `bun` user, sets `TZ=Asia/Bangkok`, and has a `HEALTHCHECK` hitting `/health`. It installs from `bun.lock` with `--frozen-lockfile`; the stray `package-lock.json` is unused.
- `CLAUDE.md` is tracked in git (committed in `7afcf69`), so edits to it are part of the repo and get committed like any other file.
