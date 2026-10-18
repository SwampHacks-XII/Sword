FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/server/package.json apps/server/package-lock.json apps/server/
RUN npm ci --include=dev --prefix apps/server
COPY packages/protocol/src packages/protocol/src
COPY packages/protocol/tsconfig.json packages/protocol/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/server/tsconfig.json apps/server/tsconfig.json
RUN npm run protocol:build --prefix apps/server && npm run build --prefix apps/server --ignore-scripts
RUN npm prune --omit=dev --prefix apps/server

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/packages/protocol/package.json packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
USER node
CMD ["node", "apps/server/dist/quest-relay.js"]
