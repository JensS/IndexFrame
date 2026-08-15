<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EagleFolder extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'conditions' => 'array',
        ];
    }

    public function library(): BelongsTo
    {
        return $this->belongsTo(EagleLibrary::class, 'eagle_library_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('position');
    }

    public function assets(): BelongsToMany
    {
        return $this->belongsToMany(EagleAsset::class, 'eagle_asset_folder');
    }
}
