# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-endpoint image generation API in **Rust**: axum (on tokio) for HTTP, tiny-skia for drawing, rustybuzz for text shaping, `image` for decoding the template, and libwebp (`webp` crate) for encoding. It renders `assets/images/template.png` at a requested size, overlays day-counter/countdown text inside an iOS-style "liquid glass" panel, and returns a **WebP** image.

It is a port of an earlier Bun + `@napi-rs/canvas` (Skia) version; output was checked pixel-by-pixel against it (mean diff ≈ 2.6 / 765 per pixel, all from blur and encoder differences).

Deployment target is a **Raspberry Pi 3B+ (1GB RAM, shared with the OS)**. That explains `MAX_CACHED_IMAGES = 8`, `MAX_CONCURRENT_RENDERS = 2`, blurring only the panel region, no text shadow, and `mem_limit: 256m` in `docker-compose.yaml`. Keep changes memory- and CPU-frugal.

## Commands

```bash
cargo run                 # dev (debug build, slow renders)
cargo run --release       # what production runs
cargo test                # date tests in src/date.rs
docker buildx build --platform linux/amd64,linux/arm64 -t day-counter:latest --push .
```

No linter/formatter config. `libwebp-sys` compiles libwebp from C, so a C compiler must be available (it is in `rust:*-slim`).

**Asset paths in `src/constants.rs` are relative**, so start the process with the project root (or `/app` in the container) as CWD.

Manual smoke test:

```bash
curl -o out.webp "http://localhost:3000/day-counter?width=1179&height=2556"
```

## Configuration

`env::init()` (`src/env.rs`) reads each var from the process environment, falling back to a project-root `.env` (a tiny built-in parser: `KEY=VALUE`, `#` comments, optional double quotes — process env always wins). Everything is validated once at boot; **invalid values exit the process** with the error on stderr.

Validated vars: `NODE_ENV` (`development` | `test` | `production`, only used in the startup log), `HOST` (default `0.0.0.0`), `PORT` (1–65535), `FONT_SIZE` (1–500), `DEFAULT_WIDTH`/`DEFAULT_HEIGHT` (same `MIN_*`–`MAX_*` range as the query, because `warmup()` renders the default size directly), `PERSON_NAME_{1,2}` (non-blank, ≤ 30 UTF-16 units), `PERSON_BIRTHDAY_{1,2}` and `ANNIVERSARY`.

Integers use JS `Number()`-like rules via `env::parse_int` (shared with the query parser): `"1179.0"` passes, `"1.5"`, `"abc"`, `""` fail.

**Dates in env are `DD/MM/YYYY` with a Buddhist-era year** — `01/03/2569` is 1 March 2026 CE. `parse_env_date` checks shape, that the date exists (`31/02/2569` rejected) and that the year is within `MIN/MAX_BUDDHIST_YEAR` (2400–2700) to catch a Gregorian year typed by mistake. Dates are stored parsed (`NaiveDate`) in `Env`, so render never re-parses.

## Architecture

```
src/
  main.rs       log! macro, boot, axum server + route match, shutdown, `health` subcommand
  env.rs        Env + validation + .env fallback, global CONFIG (OnceLock)
  cache.rs      template holder + mtime poll, per-day image cache, hot sizes, semaphore, warm, rollover
  render.rs     font/template loading, text lines, shaping, glass panel, WebP encode (pure, no state but the font)
  date.rs       date math (chrono) + Bangkok "now" + tests
  constants.rs  tuning constants, each with its reason
```

### Boot order (`main`)

1. `day-counter health` → one HTTP/1.0 `GET /health` to `127.0.0.1:$PORT`, exit 0/1. This is the Docker `HEALTHCHECK` (the runtime image has no curl).
2. `load Font` — `assets/fonts/Prompt-Bold.ttf` is read and leaked into a `'static` rustybuzz `Face`.
3. `load Template` — loaded **eagerly**; a missing or undecodable template fails the boot. The file in the repo is actually a progressive **JPEG** despite the `.png` name, which is why decoding goes through `image::load_from_memory` (png + jpeg features) rather than tiny-skia's PNG loader.
4. `env::init()`, bind, log `Running in …`.
5. `cache::warmup()` is spawned **without awaiting**, so `/health` answers immediately.

Shutdown: SIGINT/SIGTERM (Ctrl-C only on Windows) → axum graceful shutdown, capped at `SHUTDOWN_DRAIN` (5s); exits as soon as in-flight requests finish.

### Request path

`main::handle` is the router's only handler (`fallback`), a hand-rolled `match` like the original: `/` (JSON hello), `/health` (`ok`), `/day-counter`, else 404 `Not Found`. Any method is accepted. Every request is logged with its query string; an `Err` from a route is logged and becomes `500 Internal Server Error`.

`/day-counter`: `parse_size` (missing param → configured default; not an integer in 1–1500 × 1–3000 → **400 "Unsupported size"**; `?width=1&height=1` is legal), then `tokio::time::timeout(RENDER_TIMEOUT, cache::get_image(size))`. A timeout is a 500 but does **not** cancel the render — it runs in its own spawned task and stays cached for the next request. `Cache-Control: public, max-age=min(300, seconds until Bangkok midnight)`, floored at 1.

### `cache.rs`

- `STATE` (one `std::sync::Mutex`): today's date, `images: Vec<(size, Shared future)>` and `hot: Vec<size>`. Both are FIFO-capped at `MAX_CACHED_IMAGES` with linear scans (8 entries).
- `get_image` clears `images` when the Bangkok date changes, records the size in `hot` (even on a hit), and returns the cached `Shared` future or inserts a new one **synchronously under the lock**, so concurrent requests for one size share a single render. The render is `tokio::spawn` → acquire `RENDER_SLOTS` (`Semaphore`, 2) → `spawn_blocking(render::render)`. A failed render removes its key.
- `hot` survives the date rollover; it is what pre-warming iterates over. `warm_hot_sizes` renders them **sequentially**, guarded by an `AtomicBool` so only one warm runs at a time.
- `spawn_rollover` sleeps until the next Bangkok midnight + `ROLLOVER_GRACE_MS`, then warms; it loops, recomputing the delay from the wall clock each time.
- `spawn_template_watch` **polls** the template's `(mtime, len)` every `TEMPLATE_POLL_INTERVAL` (1s) instead of using inotify: it works through docker bind mounts and rename-over writes, and fires once per change, so there is no debounce. On change it reloads on a blocking thread; success → `clear_cache()` (drops in-flight entries too) → background warm. A half-written file just fails to decode, logs `Template reload failed`, and is picked up on the next mtime change.

### `render.rs`

- `render(w, h, today, cfg, template)` draws the template **cover**-style (bilinear, scaled to fill, overflow cropped), builds the 8 text lines, measures them, lays out the panel, draws panel + text, then `take_demultiplied()` → `webp::Encoder::from_rgba(..).encode(85)`.
- Text is shaped with rustybuzz (needed for Thai mark stacking), glyph outlines go straight into a tiny-skia `PathBuilder`, one fill per line segment. `textBaseline = "middle"` is reproduced as baseline = y + (ascender + descender) / 2 × scale, which is what Skia does.
- Glass panel: blur of **only the crop under the panel** (+ 2× radius bleed) via `image::imageops::fast_blur` (σ = round(radius), matching CSS `blur()`), clipped by a rounded-rect `Mask`, then a milky tint, a top sheen gradient and a hairline gradient border. The original's drop shadow is intentionally **not** ported: it used `shadowBlur` on a fill with alpha 0.01, and Skia multiplies shadow alpha by fill alpha, so it was invisible.
- `FONT_SIZE` is absolute; the panel is sized from the measured text (`x = w / 10`, vertically centred, clamped to the canvas) but text is **neither wrapped nor truncated**.

### `date.rs`

- Calendar dates are `chrono::NaiveDate`. "Now in Bangkok" is plain epoch arithmetic with the fixed `TH_UTC_OFFSET_MS` — Thailand has been UTC+7 with no DST since 1920, so no tz database is needed. It is cheap enough to compute on every call; there is no memo, and a clock stepped backwards (the Pi has no RTC) is handled naturally.
- `diff_years_months_days`: whole months = calendar-month difference, minus one if `to.day() < from.day()`; then `from + Months(n)` (chrono clamps end-of-month) and the remaining days. `1999-03-31 → 2024-02-29` is `24y10m29d`, not `24y11m0d`.
- `next_yearly_occurrence` moves the base into this/next year with Feb 29 → Feb 28 clamping per candidate year, so a Feb-29 birthday lands on Feb 29 in leap years.
- Verified identical to the previous dayjs implementation over 534,726 (base, target) pairs (bases 1996–1999 daily × targets 2024–2028 every 5th day), both output lines.

## Notable non-obvious behavior

- `docker-compose.yaml` mounts `./template:/app/assets/images:ro`; that directory is **not** in the repo — create it with a `template.png` before `docker compose up`.
- Compose passes only the person/anniversary vars, so `FONT_SIZE` and `DEFAULT_*` use the defaults (48 / 1179 / 2556). Its `PERSON_NAME_2=Person1` is a copy-paste slip.
- The runtime image is `debian:bookworm-slim`, runs as uid 65534 (`nobody`), binary at `/usr/local/bin/day-counter`, assets at `/app/assets`. A multi-arch buildx build compiles the arm64 binary under QEMU, which is slow.
- Log lines are `DD/MM/<Buddhist year> HH:MM:SS [LOG] …` in Bangkok time regardless of the container `TZ`, via the `log!` macro in `main.rs` (the only logging path).
- Comments are mixed Thai/English; that is existing convention.
- `CLAUDE.md` is tracked in git; edits to it are committed like any other file.

## Conventions

- Commits are **Conventional Commits with a scope**, subject only, no body: `refactor(day-counter): …`, `fix(template): …`, `chore(constants): …`. Breaking change gets `!`. Doc-only changes are bare `docs:`.
- Tuning constants live in `src/constants.rs` as plain `pub const`s with the *reason* in a comment. **Drawing styles are the exception**: colours and layout ratios stay inline in `render.rs` (`TEXT_COLOR`, the countdown colours, the panel `white(alpha)` values, `LINE_HEIGHT_RATIO`).
- Few files, free functions, module-level statics for the little global state there is (`CONFIG`, `FACE`, `STATE`, `TEMPLATE`, `RENDER_SLOTS`).
