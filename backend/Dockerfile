### Stage 1: Build frontend
FROM node:20-alpine AS frontend

WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

### Stage 2: Build backend
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY backend/package.json ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

### Stage 3: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install ffprobe for duration detection
RUN apk add --no-cache ffmpeg

# Install build tools for native modules, then install prod deps
RUN apk add --no-cache python3 make g++
COPY backend/package.json ./backend/
RUN cd backend && npm install --production

# Copy backend build
COPY --from=builder /app/dist ./backend/dist
COPY backend/config ./backend/config

# Copy frontend build
COPY --from=frontend /app/dist ./frontend/dist

EXPOSE 3000

CMD ["node", "backend/dist/index.js"]
