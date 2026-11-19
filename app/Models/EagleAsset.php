<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class EagleAsset extends Model
{
    protected $guarded = [];

    protected $hidden = ['share_token'];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'palettes' => 'array',
            'is_deleted' => 'boolean',
            'duration' => 'float',
        ];
    }

    public function library(): BelongsTo
    {
        return $this->belongsTo(EagleLibrary::class, 'eagle_library_id');
    }

    public function folders(): BelongsToMany
    {
        return $this->belongsToMany(EagleFolder::class, 'eagle_asset_folder');
    }

    public function scopeVisible(Builder $query): Builder
    {
        return $query->where('is_deleted', false);
    }

    public function sharePreviewType(): ?string
    {
        return match ($this->mime_type) {
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml' => 'image',
            'video/mp4', 'video/webm' => 'video',
            default => null,
        };
    }
}
