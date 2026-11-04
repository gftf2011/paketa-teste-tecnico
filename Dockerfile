# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine

# Compila o TypeScript.
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: evita, entre outros, o download do binário do MongoDB
# usado só nos testes (mongodb-memory-server).
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Apenas as dependências de produção.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Imagem final: sem TypeScript, sem dependências de dev, usuário sem privilégios.
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" > /dev/null || exit 1
CMD ["node", "dist/main/server.js"]
