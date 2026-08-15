<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EagleLibrary extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'indexed_at' => 'datetime',
        ];
    }

    public function assets(): HasMany
    {
        return $this->hasMany(EagleAsset::class);
    }

    public function folders(): HasMany
    {
        return $this->hasMany(EagleFolder::class);
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }
}
