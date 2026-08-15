# Pinned Node build so every builder path (CLI and dashboard) produces the same runtime.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080
CMD ["npm", "start"]
