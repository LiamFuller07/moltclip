FROM node:20-bookworm-slim

# Install Playwright system dependencies + Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    libxshmfence1 \
    fonts-noto-color-emoji \
    fonts-liberation \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Install Playwright browsers
RUN npx playwright install chromium

# Copy source
COPY . .

# Build
RUN pnpm build 2>/dev/null || true

# Create data directories
RUN mkdir -p /data/profiles /data/workspaces /data/credentials /data/backups

EXPOSE 8800

CMD ["node", "dist/index.js"]
