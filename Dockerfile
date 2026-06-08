FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json biome.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV GITDB_HOST=0.0.0.0
ENV GITDB_PORT=7432
ENV PORT=3000
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
EXPOSE 3000
EXPOSE 7432
CMD ["node", "dist/src/http/main.js"]
