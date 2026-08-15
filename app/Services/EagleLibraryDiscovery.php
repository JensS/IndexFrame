<?php

namespace App\Services;

class EagleLibraryDiscovery
{
    public function __construct(private EagleStorage $storage) {}

    /** @return array<int, string> */
    public function discover(): array
    {
        return collect($this->storage->list(''))
            ->filter(fn ($entry): bool => $entry->isDir())
            ->map(fn ($entry): string => $entry->path())
            ->filter(fn (string $path): bool => $this->isLibrary($path))
            ->values()
            ->all();
    }

    private function isLibrary(string $path): bool
    {
        return str_ends_with($path, '.library')
            && $this->storage->fileExists("{$path}/metadata.json")
            && $this->storage->directoryExists("{$path}/images");
    }
}
