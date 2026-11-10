ARG PARENT_VERSION=3.2.4-node22.23.4
ARG PORT=3000
ARG PORT_DEBUG=9229

FROM defradigital/node-development:${PARENT_VERSION} AS development
ARG PARENT_VERSION
LABEL uk.gov.defra.ffc.parent-image=defradigital/node-development:${PARENT_VERSION}

ARG PORT
ARG PORT_DEBUG
ENV PORT=${PORT}
EXPOSE ${PORT} ${PORT_DEBUG}

COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node ./src ./src
# migrations/ and migrate-mongo-config.js live at the repo root (not under src/) but are
# needed at boot - mongodb.js imports the config and migrate-mongo runs the migration files.
COPY --chown=node:node ./migrations ./migrations
COPY --chown=node:node ./migrate-mongo-config.js ./migrate-mongo-config.js

CMD [ "npm", "run", "docker:dev" ]

FROM defradigital/node:${PARENT_VERSION} AS production
ARG PARENT_VERSION
LABEL uk.gov.defra.ffc.parent-image=defradigital/node:${PARENT_VERSION}

# Add curl to template.
# CDP PLATFORM HEALTHCHECK REQUIREMENT
USER root
RUN apk add --no-cache curl dumb-init
USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

COPY --from=development /home/node/package*.json ./
COPY --from=development /home/node/src ./src/
COPY --from=development /home/node/migrations ./migrations/
COPY --from=development /home/node/migrate-mongo-config.js ./migrate-mongo-config.js

RUN npm ci --omit=dev

ARG PORT
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD [ "node", "src" ]
