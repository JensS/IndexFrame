<?php

return [
    'webdav' => [
        'url' => env('EAGLE_WEBDAV_URL'),
        'username' => env('EAGLE_WEBDAV_USERNAME'),
        'password' => env('EAGLE_WEBDAV_PASSWORD'),
        'password_file' => env('EAGLE_WEBDAV_PASSWORD_FILE'),
        'root' => env('EAGLE_WEBDAV_ROOT', '/'),
        'verify_tls' => filter_var(env('EAGLE_WEBDAV_VERIFY_TLS', true), FILTER_VALIDATE_BOOL),
    ],

    'testing_root' => env('EAGLE_TESTING_ROOT', base_path()),

    'password_hash' => env('EAGLE_PASSWORD_HASH'),

    'writes_enabled' => filter_var(env('EAGLE_WRITES_ENABLED', false), FILTER_VALIDATE_BOOL),

    'write_backups' => [
        'enabled' => filter_var(env('EAGLE_WRITE_BACKUPS_ENABLED', true), FILTER_VALIDATE_BOOL),
        'keep_per_asset' => (int) env('EAGLE_WRITE_BACKUPS_KEEP_PER_ASSET', 25),
        'path' => env('EAGLE_WRITE_BACKUPS_PATH', storage_path('app/private/eagle-write-backups')),
    ],

    'upload_max_kilobytes' => (int) env('EAGLE_UPLOAD_MAX_KILOBYTES', 512000),

    'ffmpeg_path' => env('EAGLE_FFMPEG_PATH', '/usr/bin/ffmpeg'),
    'ffprobe_path' => env('EAGLE_FFPROBE_PATH', '/usr/bin/ffprobe'),

    'derivatives' => [
        'path' => env('EAGLE_DERIVATIVE_PATH', storage_path('app/private/eagle-image-derivatives')),
        'temporary_path' => env('EAGLE_DERIVATIVE_TEMPORARY_PATH', storage_path('app/derivative-temp')),
        'widths' => [640, 960, 1600],
        'preview_source_maximum_width' => 640,
        'webp_quality' => (int) env('EAGLE_DERIVATIVE_WEBP_QUALITY', 78),
        'timeout' => (int) env('EAGLE_DERIVATIVE_TIMEOUT', 90),
        'gd_maximum_pixels' => (int) env('EAGLE_DERIVATIVE_GD_MAXIMUM_PIXELS', 80000000),
    ],
];
