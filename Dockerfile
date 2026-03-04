# ─────────────────────────────────────────────────
# GRC Server — Multi-stage Docker Build
# Modular Monolith: Single image containing all modules
# ─────────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app

# Security: run as non-root
RUN addgroup -S grc && adduser -S grc -G grc

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled code
COPY --from=builder /app/dist ./dist

# Switch to non-root user
USER grc

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
