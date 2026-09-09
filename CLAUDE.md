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

Manual smoke test: `curl -o out.webp "http://localhost:3000/day-counter?width=1179&height=2556"`.

## Configuration

All config is env-driven, parsed and validated once at startup by `loadEnv()` in `src/preload/env.ts`. Invalid values **throw at boot** — there is no runtime fallback beyond the defaults in the destructuring. `.env.example` is incomplete: it omits `NODE_ENV` (`development` | `test` | `production`) and `HOST` (default `0.0.0.0`), both of which are validated.

Validated vars: `NODE_ENV`, `HOST`, `PORT` (1–65535), `FONT_SIZE`, `DEFAULT_HEIGHT`, `DEFAULT_WIDTH` (integers), `PERSON_NAME_{1,2}` (non-blank, ≤ 30 chars), `PERSON_BIRTHDAY_{1,2}` and `ANNIVERSARY` (must match `RegexConstants.DATE`, `YYYY-MM-DD`).

## Architecture

Startup runs through side-effecting imports in `src/preload.ts`:

1. `src/preload/env.ts` — validates `process.env` into the typed `Env` object exported as `Config`.
2. `src/preload/font.ts` — registers `assets/fonts/Prompt-Bold.ttf` with `GlobalFonts` at import time.
3. `src/preload/template.ts` — installs an `fs.watch` on the template at import time. The image itself loads **lazily** on the first `getTemplate()` call, not at import. A module-level `loading` promise dedupes concurrent loads/reloads, and every successful load calls `clearCanvasCache()`.

`src/index.ts` imports `Config` (triggering the chain above), starts the server, and wires `SIGINT`/`SIGTERM` to `server.stop(false)` + a 5s drain window before `process.exit(0)`.

`src/server.ts` is a hand-rolled route table inside `Bun.serve`'s `fetch` (no router): `/` (JSON hello), `/health` (`ok`), `/day-counter` → `dayCounter`, else 404. The whole handler is wrapped in try/catch → 500.

`src/services/day-counter.ts` holds all the logic:

- `dayCounter(searchParams)` — reads `width`/`height` (falling back to `Config.DEFAULT_WIDTH/HEIGHT`), rejects anything outside `AppConstants.MIN_*`/`MAX_*` (1500 × 3000) with a **400 "Unsupported size"**, and races generation against a 30s timeout.
- **Two caches, both keyed on today's date in `Asia/Bangkok`** (`Temporal`), cleared when the date rolls over:
  - `cachedCanvas: Map<string, Promise<Buffer>>` keyed `"${w}x${h}"`. It stores the **promise** synchronously so concurrent requests for one size share a single render; a rejected render deletes its own key. Insertion-order eviction once `MAX_CACHED_IMAGES` is reached.
  - `cachedText` — the generated lines, shared across all sizes for a given day.
- `genCanvas(w, h, today)` draws the template **cover**-style (scaled to fill, overflow cropped — the Thai comment is right, the old "contain" description was not), then `drawGlassPanel` and the text lines.
- `drawGlassPanel` fakes iOS Liquid Glass: soft drop shadow, a blur of **only the cropped background region under the panel** (plus a bleed margin) rendered through the pooled module-level `blurCanvas`, then a milky tint, a top sheen gradient, and a hairline border. Text is drawn left-aligned with no shadow because the panel already provides contrast.
- `calculate(input, todayStr?)` does the date math with `Temporal.PlainDate`: elapsed time (`Ny Nm Nd | Ntotal_days`) plus days until the next yearly occurrence (Feb 29 falls back to day 28 in non-leap years). Every step is individually try/caught and degrades to `"Invalid date"` / `"Error"` strings rather than throwing. `today` is threaded in from the caller so all lines in one image agree on the date.

Constants are split by concern under `src/constants/`: `app.ts` (asset paths, font name, query param names, size limits, cache cap), `headers.ts` (`image/webp`, `Cache-Control: public, max-age=300`), `regex.ts`, `res.ts`, `tz.ts`.

## Notable non-obvious behavior

- Timezone is hardcoded to `Asia/Bangkok` (`TZConstants.TH`) for all date logic and log timestamps, independent of the container's `TZ`.
- Comments and identifiers are mixed Thai/English in `day-counter.ts`; that is existing convention, not an error.
- `docker-compose.yaml` mounts `./template:/app/assets/images:ro`, so the container picks up template edits without a restart via the `fs.watch` reload path. That `./template` directory is **not** in the repo — create it and drop a `template.png` in before running compose.
- The Dockerfile runs as the non-root `bun` user, sets `TZ=Asia/Bangkok`, and has a `HEALTHCHECK` hitting `/health`.
- `CLAUDE.md` itself is listed in `.gitignore` — it is a local-only file, so edits here are not committed.
