FROM node:20-alpine AS builder
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/
COPY backend/prisma ./backend/prisma/
RUN npm ci --workspace=backend
COPY backend/src ./backend/src/
RUN npx prisma generate --schema=backend/prisma/schema.prisma
RUN npm run build --workspace=backend

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY docs/openapi.yaml /app/docs/openapi.yaml
EXPOSE 5000
WORKDIR /app/backend
CMD ["sh", "-c", "npx prisma migrate deploy && npm run prisma:seed && node dist/server.js"]
