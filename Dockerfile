FROM oven/bun:1.1.30

WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y python3 make g++ bash
COPY package*.json ./
COPY bun.lockb ./
RUN bun install

COPY . .

COPY wallets /app/wallets


CMD ["bun", "run", "src/index.ts"]
