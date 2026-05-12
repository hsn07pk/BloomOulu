# BloomOulu - local serving via nginx.
#
# Build:  docker compose build
# Run:    docker compose up -d
# View:   http://localhost:8080/  (auto-redirects to /demo-design/)

FROM nginx:1.27-alpine

# Drop the default config and install our own
RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/mime.types /etc/nginx/mime.types

# Copy the site
COPY index.html        /usr/share/nginx/html/index.html
COPY vercel.json       /usr/share/nginx/html/vercel.json
COPY demo-design/      /usr/share/nginx/html/demo-design/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/demo-design/ || exit 1
