FROM node:20-alpine AS build

LABEL maintainer="dev@example.com"

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY . .

RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

ENV NODE_ENV=production \
  PORT=3000

EXPOSE 3000

USER node

CMD ["node", "dist/server.js"]
