#!/bin/sh
set -eu

php_fpm_pid=''
nginx_pid=''
sync_pid=''
scheduler_pid=''

shutdown() {
    exit_code=$?
    trap - EXIT INT TERM

    for process_id in "$sync_pid" "$scheduler_pid" "$nginx_pid" "$php_fpm_pid"; do
        if [ -n "$process_id" ] && kill -0 "$process_id" 2>/dev/null; then
            kill -TERM "$process_id" 2>/dev/null || true
        fi
    done

    for process_id in "$sync_pid" "$scheduler_pid" "$nginx_pid" "$php_fpm_pid"; do
        if [ -n "$process_id" ]; then
            wait "$process_id" 2>/dev/null || true
        fi
    done

    exit "$exit_code"
}

trap shutdown EXIT INT TERM

mkdir -p /var/www/html/storage/app/uploads
mkdir -p /var/www/html/storage/app/private/eagle-write-backups
mkdir -p /var/www/html/storage/app/private/eagle-image-derivatives
mkdir -p /var/www/html/storage/app/derivative-temp
mkdir -p /var/www/html/storage/app/database
mkdir -p /var/www/html/storage/framework/cache
mkdir -p /var/www/html/storage/framework/sessions
mkdir -p /var/www/html/storage/framework/views
mkdir -p /var/www/html/storage/logs

if [ ! -f /var/www/html/storage/app/database/database.sqlite ]; then
    touch /var/www/html/storage/app/database/database.sqlite
fi

if [ -z "${EAGLE_WEBDAV_URL:-}" ] || [ -z "${EAGLE_WEBDAV_USERNAME:-}" ]; then
    echo 'EAGLE_WEBDAV_URL and EAGLE_WEBDAV_USERNAME are required.' >&2
    exit 1
fi

if { [ -z "${EAGLE_WEBDAV_PASSWORD_FILE:-}" ] || [ ! -s "$EAGLE_WEBDAV_PASSWORD_FILE" ]; } \
    && [ -z "${EAGLE_WEBDAV_PASSWORD:-}" ]; then
    echo 'An OpenCloud App Token is required through EAGLE_WEBDAV_PASSWORD_FILE or EAGLE_WEBDAV_PASSWORD.' >&2
    exit 1
fi

if [ -z "${APP_KEY:-}" ] || [ -z "${EAGLE_PASSWORD_HASH:-}" ]; then
    echo 'APP_KEY and EAGLE_PASSWORD_HASH are required.' >&2
    exit 1
fi

if [ "${APP_ENV:-production}" = 'production' ] && [ "${EAGLE_WEBDAV_VERIFY_TLS:-true}" != 'true' ]; then
    echo 'Refusing to start production with EAGLE_WEBDAV_VERIFY_TLS disabled.' >&2
    exit 1
fi

chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

su-exec www-data php artisan migrate --force --no-interaction
su-exec www-data php artisan config:cache
su-exec www-data php artisan view:cache

if [ "${1:-web}" != 'web' ]; then
    exec su-exec www-data "$@"
fi

php-fpm -F &
php_fpm_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

if [ "${EAGLE_SYNC_ON_START:-false}" = 'true' ]; then
    su-exec www-data php artisan eagle:sync --prune >> /var/www/html/storage/logs/eagle-sync.log 2>&1 &
    sync_pid=$!
fi

if [ "${EAGLE_SCHEDULER_ENABLED:-true}" = 'true' ]; then
    su-exec www-data php artisan schedule:work --no-interaction >> /var/www/html/storage/logs/scheduler.log 2>&1 &
    scheduler_pid=$!
fi

wait "$nginx_pid"
