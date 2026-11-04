FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir /app/.cache && chown node:node /app/.cache
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
VOLUME ["/app/.cache"]
CMD ["npm", "start"]
