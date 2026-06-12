# Base image for Rust projects
FROM rust:1.83-slim

# Install system dependencies including Node.js 24
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
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
