FROM golang:1.23-alpine

RUN apk add --no-cache git curl ca-certificates nodejs npm bash ripgrep
RUN apk add --no-cache --virtual .build-dependencies shadow

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
    && npm cache clean --force

RUN groupadd -g 1000 codver \
    && useradd -u 1000 -g 1000 -m -s /bin/bash -d /home/codver codver \
    && apk del .build-dependencies

WORKDIR /workspace

COPY --chown=codver:codver executor.js /executor.js
RUN chmod 755 /executor.js

USER codver:codver

ENV NODE_OPTIONS="--max-old-space-size=3072"
ENV NPM_CONFIG_LOGLEVEL=warn

ENTRYPOINT ["node", "/executor.js"]
