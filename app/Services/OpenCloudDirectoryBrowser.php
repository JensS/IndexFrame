<?php

namespace App\Services;

use InvalidArgumentException;
use League\Flysystem\FilesystemOperator;

class OpenCloudDirectoryBrowser
{
    public function __construct(
        private FilesystemOperator $filesystem,
        private string $configuredRoot = '',
    ) {}

    /**
     * @return array{
     *     configured_root: string,
     *     path: string,
     *     parent: ?string,
     *     library_count: int,
     *     directories: array<int, array{
     *         name: string,
     *         path: string,
     *         is_library: bool,
     *     }>,
     * }
     */
    public function browse(string $path): array
    {
        $filesystemPath = $this->normalize($path);
        $directories = collect($this->filesystem->listContents($filesystemPath, false))
            ->filter(fn ($entry): bool => $entry->isDir())
            ->map(function ($entry): array {
                $entryPath = $this->normalize($entry->path());

                return [
                    'name' => basename($entryPath),
                    'path' => $this->publicPath($entryPath),
                    'is_library' => $this->isLibrary($entryPath),
                ];
            })
            ->sortBy(fn (array $directory): string => mb_strtolower($directory['name']))
            ->values();

        return [
            'configured_root' => $this->publicPath($this->normalize($this->configuredRoot)),
            'path' => $this->publicPath($filesystemPath),
            'parent' => $this->parentPath($filesystemPath),
            'library_count' => $directories->where('is_library', true)->count(),
            'directories' => $directories->all(),
        ];
    }

    private function isLibrary(string $path): bool
    {
        if (! str_ends_with($path, '.library')) {
            return false;
        }

        return $this->filesystem->fileExists("{$path}/metadata.json")
            && $this->filesystem->directoryExists("{$path}/images");
    }

    private function normalize(string $path): string
    {
        if (str_contains($path, "\0") || str_contains($path, '\\')) {
            throw new InvalidArgumentException('The OpenCloud path is invalid.');
        }

        $segments = collect(explode('/', trim($path)))
            ->filter(fn (string $segment): bool => $segment !== '' && $segment !== '.');

        if ($segments->contains('..')) {
            throw new InvalidArgumentException('Parent path segments are not allowed.');
        }

        return $segments->implode('/');
    }

    private function publicPath(string $path): string
    {
        return $path === '' ? '/' : "/{$path}";
    }

    private function parentPath(string $path): ?string
    {
        if ($path === '') {
            return null;
        }

        $segments = explode('/', $path);
        array_pop($segments);

        return $this->publicPath(implode('/', $segments));
    }
}
