<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('eagle_folders', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('eagle_library_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parent_id')->nullable()->constrained('eagle_folders')->cascadeOnDelete();
            $table->string('eagle_id', 32);
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('kind')->default('folder');
            $table->json('conditions')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['eagle_library_id', 'eagle_id']);
            $table->index(['eagle_library_id', 'kind']);
        });
    }
};
