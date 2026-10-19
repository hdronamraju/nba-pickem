FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
