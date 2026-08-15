<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('eagle_libraries', function (Blueprint $table): void {
            $table->id();
            $table->string('slug')->unique();
            $table->string('name');
            $table->text('path')->unique();
            $table->string('application_version')->nullable();
            $table->unsignedBigInteger('modification_time')->nullable();
            $table->timestamp('indexed_at')->nullable();
            $table->timestamps();
        });
    }
};
