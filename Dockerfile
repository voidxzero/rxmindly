# Build the web app
FROM node:24-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/index.html web/tsconfig.json web/vite.config.ts web/capacitor.config.ts ./
COPY web/public ./public
COPY web/src ./src
RUN npm run build

# The server has no dependencies beyond Node itself (SQLite is built in).
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    RXMINDLY_DB=/data/rxmindly.db \
    RXMINDLY_WEB=/app/web
WORKDIR /app
COPY server/package.json ./
COPY server/src ./src
COPY --from=web /build/dist ./web
# The app runs as "node", not root: make sure it can read the code however the
# files' permissions arrived on the machine doing the build.
RUN chmod -R a+rX /app && mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/status >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
