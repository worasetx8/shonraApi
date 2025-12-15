# Backend API Server Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server files
COPY . ./

# Create uploads directory
RUN mkdir -p uploads/banners uploads/images

# Expose port
EXPOSE 3002

# Start server
CMD ["node", "index.js"]