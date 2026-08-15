FROM node:26-alpine3.22 AS frontend

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY resources ./resources
COPY vite.config.js ./
COPY public ./public
RUN npm run build

FROM composer:2 AS composer

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --no-scripts
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-interaction

FROM php:8.4-fpm-alpine3.22

ARG GIT_HASH=""

LABEL org.opencontainers.image.title="Indexframe"
LABEL org.opencontainers.image.description="Private web interface for file-based visual asset libraries"
LABEL org.opencontainers.image.vendor="Indexframe contributors"

RUN apk add --no-cache ca-certificates ffmpeg nginx su-exec freetype libcurl libjpeg-turbo libpng libwebp libpq sqlite-libs \
    && apk add --no-cache --virtual .build-dependencies $PHPIZE_DEPS freetype-dev libjpeg-turbo-dev libpng-dev libwebp-dev postgresql-dev sqlite-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" gd pdo_mysql pdo_pgsql pdo_sqlite opcache \
    && apk del .build-dependencies

WORKDIR /var/www/html

COPY --from=composer /app /var/www/html
COPY --from=frontend /app/public/build /var/www/html/public/build
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/indexframe.ini
COPY docker/entrypoint.sh /usr/local/bin/indexframe-entrypoint

RUN mkdir -p storage/app/private/eagle-write-backups \
        storage/app/private/eagle-image-derivatives \
        storage/app/derivative-temp \
        storage/app/database \
        storage/app/uploads \
        storage/framework/cache \
        storage/framework/sessions \
        storage/framework/views \
        storage/logs \
        bootstrap/cache \
    && if [ -n "$GIT_HASH" ]; then echo "$GIT_HASH" > VERSION; fi \
    && chmod +x /usr/local/bin/indexframe-entrypoint \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/up || exit 1

ENTRYPOINT ["indexframe-entrypoint"]
CMD ["web"]
