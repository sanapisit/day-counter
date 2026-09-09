# Day Counter

Dynamic image generation API (PNG) built with Bun + Express + @napi-rs/canvas.
Generates an image from a template and renders dynamic text (daycounter) on top.

---

## Features

- High-performance Bun runtime
- PNG image response (`Content-Type: image/png`)
- Custom width / height via query params
- Prompt font rendering
- Text shadow support
- 10-minute cache headers
- Docker-ready (multi-stage, production optimized)

---

## Tech Stack

- Bun
- Express 5
- @napi-rs/canvas (Skia)
- @js-temporal/polyfill

---

## Environment Variables

Create `.env` in project root:

    PORT=3000

    FONT_SIZE=48
    DEFAULT_HEIGHT=2556
    DEFAULT_WIDTH=1179

    PERSON_NAME_1=Person1
    PERSON_BIRTHDAY_1=2026-03-01

    PERSON_NAME_2=Person2
    PERSON_BIRTHDAY_2=2026-03-01

    ANNIVERSARY=2026-03-01

---

## Development

Install dependencies:

```bash
bun install
```

Run directly (dev mode):

```bash
bun src/index.ts
```

---

## Build (Bundle)

```bash
bun run build
```

Run production bundle:

```bash
bun dist/index.js
```

---

## API

### GET `/day-counter`

Query Parameters:

param type required description

---

height number no image height
width number no image width

Example:

GET /day-counter?height=2556&width=1179

Response:

- `Content-Type: image/png`

---

## Docker

Build image:

```bash
docker build -t day-counter .
```

Run container:

```bash
docker run -p 3000:3000 day-counter
```

---

## Performance Notes

- Template image loaded from `assets/images/template.png`
- Font registered once at startup
- Native canvas kept external (not bundled)
- Production deps only in runtime stage
- Non-root container user

---

## Security Notes

- Query params validated (numeric only)
- No dynamic file path usage
- Production mode enabled
- Runs as non-root in container

---

## License

Private project
