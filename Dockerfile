# Game server + built client in one small image (no npm install — the project has no dependencies).
#   docker build -t aeii .
#   docker run -p 3080:3080 -e SOURCE_URL=https://github.com/you/repo aeii
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
ARG SITE_URL=""
ARG SERVER_URL=""
ARG SOURCE_URL=""
ARG ONLINE="on"
RUN SITE_URL="$SITE_URL" SERVER_URL="$SERVER_URL" SOURCE_URL="$SOURCE_URL" ONLINE="$ONLINE" node scripts/build.mjs

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3080 HOST=0.0.0.0 STATIC_DIR=/app/dist TRUST_PROXY=1
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./package.json
USER node
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:3080/healthz || exit 1
CMD ["node", "server/server.mjs"]
