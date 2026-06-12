# Base image for Go projects
FROM golang:1.23-alpine

# Install system dependencies including Node.js
RUN apk add --no-cache git curl ca-certificates nodejs npm

# Create non-root user
RUN adduser -D -s /bin/sh codver

# Set working directory
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js

# Set permissions
RUN chown -R codver:codver /workspace

USER codver

# Default command
CMD ["node", "/executor.js"]
