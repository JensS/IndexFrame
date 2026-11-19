<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('eagle_library_syncs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('eagle_library_id')->unique()->constrained()->cascadeOnDelete();
            $table->json('directories');
            $table->json('missing_asset_ids');
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });
    }
};
