FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY db ./db
COPY scripts ./scripts
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=4177

EXPOSE 4177
CMD ["node", "src/server.mjs"]
