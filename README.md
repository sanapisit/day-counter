# Day Counter

Image generation API (WebP) written in Rust: axum + tiny-skia + rustybuzz + libwebp.
Renders `assets/images/template.png` at the requested size and draws day-counter /
countdown text inside an iOS-style "liquid glass" panel. Built to run on a
Raspberry Pi 3B+.

## Environment Variables

Read from the process environment, falling back to `.env` in the project root:

    NODE_ENV=development   # development | test | production
    HOST=0.0.0.0
    PORT=3000

    FONT_SIZE=48
    DEFAULT_HEIGHT=2556
    DEFAULT_WIDTH=1179

    PERSON_NAME_1=Person1
    PERSON_BIRTHDAY_1=01/03/2569

    PERSON_NAME_2=Person2
    PERSON_BIRTHDAY_2=01/03/2569

    ANNIVERSARY=01/03/2569

Dates use `DD/MM/YYYY` with a Buddhist-era year, so `01/03/2569` is 1 March 2026.
Invalid values fail the boot.

## Development

```bash
cargo run
```

```bash
cargo test
```

Run from the project root: asset paths are relative.

## Build

Requires the Rust toolchain ([rustup](https://rustup.rs)) and a C compiler (libwebp is compiled from source).

```bash
cargo build --release
```

The binary is `target/release/day-counter` (`.exe` on Windows). Run it from the project root:

```bash
./target/release/day-counter
```

## API

`GET /day-counter?width=1179&height=2556` → `image/webp`

`width` (1–1500) and `height` (1–3000) are optional integers; anything else is `400 Unsupported size`.
`Cache-Control: max-age` is capped at 300s and never crosses Bangkok midnight.

`GET /health` → `ok`

## Docker

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t day-counter:latest --push .
```

```bash
docker compose up -d
```

`docker-compose.yaml` mounts `./template` over `assets/images`; drop a `template.png` there.
The template is polled every second and reloaded without a restart.
