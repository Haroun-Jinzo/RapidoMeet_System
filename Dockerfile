# Dockerfile

# Start from the official Node.js 20 image (Alpine = small Linux)
FROM node:20-alpine

# Create the working directory inside the container
WORKDIR /app

# Copy package files FIRST (separate from source code)
# This is a Docker optimization: if package.json didn't change,
# Docker reuses the cached layer and skips npm install
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including dev deps needed for TypeScript build)
RUN npm ci

# Copy the source code
COPY src/ ./src/

# Build TypeScript → JavaScript
RUN npm run build

# Remove dev dependencies — production image should be lean
RUN npm ci --production && npm cache clean --force

# The port our server listens on
EXPOSE 3000

# Health check — Docker and Render use this to know the app is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start the compiled JavaScript server
CMD ["node", "dist/index.js"]