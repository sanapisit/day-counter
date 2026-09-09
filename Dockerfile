# ---------- Build Stage ----------
FROM oven/bun:1.3 AS build
WORKDIR /app

# install deps
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# copy source
COPY src ./src
COPY assets ./assets

# build bundle
RUN bun run build

# ---------- Runtime Stage ----------
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Bangkok

USER bun

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["bun", "dist/index.js"]