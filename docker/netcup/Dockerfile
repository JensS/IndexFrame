FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY resources resources
COPY public public
COPY vite.config.js ./
RUN npm run build

FROM php:8.4-cli-bookworm AS cli-base
COPY docker/netcup/install-extensions.sh /tmp/install-extensions.sh
RUN sh /tmp/install-extensions.sh
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

FROM cli-base AS dependencies
WORKDIR /build
COPY composer.json composer.lock ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --no-scripts
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-scripts
COPY --from=frontend /build/public/build public/build
RUN rm -f bootstrap/cache/*.php public/hot \
    && mkdir -p storage/app/private storage/app/uploads storage/app/derivative-temp \
        storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs

FROM php:8.5-apache-bookworm AS web
COPY docker/netcup/install-extensions.sh /tmp/install-extensions.sh
RUN sh /tmp/install-extensions.sh && a2enmod rewrite headers
WORKDIR /webspace/project
COPY --from=dependencies --chown=www-data:www-data /build ./
COPY docker/netcup/apache.conf /etc/apache2/sites-available/000-default.conf
COPY docker/netcup/php.ini /usr/local/etc/php/conf.d/netcup.ini
# Deliberately no FFmpeg, Node, Redis, cron daemon, or public storage symlink.
RUN echo 'open_basedir=/webspace:/tmp:/usr/local/lib/php' > /usr/local/etc/php/conf.d/open-basedir.ini

FROM cli-base AS cli
WORKDIR /project
COPY --from=dependencies --chown=www-data:www-data /build ./
COPY docker/netcup/php.ini /usr/local/etc/php/conf.d/netcup.ini
RUN mkdir -p /mybin/php-ini /usr/local/php84/bin \
    && ln -s /usr/local/bin/php /usr/local/php84/bin/php \
    && cp /usr/local/etc/php/php.ini-production /mybin/php-ini/php.ini \
    && echo 'open_basedir=/project:/mybin:/tmp:/usr/local/lib/php' > /usr/local/etc/php/conf.d/open-basedir.ini
USER www-data
ENV PHPRC=/mybin/php-ini
ENTRYPOINT ["/usr/local/php84/bin/php"]
CMD ["artisan", "schedule:run"]

FROM cli-base AS test
WORKDIR /project
COPY . .
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && touch .env \
    && composer install --prefer-dist --no-interaction --no-progress
COPY --from=frontend /build/public/build public/build
COPY docker/netcup/php.ini /usr/local/etc/php/conf.d/netcup.ini
CMD ["php", "artisan", "test"]
