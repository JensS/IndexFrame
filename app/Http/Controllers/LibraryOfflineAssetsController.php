<?php

namespace App\Http\Controllers;

use App\Models\EagleAsset;
use App\Models\EagleLibrary;
use App\Services\EagleAssetData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LibraryOfflineAssetsController extends Controller
{
    public function __invoke(
        Request $request,
        EagleLibrary $library,
        EagleAssetData $assetData,
    ): JsonResponse {
        $validated = $request->validate([
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $assets = $library->assets()
            ->with('folders')
            ->orderByDesc('modification_time')
            ->paginate(250, page: $validated['page'] ?? 1);

        return response()->json([
            'data' => $assets->getCollection()->map(fn (EagleAsset $asset): array => $assetData->make($asset)),
            'meta' => [
                'current_page' => $assets->currentPage(),
                'last_page' => $assets->lastPage(),
                'per_page' => $assets->perPage(),
                'total' => $assets->total(),
            ],
        ])->header('Cache-Control', 'private, no-cache');
    }
}
