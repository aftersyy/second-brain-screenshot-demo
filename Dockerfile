FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY src ./src
COPY demo ./demo
COPY docs ./docs
COPY scripts ./scripts
COPY knowledge-base ./knowledge-base
COPY cards ./cards
COPY USER.md ./USER.md
COPY SOUL.md ./SOUL.md

ENV PORT=3017

EXPOSE 3017

CMD ["npm", "run", "start"]
