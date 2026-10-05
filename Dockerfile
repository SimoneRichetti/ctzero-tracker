FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
COPY shared/src shared/src
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "--import", "tsx", "server/src/main.ts"]
