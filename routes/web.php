<?php

use App\Http\Controllers\AssetFilesController;
use App\Http\Controllers\LibrariesController;
use App\Http\Controllers\LibraryAssetsController;
use App\Http\Controllers\LibraryFoldersController;
use App\Http\Controllers\LibraryOfflineAssetsController;
use App\Http\Controllers\LoginController;
use Illuminate\Support\Facades\Route;

Route::get('login', [LoginController::class, 'create'])->name('login');
Route::post('login', [LoginController::class, 'store'])->name('login.store');

Route::middleware('eagle.auth')->group(function (): void {
    Route::get('/', fn () => view('library'))->name('library');
    Route::post('logout', [LoginController::class, 'destroy'])->name('logout');

    Route::prefix('api')->group(function (): void {
        Route::get('libraries', [LibrariesController::class, 'index'])->name('libraries.index');
        Route::get('libraries/{library}/folders', LibraryFoldersController::class)->name('libraries.folders');
        Route::get('libraries/{library}/assets', [LibraryAssetsController::class, 'index'])->name('libraries.assets.index');
        Route::get('libraries/{library}/offline-assets', LibraryOfflineAssetsController::class)->name('libraries.offlineAssets');
        Route::post('libraries/{library}/assets', [LibraryAssetsController::class, 'store'])->name('libraries.assets.store');
        Route::patch('libraries/{library}/assets/{asset:eagle_id}', [LibraryAssetsController::class, 'update'])->name('libraries.assets.update');
        Route::delete('libraries/{library}/assets/{asset:eagle_id}', [LibraryAssetsController::class, 'destroy'])->name('libraries.assets.destroy');
    });

    Route::get('media/{library}/{asset:eagle_id}/preview', [AssetFilesController::class, 'preview'])->name('assets.preview');
    Route::get('media/{library}/{asset:eagle_id}/image/{width}', [AssetFilesController::class, 'image'])
        ->whereNumber('width')
        ->name('assets.image');
    Route::get('media/{library}/{asset:eagle_id}/original', [AssetFilesController::class, 'original'])->name('assets.original');
    Route::get('media/{library}/{asset:eagle_id}/download', [AssetFilesController::class, 'download'])->name('assets.download');
});
