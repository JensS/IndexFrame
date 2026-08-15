<?php

namespace App\Services;

use App\Models\EagleAsset;

class EagleAssetData
{
    /** @return array<string, mixed> */
    public function make(EagleAsset $asset): array
    {
        $asset->loadMissing(['library', 'folders']);
        $version = $asset->file_modification_time ?? $asset->modification_time ?? 0;
        $previewUrl = route('assets.image', [$asset->library, $asset->eagle_id, 640])."?v={$version}";
        $viewerWidth = $asset->media_type === 'image' ? 1600 : 960;
        $viewerUrl = route('assets.image', [$asset->library, $asset->eagle_id, $viewerWidth])."?v={$version}";

        return [
            'id' => $asset->eagle_id,
            'name' => $asset->name,
            'extension' => strtoupper($asset->extension),
            'media_type' => $asset->media_type,
            'mime_type' => $asset->mime_type,
            'size' => $asset->size,
            'width' => $asset->width,
            'height' => $asset->height,
            'duration' => $asset->duration,
            'rating' => $asset->rating,
            'tags' => $asset->tags ?? [],
            'palettes' => $asset->palettes ?? [],
            'url' => $asset->url,
            'annotation' => $asset->annotation,
            'folder_ids' => $asset->folders->pluck('eagle_id')->values(),
            'is_deleted' => $asset->is_deleted,
            'birth_time' => $asset->birth_time,
            'modification_time' => $asset->modification_time,
            'has_thumbnail' => filled($asset->thumbnail_file_name),
            'preview_url' => $previewUrl,
            'viewer_url' => $viewerUrl,
            'offline_url' => $previewUrl,
            'original_url' => route('assets.original', [$asset->library, $asset->eagle_id]),
            'download_url' => route('assets.download', [$asset->library, $asset->eagle_id]),
        ];
    }
}
