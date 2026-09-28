FROM node:20-alpine AS build

LABEL maintainer="dev@example.com"

ARG BUILD_DATE=unknown
ARG VERSION

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .

RUN npm run build

FROM node:20-alpine

ARG VERSION
LABEL version="${VERSION}" build-date="${BUILD_DATE}"

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

ENV NODE_ENV=production \
    PORT=3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget --quiet --spider http://localhost:3000/health || exit 1

VOLUME ["/data"]

STOPSIGNAL SIGTERM

EXPOSE 3000

USER node

ENTRYPOINT ["node", "dist/server.js"]
CMD ["--port", "3000"]