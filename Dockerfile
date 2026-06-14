FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json biome.json vitest.config.ts ./
COPY examples ./examples
COPY src ./src
COPY tests ./tests
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
CMD ["node", "dist/src/cli/main.js", "check"]
