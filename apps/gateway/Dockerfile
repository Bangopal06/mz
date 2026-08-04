FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json ./

# Install all dependencies
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3001

# Start production server
CMD ["node", "dist/index.js"]
