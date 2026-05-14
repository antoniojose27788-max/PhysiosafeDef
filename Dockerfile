FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

RUN addgroup -S physiosafe && adduser -S physiosafe -G physiosafe

COPY package.json ./

RUN npm install --omit=dev

COPY . .

RUN chown -R physiosafe:physiosafe /usr/src/app

USER physiosafe

EXPOSE 3000

CMD ["node", "server.js"]
