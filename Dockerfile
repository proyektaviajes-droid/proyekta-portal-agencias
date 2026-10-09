FROM tailscale/tailscale:v1.102.5@sha256:c507f3a2a6ab1cabd8d809b98edeb41edbd5c3fb6ad9632ffd098b4c7d0b4065 AS private-network
FROM node:20-alpine

COPY --from=private-network /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=private-network /usr/local/bin/tailscaled /usr/local/bin/tailscaled

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY assets ./assets
COPY src ./src
COPY public ./public
COPY db ./db
COPY scripts ./scripts
COPY private-network.mjs ./private-network.mjs
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=4177

EXPOSE 4177
CMD ["node", "private-network.mjs"]

