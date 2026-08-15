<?php

namespace App\Services;

use App\Models\EagleAsset;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Symfony\Component\Process\Process;
use Throwable;

class EagleImageDerivative
{
    public function __construct(
        private EagleAssetLocator $locator,
        private EagleStorage $storage,
    ) {}

    public function make(EagleAsset $asset, int $width): string
    {
        $this->assertSupportedWidth($width);

        try {
            $sourcePath = $this->sourcePath($asset, $width);
        } catch (RuntimeException $exception) {
            return $this->existingSmallerDerivative($asset, $width) ?? throw $exception;
        }

        $cachePath = $this->cachePath($asset, $sourcePath, $width);

        if (is_file($cachePath)) {
            return $cachePath;
        }

        try {
            return Cache::lock('eagle-image-derivative:'.hash('sha256', $cachePath), 180)
                ->block(30, function () use ($cachePath, $sourcePath, $width): string {
                    if (is_file($cachePath)) {
                        return $cachePath;
                    }

                    $this->generate($sourcePath, $cachePath, $width);

                    return $cachePath;
                });
        } catch (LockTimeoutException $exception) {
            throw new RuntimeException('The optimized image is still being prepared. Try again shortly.', previous: $exception);
        } catch (RuntimeException $exception) {
            return $this->existingSmallerDerivative($asset, $width) ?? throw $exception;
        }
    }

    private function existingSmallerDerivative(EagleAsset $asset, int $width): ?string
    {
        $asset->loadMissing('library');
        $assetDirectory = rtrim((string) config('eagle.derivatives.path'), '/').
            "/{$asset->library->id}/{$asset->eagle_id}";
        $smallerWidths = collect(config('eagle.derivatives.widths'))
            ->filter(fn (int $candidate): bool => $candidate < $width)
            ->sortDesc();

        foreach ($smallerWidths as $smallerWidth) {
            $directory = "{$assetDirectory}/{$smallerWidth}";

            if (! File::isDirectory($directory)) {
                continue;
            }

            $candidate = collect(File::files($directory))
                ->sortByDesc(fn ($file): int => $file->getMTime())
                ->first();

            if ($candidate) {
                return $candidate->getPathname();
            }
        }

        return null;
    }

    private function assertSupportedWidth(int $width): void
    {
        if (! in_array($width, config('eagle.derivatives.widths'), true)) {
            throw new RuntimeException('The requested optimized image size is not supported.');
        }
    }

    private function sourcePath(EagleAsset $asset, int $width): string
    {
        $previewMaximum = (int) config('eagle.derivatives.preview_source_maximum_width');

        if ($width <= $previewMaximum || $asset->media_type !== 'image') {
            return $this->locator->preview($asset);
        }

        try {
            return $this->locator->original($asset);
        } catch (RuntimeException) {
            return $this->locator->preview($asset);
        }
    }

    private function cachePath(EagleAsset $asset, string $sourcePath, int $width): string
    {
        $asset->loadMissing('library');
        $version = $asset->file_modification_time ?? $asset->modification_time ?? 0;
        $key = hash('sha256', implode('|', [
            $asset->library->path,
            $asset->eagle_id,
            $sourcePath,
            (string) $version,
            (string) $width,
            (string) config('eagle.derivatives.webp_quality'),
        ]));

        return rtrim((string) config('eagle.derivatives.path'), '/').
            "/{$asset->library->id}/{$asset->eagle_id}/{$width}/{$key}.webp";
    }

    private function generate(string $sourcePath, string $cachePath, int $width): void
    {
        $temporaryDirectory = rtrim((string) config('eagle.derivatives.temporary_path'), '/');
        File::ensureDirectoryExists($temporaryDirectory, 0700, true);
        File::ensureDirectoryExists(dirname($cachePath), 0700, true);
        $temporarySource = "{$temporaryDirectory}/".bin2hex(random_bytes(12)).'.source';
        $temporaryOutput = "{$temporaryDirectory}/".bin2hex(random_bytes(12)).'.webp';

        try {
            $this->copySourceLocally($sourcePath, $temporarySource);

            if (! $this->generateWithFfmpeg($temporarySource, $temporaryOutput, $width)) {
                $this->generateWithGd($temporarySource, $temporaryOutput, $width);
            }

            $image = @getimagesize($temporaryOutput);

            if (! is_array($image) || ($image['mime'] ?? null) !== 'image/webp' || $image[0] > $width) {
                throw new RuntimeException('The optimized image failed validation.');
            }

            if (! File::move($temporaryOutput, $cachePath)) {
                throw new RuntimeException('The optimized image could not be published.');
            }

            chmod($cachePath, 0640);
            collect(File::files(dirname($cachePath)))
                ->reject(fn ($file): bool => $file->getPathname() === $cachePath)
                ->each(fn ($file) => File::delete($file->getPathname()));
        } finally {
            File::delete([$temporarySource, $temporaryOutput]);
        }
    }

    private function copySourceLocally(string $sourcePath, string $temporarySource): void
    {
        $source = $this->storage->readStream($sourcePath);
        $destination = fopen($temporarySource, 'wb');

        if (! is_resource($destination)) {
            fclose($source);

            throw new RuntimeException('A temporary optimized-image file could not be created.');
        }

        try {
            if (stream_copy_to_stream($source, $destination) === false) {
                throw new RuntimeException('The source image could not be downloaded from OpenCloud.');
            }
        } finally {
            fclose($source);
            fclose($destination);
        }
    }

    private function generateWithFfmpeg(string $source, string $destination, int $width): bool
    {
        $ffmpeg = config('eagle.ffmpeg_path');

        if (! is_string($ffmpeg) || ! is_executable($ffmpeg)) {
            return false;
        }

        try {
            $process = new Process([
                $ffmpeg,
                '-v', 'error',
                '-y',
                '-i', $source,
                '-frames:v', '1',
                '-vf', "scale='min({$width},iw)':-2:flags=lanczos",
                '-c:v', 'libwebp',
                '-quality', (string) config('eagle.derivatives.webp_quality'),
                '-compression_level', '5',
                $destination,
            ]);
            $process->setTimeout((int) config('eagle.derivatives.timeout'))->mustRun();

            return is_file($destination) && filesize($destination) > 0;
        } catch (Throwable) {
            File::delete($destination);

            return false;
        }
    }

    private function generateWithGd(string $sourcePath, string $destination, int $width): void
    {
        $details = @getimagesize($sourcePath);

        if (! is_array($details)) {
            throw new RuntimeException('This asset cannot be converted into an optimized browser image.');
        }

        $pixels = $details[0] * $details[1];

        if ($pixels > (int) config('eagle.derivatives.gd_maximum_pixels')) {
            throw new RuntimeException('This image is too large for the configured derivative processor.');
        }

        $contents = file_get_contents($sourcePath);
        $source = is_string($contents) ? @imagecreatefromstring($contents) : false;

        if (! $source) {
            throw new RuntimeException('This image format cannot be optimized by the server.');
        }

        try {
            $scale = min(1, $width / imagesx($source));
            $targetWidth = max(1, (int) round(imagesx($source) * $scale));
            $targetHeight = max(1, (int) round(imagesy($source) * $scale));
            $target = imagecreatetruecolor($targetWidth, $targetHeight);
            imagealphablending($target, false);
            imagesavealpha($target, true);
            imagecopyresampled(
                $target,
                $source,
                0,
                0,
                0,
                0,
                $targetWidth,
                $targetHeight,
                imagesx($source),
                imagesy($source),
            );

            try {
                if (! imagewebp($target, $destination, (int) config('eagle.derivatives.webp_quality'))) {
                    throw new RuntimeException('The optimized WebP image could not be encoded.');
                }
            } finally {
                imagedestroy($target);
            }
        } finally {
            imagedestroy($source);
        }
    }
}
