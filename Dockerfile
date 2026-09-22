# syntax=docker/dockerfile:1.7
#
# Next.js standalone build for AWS (App Runner / ECS Fargate / EC2 Graviton).
# Defaults to linux/arm64; override with --build-arg IMAGE_PLATFORM=linux/amd64.
#
# Three things this image has to get right that a stock Next Dockerfile misses:
#   1. NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they
#      come in as build args, not runtime env vars.
#   2. lib/wiki-loader.ts reads content/ off the filesystem at runtime with
#      process.cwd(). Next's output tracing does pick content/ up today, but
#      it infers that from the code rather than being told; the explicit COPY
#      below guarantees it survives a refactor of wiki-loader.
#   3. The arch is pinned on every FROM, so a plain `docker build` on an x86
#      laptop still emits an arm64 image (via binfmt/QEMU) instead of silently
#      producing an amd64 one that App Runner/ECS then refuses to start.
#
# Every native dependency here ships an arm64-musl binary and package-lock.json
# records it (@next/swc, @tailwindcss/oxide, @unrs/resolver, sharp), so alpine
# on arm64 needs no special casing at install time.

ARG IMAGE_PLATFORM=linux/arm64
ARG NODE_IMAGE=node:22-alpine

FROM --platform=$IMAGE_PLATFORM $NODE_IMAGE AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM --platform=$IMAGE_PLATFORM $NODE_IMAGE AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
# Emulated arm64 builds are memory-hungrier than native ones; 4 GB keeps the
# Next compile off the default heap ceiling on a 2 GB-ish CI runner.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

FROM --platform=$IMAGE_PLATFORM $NODE_IMAGE AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder /app/content ./content
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
