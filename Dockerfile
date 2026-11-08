FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --cache /app/.cache/npm
COPY index.html tsconfig.json vite.config.ts eslint.config.js ./
COPY src ./src
COPY public ./public
COPY tests ./tests
COPY supabase/functions ./supabase/functions
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /run/smart-agro && chown node:node /run/smart-agro
COPY --from=build /app/dist ./dist
COPY scripts/backend-gateway.mjs scripts/docker-config.mjs ./scripts/
COPY supabase/functions ./supabase/functions
COPY src/lib ./src/lib
COPY tests/docker-smoke.mjs ./tests/docker-smoke.mjs
USER node
EXPOSE 54321
CMD ["node", "scripts/backend-gateway.mjs"]
