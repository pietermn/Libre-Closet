# Build stage
FROM node:22 AS builder

# Create app directory
WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
#
# Note when using COPY with more than one source file, 
# the destination must be a directory and end with a /
COPY package*.json ./
COPY patches ./patches
RUN npm ci --include=dev

COPY src ./src
COPY views ./views
COPY public ./public
COPY tsconfig*.json ./
COPY nest-cli.json .
COPY tailwind.config.js .
COPY workbox-config.js .

RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY patches ./patches
RUN npm ci --include=dev && npm prune --omit=dev && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public

# Set NODE_ENV to production
ENV NODE_ENV=production

# Runtime files are read-only; do not recursively chown node_modules. Besides
# making builds slow, that duplicates a large image layer. The writable data
# directory is the mounted volume and is owned by this UID on deployment.
RUN groupadd --gid 999 --system app && useradd --uid 999 --system --gid app --home-dir /app app
USER app

EXPOSE 3000

CMD [ "npm", "run", "start:prod" ]
