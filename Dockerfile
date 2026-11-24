FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/conf.d/security-headers.inc
COPY --from=build /app/dist /usr/share/nginx/html

# 入り口(ゲートウェイ): ポータル(/)・本稼働のクライアント(/live/)・次期バージョンのクライアント(/next/)を配る。
# 本稼働のクライアントは、本稼働のコード(別の場所に置いたもの。compose の additional_contexts の live)から作る。
FROM node:22-alpine AS live-build
WORKDIR /app
COPY --from=live package.json package-lock.json ./
RUN npm ci
COPY --from=live . .
RUN npm run build

FROM nginx:alpine AS gateway
COPY deploy/nginx.gateway.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/conf.d/security-headers.inc
# ポータル(/)には、アイコン・規約などの共通の静的ファイルも置く
COPY public/ /usr/share/nginx/html/
COPY portal/ /usr/share/nginx/html/
COPY --from=live-build /app/dist /usr/share/nginx/html/live
COPY --from=build /app/dist /usr/share/nginx/html/next

FROM node:22-alpine AS server
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV DATA_DIR=/data
CMD ["npx", "tsx", "server/index.ts"]
