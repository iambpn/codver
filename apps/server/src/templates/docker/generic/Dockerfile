FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    gh \
    ripgrep \
    bash \
    ca-certificates \
    curl \
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
