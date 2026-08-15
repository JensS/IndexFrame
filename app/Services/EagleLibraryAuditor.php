<?php

namespace App\Services;

use League\Flysystem\FileAttributes;
use Throwable;

class EagleLibraryAuditor
{
    public function __construct(private EagleStorage $storage) {}

    /**
     * @return array{
     *     path: string,
     *     total_items: int,
     *     checked_items: int,
     *     errors: array<int, string>,
     *     warnings: array<int, string>,
     * }
     */
    public function audit(string $path, int $limit = 0): array
    {
        $errors = [];
        $warnings = [];
        $modificationIndex = [];

        try {
            $libraryMetadata = $this->storage->readJson("{$path}/metadata.json");

            if (! is_array($libraryMetadata['folders'] ?? null)) {
                $errors[] = 'metadata.json does not contain a folders array.';
            }

            if (! is_array($libraryMetadata['smartFolders'] ?? null)) {
                $warnings[] = 'metadata.json does not contain a smartFolders array.';
            }
        } catch (Throwable $exception) {
            $errors[] = 'metadata.json is missing or invalid: '.$exception->getMessage();
        }

        try {
            if ($this->storage->fileExists("{$path}/mtime.json")) {
                $modificationIndex = $this->storage->readJson("{$path}/mtime.json");
            } else {
                $warnings[] = 'mtime.json is missing; Eagle may need to rebuild its modification index.';
            }
        } catch (Throwable $exception) {
            $errors[] = 'mtime.json is invalid: '.$exception->getMessage();
        }

        try {
            $itemDirectories = collect($this->storage->list("{$path}/images"))
                ->filter(fn ($entry): bool => $entry->isDir() && str_ends_with($entry->path(), '.info'))
                ->values();
        } catch (Throwable $exception) {
            $errors[] = 'The images directory cannot be listed: '.$exception->getMessage();
            $itemDirectories = collect();
        }

        $totalItems = $itemDirectories->count();
        $directoriesToCheck = $limit > 0 ? $itemDirectories->take($limit) : $itemDirectories;

        foreach ($directoriesToCheck as $directory) {
            $itemPath = $directory->path();
            $directoryId = pathinfo(basename($itemPath), PATHINFO_FILENAME);

            if (! preg_match('/^[A-Z0-9]{13}$/', $directoryId)) {
                $warnings[] = "{$itemPath} does not use Eagle's 13-character item ID format.";
            }

            try {
                $metadata = $this->storage->readJson("{$itemPath}/metadata.json");
            } catch (Throwable $exception) {
                $errors[] = "{$itemPath}/metadata.json is missing or invalid: {$exception->getMessage()}";

                continue;
            }

            $metadataId = $metadata['id'] ?? null;

            if ($metadataId !== $directoryId) {
                $errors[] = "{$itemPath} contains metadata for a different item ID.";
            }

            if (! is_array($metadata['tags'] ?? null) || ! is_array($metadata['folders'] ?? null)) {
                $errors[] = "{$itemPath}/metadata.json has invalid tags or folders data.";
            }

            $extension = strtolower((string) ($metadata['ext'] ?? ''));
            $files = collect($this->storage->list($itemPath))
                ->filter(fn ($entry): bool => $entry instanceof FileAttributes)
                ->map(fn (FileAttributes $entry): string => basename($entry->path()));
            $originals = $files->reject(
                fn (string $file): bool => $file === 'metadata.json' || str_ends_with($file, '_thumbnail.png'),
            );

            if ($extension === '' || ! $originals->contains(
                fn (string $file): bool => strtolower(pathinfo($file, PATHINFO_EXTENSION)) === $extension,
            )) {
                $errors[] = "{$itemPath} has no original file matching its metadata extension.";
            }

            if ($modificationIndex !== [] && ! array_key_exists($directoryId, $modificationIndex)) {
                $warnings[] = "mtime.json has no entry for {$directoryId}.";
            }
        }

        if ($limit <= 0) {
            $knownIds = $itemDirectories
                ->map(fn ($directory): string => pathinfo(basename($directory->path()), PATHINFO_FILENAME))
                ->flip();

            foreach (array_keys($modificationIndex) as $indexedId) {
                if (! $knownIds->has((string) $indexedId)) {
                    $warnings[] = "mtime.json references missing item {$indexedId}.";
                }
            }
        }

        return [
            'path' => $path,
            'total_items' => $totalItems,
            'checked_items' => $directoriesToCheck->count(),
            'errors' => $errors,
            'warnings' => $warnings,
        ];
    }
}
