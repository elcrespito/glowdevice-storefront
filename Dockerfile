FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Coolify may inject NODE_ENV=production; keep devDeps for next build.
RUN NODE_ENV=development pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache libc6-compat
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Establish a dependency on the deps stage before installing sharp. Without it
# BuildKit runs this install alongside the main pnpm install, which can exhaust
# a small Coolify builder and terminate the deploy with exit code 255.
COPY --from=deps /app/package.json /tmp/deps-package.json
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN pnpm add sharp

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
