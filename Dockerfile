# Runtime image for Render services configured with the Docker environment.
# Render supplies PORT at runtime; server.js reads process.env.PORT.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install only production dependencies for a smaller image.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Includes server.js and public/index.html.
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
