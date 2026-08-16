FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY . .

ENV NODE_ENV=production
ENV PORT=3333
EXPOSE 3333

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["npm", "run", "start"]