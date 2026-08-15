<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('eagle_assets', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('eagle_library_id')->constrained()->cascadeOnDelete();
            $table->string('eagle_id', 32);
            $table->string('name');
            $table->string('file_name');
            $table->string('thumbnail_file_name')->nullable();
            $table->string('extension', 20);
            $table->string('media_type', 20)->default('other');
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->decimal('duration', 12, 3)->nullable();
            $table->unsignedTinyInteger('rating')->default(0);
            $table->json('tags');
            $table->json('palettes')->nullable();
            $table->text('url')->nullable();
            $table->text('annotation')->nullable();
            $table->boolean('is_deleted')->default(false);
            $table->unsignedBigInteger('birth_time')->nullable();
            $table->unsignedBigInteger('file_modification_time')->nullable();
            $table->unsignedBigInteger('modification_time')->nullable();
            $table->unsignedBigInteger('deleted_time')->nullable();
            $table->timestamps();

            $table->unique(['eagle_library_id', 'eagle_id']);
            $table->index(['eagle_library_id', 'is_deleted']);
            $table->index(['eagle_library_id', 'media_type']);
            $table->index(['eagle_library_id', 'modification_time']);
        });

        Schema::create('eagle_asset_folder', function (Blueprint $table): void {
            $table->foreignId('eagle_asset_id')->constrained()->cascadeOnDelete();
            $table->foreignId('eagle_folder_id')->constrained()->cascadeOnDelete();

            $table->primary(['eagle_asset_id', 'eagle_folder_id']);
        });
    }
};
