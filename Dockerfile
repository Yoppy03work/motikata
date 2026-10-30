# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm install

FROM base AS build
# Next.js の匿名テレメトリ(Vercel への送信)を止める
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
# next start は .next/cache に書き込むので node ユーザーに渡してから root を降りる
RUN chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/worker ./worker
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./
# job ログの置き場(docker-compose で volume を被せる)。node ユーザーが書けるように
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
CMD ["npm", "run", "worker:start"]
