<?php

namespace App\Services;

use App\Models\EagleAsset;
use App\Models\EagleFolder;
use App\Models\EagleLibrary;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use JsonException;
use League\Flysystem\FileAttributes;
use RuntimeException;

class EagleLibraryIndexer
{
    public function __construct(private EagleStorage $storage) {}

    /**
     * @param  callable(string): void|null  $report
     */
    public function syncPath(string $path, bool $prune = false, ?callable $report = null): EagleLibrary
    {
        $libraryMetadata = $this->storage->readJson("{$path}/metadata.json");
        $library = EagleLibrary::query()->where('path', $path)->first();

        if (! $library) {
            $library = new EagleLibrary([
                'slug' => $this->uniqueSlug(pathinfo($path, PATHINFO_FILENAME)),
                'path' => $path,
            ]);
        }

        $library->fill([
            'name' => pathinfo($path, PATHINFO_FILENAME),
            'application_version' => $libraryMetadata['applicationVersion'] ?? null,
            'modification_time' => $libraryMetadata['modificationTime'] ?? null,
        ])->save();

        $folderIds = DB::transaction(
            fn (): array => $this->syncFolders($library, $libraryMetadata),
            5,
        );

        $this->syncAssets($library, $path, $folderIds, $prune, $report);
        $library->forceFill(['indexed_at' => now()])->save();

        Cache::forget("eagle-library.{$library->id}.tags");

        return $library->refresh();
    }

    public function syncAsset(EagleLibrary $library, string $eagleId): EagleAsset
    {
        $itemDirectory = "{$library->path}/images/{$eagleId}.info";
        $record = $this->assetRecord($library, $itemDirectory);

        if (! $record) {
            throw new RuntimeException("Unable to index Eagle item {$eagleId}.");
        }

        $folderEagleIds = $record['folder_eagle_ids'];
        unset($record['folder_eagle_ids']);

        EagleAsset::query()->upsert(
            [$record],
            ['eagle_library_id', 'eagle_id'],
            array_keys(collect($record)->except(['eagle_library_id', 'eagle_id', 'created_at'])->all()),
        );

        $asset = $library->assets()->where('eagle_id', $eagleId)->firstOrFail();
        $folderIds = $library->folders()
            ->where('kind', 'folder')
            ->whereIn('eagle_id', $folderEagleIds)
            ->pluck('id');
        $asset->folders()->sync($folderIds);
        Cache::forget("eagle-library.{$library->id}.tags");

        return $asset->refresh()->load('folders');
    }

    /** @param array<string, mixed> $libraryMetadata */
    private function syncFolders(EagleLibrary $library, array $libraryMetadata): array
    {
        $seen = [];
        $position = 0;

        $walk = function (array $folders, ?int $parentId = null) use (&$walk, &$seen, &$position, $library): void {
            foreach ($folders as $folderData) {
                if (! isset($folderData['id'], $folderData['name'])) {
                    continue;
                }

                $folder = EagleFolder::query()->updateOrCreate(
                    [
                        'eagle_library_id' => $library->id,
                        'eagle_id' => $folderData['id'],
                    ],
                    [
                        'parent_id' => $parentId,
                        'name' => $folderData['name'],
                        'description' => $folderData['description'] ?? null,
                        'kind' => 'folder',
                        'conditions' => null,
                        'position' => $position++,
                    ],
                );

                $seen[] = $folder->eagle_id;
                $walk($folderData['children'] ?? [], $folder->id);
            }
        };

        $walk($libraryMetadata['folders'] ?? []);

        foreach ($libraryMetadata['smartFolders'] ?? [] as $smartFolderData) {
            if (! isset($smartFolderData['id'], $smartFolderData['name'])) {
                continue;
            }

            EagleFolder::query()->updateOrCreate(
                [
                    'eagle_library_id' => $library->id,
                    'eagle_id' => $smartFolderData['id'],
                ],
                [
                    'parent_id' => null,
                    'name' => $smartFolderData['name'],
                    'description' => $smartFolderData['description'] ?? null,
                    'kind' => 'smart',
                    'conditions' => $smartFolderData['conditions'] ?? [],
                    'position' => $position++,
                ],
            );

            $seen[] = $smartFolderData['id'];
        }

        $library->folders()->whereNotIn('eagle_id', $seen ?: [''])->delete();

        return $library->folders()->where('kind', 'folder')->pluck('id', 'eagle_id')->all();
    }

    /**
     * @param  array<string, int>  $folderIds
     * @param  callable(string): void|null  $report
     */
    private function syncAssets(
        EagleLibrary $library,
        string $path,
        array $folderIds,
        bool $prune,
        ?callable $report,
    ): void {
        $records = [];
        $assetFolderEagleIds = [];
        $seen = [];
        $refreshed = 0;
        $existingModificationTimes = $library->assets()
            ->pluck('modification_time', 'eagle_id')
            ->all();
        $remoteModificationTimes = [];

        if ($this->storage->fileExists("{$path}/mtime.json")) {
            try {
                $remoteModificationTimes = $this->storage->readJson("{$path}/mtime.json");
            } catch (JsonException $exception) {
                $report && $report("mtime.json could not be read; performing a full refresh: {$exception->getMessage()}");
            }
        }

        foreach ($this->storage->list("{$path}/images") as $directory) {
            if (! $directory->isDir() || ! str_ends_with(basename($directory->path()), '.info')) {
                continue;
            }

            $eagleId = Str::beforeLast(basename($directory->path()), '.info');
            $seen[] = $eagleId;

            if ($this->assetIsCurrent($eagleId, $existingModificationTimes, $remoteModificationTimes)) {
                continue;
            }

            try {
                $record = $this->assetRecord($library, $directory->path());
            } catch (JsonException $exception) {
                $report && $report("Skipped {$eagleId}: {$exception->getMessage()}");

                continue;
            }

            if (! $record) {
                $report && $report("Skipped {$eagleId}: original file or metadata is missing.");

                continue;
            }

            $assetFolderEagleIds[$eagleId] = $record['folder_eagle_ids'];
            unset($record['folder_eagle_ids']);
            $records[] = $record;
            $refreshed++;

            if (count($records) >= 500) {
                $this->upsertAssets($records);
                $records = [];
                $report && $report("Refreshed {$refreshed} changed assets…");
            }
        }

        $this->upsertAssets($records);

        if ($prune) {
            foreach (array_chunk(array_values(array_diff(array_keys($existingModificationTimes), $seen)), 500) as $missingIds) {
                $library->assets()->whereIn('eagle_id', $missingIds)->delete();
            }
        }

        $databaseAssetIds = $library->assets()
            ->whereIn('eagle_id', array_keys($assetFolderEagleIds))
            ->pluck('id', 'eagle_id');
        $pivots = [];

        if ($databaseAssetIds->isNotEmpty()) {
            DB::table('eagle_asset_folder')
                ->whereIn('eagle_asset_id', $databaseAssetIds->values())
                ->delete();
        }

        foreach ($assetFolderEagleIds as $assetEagleId => $assignedFolderEagleIds) {
            $assetId = $databaseAssetIds[$assetEagleId] ?? null;

            if (! $assetId) {
                continue;
            }

            foreach (array_unique($assignedFolderEagleIds) as $folderEagleId) {
                $folderId = $folderIds[$folderEagleId] ?? null;

                if ($folderId) {
                    $pivots[] = [
                        'eagle_asset_id' => $assetId,
                        'eagle_folder_id' => $folderId,
                    ];
                }
            }
        }

        foreach (array_chunk($pivots, 1000) as $pivotChunk) {
            DB::table('eagle_asset_folder')->insertOrIgnore($pivotChunk);
        }

        $scanned = count($seen);
        $report && $report("Scanned {$scanned} assets; refreshed {$refreshed}.");
    }

    /**
     * @param  array<string, int|string|null>  $existingModificationTimes
     * @param  array<string, int|string|null>  $remoteModificationTimes
     */
    private function assetIsCurrent(
        string $eagleId,
        array $existingModificationTimes,
        array $remoteModificationTimes,
    ): bool {
        $existingModificationTime = $existingModificationTimes[$eagleId] ?? null;
        $remoteModificationTime = $remoteModificationTimes[$eagleId] ?? null;

        if ($existingModificationTime === null || $remoteModificationTime === null) {
            return false;
        }

        return (int) $existingModificationTime === (int) $remoteModificationTime;
    }

    /** @param array<int, array<string, mixed>> $records */
    private function upsertAssets(array $records): void
    {
        if ($records === []) {
            return;
        }

        EagleAsset::query()->upsert(
            $records,
            ['eagle_library_id', 'eagle_id'],
            array_keys(collect($records[0])->except(['eagle_library_id', 'eagle_id', 'created_at'])->all()),
        );
    }

    /** @return array<string, mixed>|null */
    private function assetRecord(EagleLibrary $library, string $itemDirectory): ?array
    {
        $metadataPath = "{$itemDirectory}/metadata.json";

        if (! $this->storage->fileExists($metadataPath)) {
            return null;
        }

        $metadata = $this->storage->readJson($metadataPath);
        $eagleId = $metadata['id'] ?? Str::beforeLast(basename($itemDirectory), '.info');
        $fileNames = [];
        $thumbnailFileName = null;

        foreach ($this->storage->list($itemDirectory) as $file) {
            $fileName = basename($file->path());

            if (! $file instanceof FileAttributes || $fileName === 'metadata.json') {
                continue;
            }

            if (str_ends_with($fileName, '_thumbnail.png')) {
                $thumbnailFileName ??= $fileName;

                continue;
            }

            $fileNames[] = $fileName;
        }

        if ($fileNames === []) {
            return null;
        }

        $extension = strtolower((string) ($metadata['ext'] ?? pathinfo($fileNames[0], PATHINFO_EXTENSION)));
        $fileName = collect($fileNames)->first(
            fn (string $candidate): bool => strtolower(pathinfo($candidate, PATHINFO_EXTENSION)) === $extension,
            $fileNames[0],
        );
        $now = now();

        return [
            'eagle_library_id' => $library->id,
            'eagle_id' => $eagleId,
            'name' => $metadata['name'] ?? pathinfo($fileName, PATHINFO_FILENAME),
            'file_name' => $fileName,
            'thumbnail_file_name' => $thumbnailFileName,
            'extension' => $extension,
            'media_type' => $this->mediaType($extension),
            'mime_type' => $this->mimeType($extension),
            'size' => $metadata['size'] ?? $this->storage->fileSize("{$itemDirectory}/{$fileName}"),
            'width' => $metadata['width'] ?? $metadata['resolutionWidth'] ?? null,
            'height' => $metadata['height'] ?? $metadata['resolutionHeight'] ?? null,
            'duration' => $metadata['duration'] ?? null,
            'rating' => $metadata['rating'] ?? 0,
            'tags' => json_encode(array_values($metadata['tags'] ?? []), JSON_THROW_ON_ERROR),
            'palettes' => isset($metadata['palettes'])
                ? json_encode($metadata['palettes'], JSON_THROW_ON_ERROR)
                : null,
            'url' => $metadata['url'] ?? null,
            'annotation' => $metadata['annotation'] ?? null,
            'is_deleted' => (bool) ($metadata['isDeleted'] ?? false),
            'birth_time' => $metadata['btime'] ?? null,
            'file_modification_time' => $metadata['mtime'] ?? null,
            'modification_time' => $metadata['lastModified'] ?? $metadata['modificationTime'] ?? $metadata['mtime'] ?? null,
            'deleted_time' => $metadata['deletedTime'] ?? null,
            'created_at' => $now,
            'updated_at' => $now,
            'folder_eagle_ids' => array_values($metadata['folders'] ?? []),
        ];
    }

    private function mediaType(string $extension): string
    {
        if (in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'svg'], true)) {
            return 'image';
        }

        if (in_array($extension, ['mp4', 'webm', 'mkv', 'mov', 'm4v'], true)) {
            return 'video';
        }

        return 'other';
    }

    private function mimeType(string $extension): string
    {
        return match ($extension) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            'avif' => 'image/avif',
            'heic', 'heif' => 'image/heic',
            'svg' => 'image/svg+xml',
            'mp4', 'm4v' => 'video/mp4',
            'webm' => 'video/webm',
            'mov' => 'video/quicktime',
            'mkv' => 'video/x-matroska',
            default => 'application/octet-stream',
        };
    }

    private function uniqueSlug(string $name): string
    {
        $baseSlug = Str::slug($name) ?: 'library';
        $slug = $baseSlug;
        $suffix = 2;

        while (EagleLibrary::query()->where('slug', $slug)->exists()) {
            $slug = "{$baseSlug}-{$suffix}";
            $suffix++;
        }

        return $slug;
    }
}
