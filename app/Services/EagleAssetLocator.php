<?php

namespace App\Services;

use App\Models\EagleAsset;
use RuntimeException;

class EagleAssetLocator
{
    public function __construct(private EagleStorage $storage) {}

    public function original(EagleAsset $asset): string
    {
        return $this->resolve($asset, $asset->file_name);
    }

    public function preview(EagleAsset $asset): string
    {
        if (filled($asset->thumbnail_file_name)) {
            return $this->resolve($asset, $asset->thumbnail_file_name);
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
}
