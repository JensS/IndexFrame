<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('eagle_assets', function (Blueprint $table): void {
            $table->string('share_token', 64)->nullable()->unique();
        });
    }

    public function down(): void
    {
        Schema::table('eagle_assets', function (Blueprint $table): void {
            $table->dropUnique(['share_token']);
            $table->dropColumn('share_token');
        });
    }
};
