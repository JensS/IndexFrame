<?php

namespace App\Services;

class OpenCloudPathMapper
{
    private string $basePath;

    public function __construct(string $webDavUrl)
    {
        $this->basePath = trim(rawurldecode((string) parse_url($webDavUrl, PHP_URL_PATH)), '/');
    }

    public function relative(string $path, string $root = ''): string
    {
        $path = trim($path, '/');
        $root = trim($root, '/');

        if ($this->basePath !== '') {
            if ($path === $this->basePath) {
                $path = '';
            } elseif (str_starts_with($path, "{$this->basePath}/")) {
                $path = substr($path, strlen($this->basePath) + 1);
            }
        }

        if ($root === '') {
            return $path;
        }

        if ($path === $root) {
            return '';
        }

        if (str_starts_with($path, "{$root}/")) {
            return substr($path, strlen($root) + 1);
        }

        $absolutePath = "/{$path}";
        $rootMarker = "/{$root}/";
        $rootPosition = strrpos($absolutePath, $rootMarker);

        if ($rootPosition !== false) {
            return trim(substr($absolutePath, $rootPosition + strlen($rootMarker)), '/');
        }

        return str_ends_with($absolutePath, "/{$root}") ? '' : $path;
    }
}
