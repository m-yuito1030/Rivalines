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

FROM node:22-alpine AS server
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV DATA_DIR=/data
CMD ["npx", "tsx", "server/index.ts"]
