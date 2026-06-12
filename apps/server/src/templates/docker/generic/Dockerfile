# Base image for generic projects
FROM node:24-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash codver

# Set working directory
WORKDIR /workspace

# Copy executor script
COPY executor.js /executor.js

# Set permissions
RUN chown -R codver:codver /workspace

USER codver

# Default command
CMD ["node", "/executor.js"]
