<?php

namespace App\Services;

use App\Models\EagleAsset;
use League\Flysystem\FileAttributes;
use RuntimeException;

class EagleAssetLocator
{
    public function __construct(private EagleStorage $storage) {}

    public function original(EagleAsset $asset): string
    {
        return $this->resolveOrRefresh($asset, 'file_name');
    }

    public function preview(EagleAsset $asset): string
    {
        if (filled($asset->thumbnail_file_name)) {
            try {
                return $this->resolveOrRefresh($asset, 'thumbnail_file_name');
            } catch (RuntimeException) {
                return $this->original($asset);
            }
        }

        return $this->original($asset);
    }

    public function metadata(EagleAsset $asset): string
    {
        return $this->resolve($asset, 'metadata.json');
    }

    private function resolve(EagleAsset $asset, string $fileName): string
    {
        $asset->loadMissing('library');

        if ($fileName === '' || basename($fileName) !== $fileName) {
            throw new RuntimeException('The Eagle asset file name is invalid.');
        }

        $path = trim($asset->library->path, '/')."/images/{$asset->eagle_id}.info/{$fileName}";

        if (! $this->storage->fileExists($path)) {
            throw new RuntimeException('The Eagle asset file is unavailable in OpenCloud.');
        }

        return $path;
    }

    private function resolveOrRefresh(EagleAsset $asset, string $attribute): string
    {
        $fileName = (string) $asset->getAttribute($attribute);

        try {
            return $this->resolve($asset, $fileName);
        } catch (RuntimeException) {
            $this->refreshFileNames($asset);
        }

        $fileName = (string) $asset->getAttribute($attribute);

        if ($fileName === '') {
            throw new RuntimeException('The Eagle asset file is unavailable in OpenCloud.');
        }

        return $this->resolve($asset, $fileName);
    }

    private function refreshFileNames(EagleAsset $asset): void
    {
        $asset->loadMissing('library');
        $directory = trim($asset->library->path, '/')."/images/{$asset->eagle_id}.info";
        $fileName = null;
        $thumbnailFileName = null;

        foreach ($this->storage->list($directory) as $file) {
            if (! $file instanceof FileAttributes) {
                continue;
            }

            $candidate = basename($file->path());

            if (str_ends_with($candidate, '_thumbnail.png')) {
                $thumbnailFileName ??= $candidate;

                continue;
            }

            if (strtolower(pathinfo($candidate, PATHINFO_EXTENSION)) === $asset->extension) {
                $fileName ??= $candidate;
            }
        }

        if (! $fileName) {
            throw new RuntimeException('The Eagle asset file is unavailable in OpenCloud.');
        }

        $asset->forceFill([
            'file_name' => $fileName,
            'thumbnail_file_name' => $thumbnailFileName,
        ])->save();
    }
}
