FROM node:20-alpine AS builder
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/
COPY backend/prisma ./backend/prisma/
COPY worker/package*.json ./worker/
COPY worker/tsconfig.json ./worker/
RUN npm ci --workspaces
RUN npx prisma generate --schema=backend/prisma/schema.prisma
COPY backend/src ./backend/src/
COPY worker/src ./worker/src/
RUN npm run build --workspace=backend
RUN npm run build --workspace=worker

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY worker/package*.json ./worker/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/worker/dist ./worker/dist
WORKDIR /app/worker
CMD ["node", "dist/index.js"]
