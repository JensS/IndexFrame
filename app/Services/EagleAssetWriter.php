<?php

namespace App\Services;

use App\Exceptions\EagleWriteConflictException;
use App\Exceptions\EagleWritesDisabledException;
use App\Models\EagleAsset;
use App\Models\EagleLibrary;
use Closure;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\Process\Process;
use Throwable;

class EagleAssetWriter
{
    public function __construct(private EagleStorage $storage) {}

    /** @param array<int, string> $folderEagleIds */
    public function create(EagleLibrary $library, UploadedFile $upload, array $folderEagleIds = []): string
    {
        $this->assertWritesEnabled();
        $libraryPath = $this->libraryPath($library);
        $imagesPath = "{$libraryPath}/images";
        $eagleId = $this->generateId($imagesPath);
        $itemDirectory = "{$imagesPath}/{$eagleId}.info";
        $stagingDirectory = "{$imagesPath}/.{$eagleId}.indexframe-uploading-".bin2hex(random_bytes(6));
        $temporaryDirectory = storage_path('app/uploads/'.bin2hex(random_bytes(8)));
        $originalFileName = $this->safeFileName($upload->getClientOriginalName());

        File::makeDirectory($temporaryDirectory, 0775, true);

        try {
            $movedFile = $upload->move($temporaryDirectory, $originalFileName);
            $extension = strtolower($movedFile->getExtension());
            $name = pathinfo($originalFileName, PATHINFO_FILENAME);
            $now = $this->timestamp();
            $metadata = [
                'id' => $eagleId,
                'name' => $name,
                'size' => $movedFile->getSize(),
                'btime' => $now,
                'mtime' => $now,
                'ext' => $extension,
                'tags' => [],
                'folders' => array_values($folderEagleIds),
                'isDeleted' => false,
                'url' => '',
                'annotation' => '',
                'modificationTime' => $now,
                'lastModified' => $now,
                'palettes' => [],
            ];

            $metadata = array_merge($metadata, $this->mediaMetadata($movedFile->getPathname(), $extension));
            $thumbnailName = "{$name}_thumbnail.png";

            if ($this->generateThumbnail($movedFile->getPathname(), "{$temporaryDirectory}/{$thumbnailName}", $extension)) {
                $metadata['noThumbnail'] = false;
            } else {
                $metadata['noThumbnail'] = true;
            }

            $this->storage->createDirectory($stagingDirectory);

            foreach (File::files($temporaryDirectory) as $file) {
                $this->uploadLocalFile($file->getPathname(), "{$stagingDirectory}/{$file->getFilename()}");
            }

            $this->storage->writeJsonSafely("{$stagingDirectory}/metadata.json", $metadata, createOnly: true);
            $this->validateStagedItem($stagingDirectory, $eagleId, $extension);
            $this->storage->moveSafely($stagingDirectory, $itemDirectory);
            $this->updateModificationIndexWithoutFailingTheAsset($libraryPath, $eagleId, $now);
        } catch (Throwable $exception) {
            if ($this->storage->directoryExists($stagingDirectory)) {
                $this->storage->deleteDirectory($stagingDirectory);
            }

            throw $exception;
        } finally {
            File::deleteDirectory($temporaryDirectory);
        }

        return $eagleId;
    }

    /** @param array<string, mixed> $attributes */
    public function update(EagleAsset $asset, array $attributes): void
    {
        $this->assertWritesEnabled();
        $asset->loadMissing('library');
        $libraryPath = $this->libraryPath($asset->library);
        $metadataPath = "{$libraryPath}/images/{$asset->eagle_id}.info/metadata.json";

        $this->withLibraryLock($libraryPath, function () use ($asset, $attributes, $metadataPath, $libraryPath): void {
            $document = $this->storage->readJsonDocument($metadataPath);
            $metadata = $document->data;

            if (($metadata['id'] ?? null) !== $asset->eagle_id) {
                throw new RuntimeException('The Eagle item metadata ID does not match its directory. Run eagle:audit before writing.');
            }

            $this->backupMetadata($libraryPath, $asset->eagle_id, $metadata);
            $fieldMap = [
                'name' => 'name',
                'annotation' => 'annotation',
                'url' => 'url',
                'rating' => 'rating',
                'tags' => 'tags',
                'folder_ids' => 'folders',
            ];

            foreach ($fieldMap as $requestField => $metadataField) {
                if (array_key_exists($requestField, $attributes)) {
                    $metadata[$metadataField] = $attributes[$requestField];
                }
            }

            if (array_key_exists('is_deleted', $attributes)) {
                $metadata['isDeleted'] = (bool) $attributes['is_deleted'];

                if ($metadata['isDeleted']) {
                    $metadata['deletedTime'] = $this->timestamp();
                } else {
                    unset($metadata['deletedTime']);
                }
            }

            $now = $this->timestamp();
            $metadata['modificationTime'] = $now;
            $metadata['lastModified'] = $now;
            $this->storage->writeJsonSafely($metadataPath, $metadata, $document->version);
            $this->updateModificationIndexWithoutFailingTheAsset(
                $libraryPath,
                $asset->eagle_id,
                $now,
                alreadyLocked: true,
            );
        });
    }

    private function libraryPath(EagleLibrary $library): string
    {
        $path = trim($library->path, '/');

        if ($path === ''
            || ! $this->storage->fileExists("{$path}/metadata.json")
            || ! $this->storage->directoryExists("{$path}/images")) {
            throw new RuntimeException('The Eagle library is unavailable in OpenCloud.');
        }

        return $path;
    }

    private function generateId(string $imagesPath): string
    {
        $alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        do {
            $id = '';

            for ($position = 0; $position < 13; $position++) {
                $id .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while ($this->storage->directoryExists("{$imagesPath}/{$id}.info"));

        return $id;
    }

    private function safeFileName(string $fileName): string
    {
        $baseName = str_replace(['/', '\\', "\0", "\r", "\n"], '-', basename($fileName));
        $baseName = trim(preg_replace('/[[:cntrl:]]/u', '', $baseName) ?: 'upload');
        $extension = strtolower(pathinfo($baseName, PATHINFO_EXTENSION));
        $name = pathinfo($baseName, PATHINFO_FILENAME);
        $name = Str::limit($name, 170, '');

        return $extension === '' ? $name : "{$name}.{$extension}";
    }

    /** @return array<string, int|float> */
    private function mediaMetadata(string $path, string $extension): array
    {
        if ($this->isImage($extension)) {
            $dimensions = @getimagesize($path);

            if (is_array($dimensions)) {
                return [
                    'width' => $dimensions[0],
                    'height' => $dimensions[1],
                ];
            }
        }

        if (! $this->isVideo($extension)) {
            return [];
        }

        $ffprobe = config('eagle.ffprobe_path');

        if (! is_string($ffprobe) || ! is_executable($ffprobe)) {
            return [];
        }

        try {
            $process = new Process([
                $ffprobe,
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                $path,
            ]);
            $process->setTimeout(30)->mustRun();
            $probe = json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            $videoStream = collect($probe['streams'] ?? [])->firstWhere('codec_type', 'video');

            return array_filter([
                'width' => $videoStream['width'] ?? null,
                'height' => $videoStream['height'] ?? null,
                'duration' => isset($probe['format']['duration']) ? (float) $probe['format']['duration'] : null,
                'resolutionWidth' => $videoStream['width'] ?? null,
                'resolutionHeight' => $videoStream['height'] ?? null,
            ], fn (mixed $value): bool => $value !== null);
        } catch (Throwable) {
            return [];
        }
    }

    private function generateThumbnail(string $source, string $destination, string $extension): bool
    {
        if ($this->isVideo($extension)) {
            return $this->generateVideoThumbnail($source, $destination);
        }

        if (! $this->isImage($extension) || filesize($source) > 50 * 1024 * 1024) {
            return false;
        }

        $contents = file_get_contents($source);
        $image = is_string($contents) ? @imagecreatefromstring($contents) : false;

        if (! $image) {
            return false;
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $scale = min(1, 600 / max($width, $height));
        $thumbnailWidth = max(1, (int) round($width * $scale));
        $thumbnailHeight = max(1, (int) round($height * $scale));
        $thumbnail = imagecreatetruecolor($thumbnailWidth, $thumbnailHeight);
        imagealphablending($thumbnail, false);
        imagesavealpha($thumbnail, true);
        imagecopyresampled($thumbnail, $image, 0, 0, 0, 0, $thumbnailWidth, $thumbnailHeight, $width, $height);
        $created = imagepng($thumbnail, $destination, 7);
        imagedestroy($thumbnail);
        imagedestroy($image);

        return $created;
    }

    private function generateVideoThumbnail(string $source, string $destination): bool
    {
        $ffmpeg = config('eagle.ffmpeg_path');

        if (! is_string($ffmpeg) || ! is_executable($ffmpeg)) {
            return false;
        }

        try {
            $process = new Process([
                $ffmpeg,
                '-y',
                '-ss', '00:00:01',
                '-i', $source,
                '-frames:v', '1',
                '-vf', 'scale=600:-2',
                $destination,
            ]);
            $process->setTimeout(60)->mustRun();

            return is_file($destination);
        } catch (Throwable) {
            return false;
        }
    }

    private function isImage(string $extension): bool
    {
        return in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'], true);
    }

    private function isVideo(string $extension): bool
    {
        return in_array($extension, ['mp4', 'webm', 'mkv', 'mov', 'm4v'], true);
    }

    private function withLibraryLock(string $libraryPath, Closure $callback): mixed
    {
        $libraryHash = hash('sha256', $libraryPath);

        try {
            return Cache::lock("eagle-library-write:{$libraryHash}", 120)->block(15, $callback);
        } catch (LockTimeoutException $exception) {
            throw new RuntimeException('Another library write is still in progress. Try again shortly.', previous: $exception);
        }
    }

    private function updateModificationIndex(string $libraryPath, string $eagleId, int $timestamp): void
    {
        $path = "{$libraryPath}/mtime.json";

        for ($attempt = 1; $attempt <= 5; $attempt++) {
            try {
                if ($this->storage->fileExists($path)) {
                    $document = $this->storage->readJsonDocument($path);
                    $index = $document->data;
                    $expectedVersion = $document->version;
                    $createOnly = false;
                } else {
                    $index = [];
                    $expectedVersion = null;
                    $createOnly = true;
                }

                $index[$eagleId] = max((int) ($index[$eagleId] ?? 0), $timestamp);
                $this->storage->writeJsonSafely($path, $index, $expectedVersion, $createOnly);

                return;
            } catch (EagleWriteConflictException $exception) {
                if ($attempt === 5) {
                    throw $exception;
                }
            }
        }
    }

    private function updateModificationIndexWithoutFailingTheAsset(
        string $libraryPath,
        string $eagleId,
        int $timestamp,
        bool $alreadyLocked = false,
    ): void {
        try {
            if ($alreadyLocked) {
                $this->updateModificationIndex($libraryPath, $eagleId, $timestamp);
            } else {
                $this->withLibraryLock(
                    $libraryPath,
                    fn () => $this->updateModificationIndex($libraryPath, $eagleId, $timestamp),
                );
            }
        } catch (Throwable $exception) {
            Log::warning('An Eagle asset was saved, but mtime.json could not be updated.', [
                'library' => $libraryPath,
                'asset' => $eagleId,
                'exception' => $exception,
            ]);
        }
    }

    /** @param array<string, mixed> $metadata */
    private function backupMetadata(string $libraryPath, string $eagleId, array $metadata): void
    {
        if (! config('eagle.write_backups.enabled')) {
            return;
        }

        $backupRoot = rtrim((string) config('eagle.write_backups.path'), '/');

        if ($backupRoot === '') {
            throw new RuntimeException('EAGLE_WRITE_BACKUPS_PATH must be configured while write backups are enabled.');
        }

        $directory = $backupRoot.'/'.hash('sha256', $libraryPath)."/{$eagleId}";
        File::ensureDirectoryExists($directory, 0700, true);
        $path = $directory.'/'.now()->format('Ymd-His-u').'.json';
        $json = json_encode(
            $metadata,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        )."\n";

        if (File::put($path, $json, true) === false) {
            throw new RuntimeException('The pre-write metadata backup could not be created; the asset was not changed.');
        }

        chmod($path, 0600);
        $keep = max(1, (int) config('eagle.write_backups.keep_per_asset'));
        $backups = collect(File::files($directory))->sortByDesc(fn ($file) => $file->getFilename())->values();

        $backups->slice($keep)->each(fn ($file) => File::delete($file->getPathname()));
    }

    private function validateStagedItem(string $directory, string $eagleId, string $extension): void
    {
        $metadata = $this->storage->readJson("{$directory}/metadata.json");

        if (($metadata['id'] ?? null) !== $eagleId || ($metadata['ext'] ?? null) !== $extension) {
            throw new RuntimeException('The staged Eagle metadata failed validation.');
        }

        $hasOriginal = collect($this->storage->list($directory))->contains(
            fn ($entry): bool => $entry->isFile()
                && basename($entry->path()) !== 'metadata.json'
                && ! str_ends_with(basename($entry->path()), '_thumbnail.png')
                && strtolower(pathinfo($entry->path(), PATHINFO_EXTENSION)) === $extension,
        );

        if (! $hasOriginal) {
            throw new RuntimeException('The staged Eagle item does not contain its original asset.');
        }
    }

    private function assertWritesEnabled(): void
    {
        if (! config('eagle.writes_enabled')) {
            throw new EagleWritesDisabledException;
        }
    }

    private function uploadLocalFile(string $source, string $destination): void
    {
        $stream = fopen($source, 'rb');

        if (! is_resource($stream)) {
            throw new RuntimeException("Unable to read uploaded file {$source}.");
        }

        try {
            $this->storage->writeStream($destination, $stream);
        } finally {
            fclose($stream);
        }
    }

    private function timestamp(): int
    {
        return (int) round(microtime(true) * 1000);
    }
}
