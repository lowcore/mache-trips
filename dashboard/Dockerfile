# Mach-E trips dashboard — built for DSM 6.2.4's older Docker engine:
#   - plain multi-stage build, no BuildKit-only syntax
#   - node:20-bullseye-slim (glibc 2.31): newer Debian bases use glibc 2.34+,
#     whose clone3() syscall is blocked (EPERM) by old Docker seccomp profiles
#     and crashes the process on DSM 6

FROM node:20-bullseye-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bullseye-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TRIPS_DB=/data/trips.db \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
