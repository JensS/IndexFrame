<?php

namespace App\Http\Controllers;

use App\Models\EagleLibrary;
use Illuminate\Http\JsonResponse;

class LibrariesController extends Controller
{
    public function index(): JsonResponse
    {
        $libraries = EagleLibrary::query()
            ->withCount([
                'assets as assets_count' => fn ($query) => $query->where('is_deleted', false),
            ])
            ->orderBy('name')
            ->get()
            ->map(fn (EagleLibrary $library): array => [
                'slug' => $library->slug,
                'name' => $library->name,
                'assets_count' => $library->assets_count,
                'indexed_at' => $library->indexed_at?->toIso8601String(),
                'writes_enabled' => (bool) config('eagle.writes_enabled'),
                'upload_max_kilobytes' => (int) config('eagle.upload_max_kilobytes'),
                'upload_request_max_kilobytes' => (int) config('eagle.upload_request_max_kilobytes'),
            ]);

        return response()->json(['data' => $libraries]);
    }
}
