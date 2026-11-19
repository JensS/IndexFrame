<?php

namespace App\Services;

class EagleImageMemory
{
    public static function canDecode(string $path): bool
    {
        $details = @getimagesize($path);

        if (! is_array($details)) {
            return false;
        }

        $pixels = $details[0] * $details[1];

        if ($pixels > (int) config('eagle.derivatives.gd_maximum_pixels')) {
            return false;
        }

        $limit = ini_parse_quantity((string) ini_get('memory_limit'));
        $estimatedBytes = $pixels * 8 + filesize($path) + 32 * 1024 * 1024;

        return $limit < 0 || memory_get_usage(true) + $estimatedBytes < $limit;
    }
}
