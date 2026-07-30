# Adapter-only image for the Azure Container App. This half never runs Claude and
# must not need the native better-sqlite3 build — only the Bot Framework adapter,
# restify, ws, and the relay server. Entry is dist/index.js (container), never
# dist/worker.js (which imports claudeRunner/sessionStore and runs on the devbox).
FROM node:20-slim AS build
WORKDIR /app
# better-sqlite3 is an optionalDependency, so its native build failing here (no
# toolchain in slim) is non-fatal — npm skips it. We keep optional deps in the
# build stage because tsc (TypeScript's native binary) needs its own optional
# platform package (@typescript/typescript-*). The runtime stage drops both.
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --omit=optional
COPY --from=build /app/dist ./dist
EXPOSE 3978
CMD ["node", "dist/index.js"]
