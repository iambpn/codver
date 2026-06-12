FROM rust:1.83-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
    && npm cache clean --force

RUN groupadd -g 1000 codver \
    && useradd -u 1000 -g 1000 -m -s /bin/bash -d /home/codver codver

WORKDIR /workspace

COPY --chown=codver:codver executor.js /executor.js
RUN chmod 755 /executor.js

USER codver:codver

ENV NODE_OPTIONS="--max-old-space-size=3072"
ENV NPM_CONFIG_LOGLEVEL=warn

ENTRYPOINT ["node", "/executor.js"]
