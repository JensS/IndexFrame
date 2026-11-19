<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EagleLibrarySync extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'directories' => 'array',
            'missing_asset_ids' => 'array',
        ];
    }
}
