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

# The entrance (gateway): serves the portal (/), the production client (/live/), and the next version's client (/next/).
# The production client is built from the production code (placed elsewhere; `live` in the compose additional_contexts).
FROM node:22-alpine AS live-build
WORKDIR /app
COPY --from=live package.json package-lock.json ./
RUN npm ci
COPY --from=live . .
RUN npm run build

FROM nginx:alpine AS gateway
COPY deploy/nginx.gateway.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/conf.d/security-headers.inc
# The portal (/) also holds shared static files such as icons and the terms
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
