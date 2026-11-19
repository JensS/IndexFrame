#!/bin/sh
set -eu
apt-get update
apt-get install -y --no-install-recommends libfreetype6-dev libjpeg62-turbo-dev libpng-dev libwebp-dev libzip-dev libicu-dev libxml2-dev libonig-dev libsqlite3-dev unzip
docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp
docker-php-ext-install -j2 gd pdo_mysql pdo_sqlite mbstring intl zip soap
if php -r 'exit(PHP_VERSION_ID < 80500 ? 0 : 1);'; then
    docker-php-ext-install -j2 opcache
fi
rm -rf /var/lib/apt/lists/*
