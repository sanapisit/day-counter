# ---------- Build Stage ----------
FROM rust:1-slim-bookworm AS build
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# ---------- Runtime Stage ----------
FROM debian:bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/target/release/day-counter /usr/local/bin/day-counter
COPY assets ./assets

# nobody
USER 65534

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["day-counter", "health"]

ENTRYPOINT ["day-counter"]
