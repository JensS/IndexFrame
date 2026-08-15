<?php

namespace App\Http\Controllers;

use App\Models\EagleFolder;
use App\Models\EagleLibrary;
use App\Services\SmartFolderFilter;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class LibraryFoldersController extends Controller
{
    public function __invoke(EagleLibrary $library, SmartFolderFilter $smartFolderFilter): JsonResponse
    {
        $folders = $library->folders()
            ->where('kind', 'folder')
            ->with('parent:id,eagle_id')
            ->withCount([
                'assets as assets_count' => fn ($query) => $query->where('is_deleted', false),
            ])
            ->orderBy('position')
            ->get()
            ->map(fn (EagleFolder $folder): array => [
                'id' => $folder->eagle_id,
                'parent_id' => $folder->parent?->eagle_id,
                'name' => $folder->name,
                'count' => $folder->assets_count,
            ]);

        $smartFolders = $library->folders()
            ->where('kind', 'smart')
            ->orderBy('position')
            ->get()
            ->map(function (EagleFolder $folder) use ($library, $smartFolderFilter): array {
                $query = $library->assets()->getQuery()->visible();
                $smartFolderFilter->apply($query, $folder);

                return [
                    'id' => $folder->eagle_id,
                    'name' => $folder->name,
                    'count' => $query->count(),
                    'conditions' => $folder->conditions ?? [],
                ];
            });

        $visibleAssets = $library->assets()->visible();
        $counts = [
            'all' => (clone $visibleAssets)->count(),
            'uncategorized' => (clone $visibleAssets)->whereDoesntHave('folders')->count(),
            'untagged' => (clone $visibleAssets)->whereJsonLength('tags', 0)->count(),
            'trash' => $library->assets()->where('is_deleted', true)->count(),
        ];

        $tags = Cache::remember("eagle-library.{$library->id}.tags", now()->addMinutes(10), function () use ($library) {
            return $library->assets()
                ->visible()
                ->pluck('tags')
                ->flatten()
                ->filter()
                ->countBy()
                ->sortDesc()
                ->take(40)
                ->map(fn (int $count, string $name): array => compact('name', 'count'))
                ->values();
        });

        return response()->json([
            'data' => [
                'folders' => $folders,
                'smart_folders' => $smartFolders,
                'counts' => $counts,
                'tags' => $tags,
            ],
        ]);
    }
}
