# Use official Puppeteer image which includes Chromium and all required libs
FROM ghcr.io/puppeteer/puppeteer:latest

# Create app directory
WORKDIR /app

# Install dependencies using lockfile for reproducible builds
COPY package*.json ./

# We use puppeteer-core and system Chromium from the base image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install only production deps
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose the app port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
