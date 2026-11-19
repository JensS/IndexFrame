<?php

namespace App\Http\Controllers;

use App\Models\EagleAsset;
use App\Models\EagleLibrary;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class AssetSharesController extends Controller
{
    public function store(EagleLibrary $library, string $assetId): JsonResponse
    {
        $assets = $library->assets()->visible()->where('eagle_id', $assetId);
        $asset = (clone $assets)->firstOrFail();

        if ($asset->share_token === null) {
            // Keep the first token if two requests share this asset at the same time.
            (clone $assets)->whereNull('share_token')->update(['share_token' => bin2hex(random_bytes(32))]);
            $asset = $assets->firstOrFail();
        }

        return response()->json(['url' => route('assetShares.show', $asset->share_token)])
            ->header('Cache-Control', 'private, no-store');
    }

    public function show(EagleAsset $asset): Response
    {
        abort_if($asset->is_deleted, 404);

        return response()->view('sharedAsset', ['asset' => $asset]);
    }
}
