<?php

namespace App\Http\Controllers;

use App\Models\EagleAsset;
use App\Models\EagleLibrary;
use App\Services\EagleAssetData;
use App\Services\EagleAssetWriter;
use App\Services\EagleLibraryIndexer;
use App\Services\SmartFolderFilter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\File;

class LibraryAssetsController extends Controller
{
    public function index(
        Request $request,
        EagleLibrary $library,
        SmartFolderFilter $smartFolderFilter,
        EagleAssetData $assetData,
    ): JsonResponse {
        $validated = $request->validate([
            'q' => ['nullable', 'string', 'max:200'],
            'view' => ['nullable', Rule::in(['all', 'uncategorized', 'untagged', 'recent', 'random', 'trash'])],
            'folder' => ['nullable', 'string', 'max:32'],
            'smart' => ['nullable', 'string', 'max:32'],
            'tag' => ['nullable', 'string', 'max:100'],
            'type' => ['nullable', Rule::in(['image', 'video', 'other'])],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'name'])],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:20', 'max:120'],
        ]);

        $view = $validated['view'] ?? 'all';
        $query = $library->assets()->getQuery()->with('folders');
        $view === 'trash'
            ? $query->where('is_deleted', true)
            : $query->where('is_deleted', false);

        if (filled($validated['q'] ?? null)) {
            $search = $validated['q'];
            $query->where(function (Builder $searchQuery) use ($search): void {
                $searchQuery
                    ->where('name', 'like', "%{$search}%")
                    ->orWhere('annotation', 'like', "%{$search}%")
                    ->orWhere('url', 'like', "%{$search}%")
                    ->orWhere('extension', 'like', "%{$search}%")
                    ->orWhere('tags', 'like', "%{$search}%");
            });
        }

        if ($view === 'uncategorized') {
            $query->whereDoesntHave('folders');
        }

        if ($view === 'untagged') {
            $query->whereJsonLength('tags', 0);
        }

        if (filled($validated['folder'] ?? null)) {
            $query->whereHas(
                'folders',
                fn (Builder $folderQuery) => $folderQuery->where('eagle_id', $validated['folder']),
            );
        }

        if (filled($validated['smart'] ?? null)) {
            $smartFolder = $library->folders()
                ->where('kind', 'smart')
                ->where('eagle_id', $validated['smart'])
                ->firstOrFail();
            $smartFolderFilter->apply($query, $smartFolder);
        }

        if (filled($validated['tag'] ?? null)) {
            $query->whereJsonContains('tags', $validated['tag']);
        }

        if (filled($validated['type'] ?? null)) {
            $query->where('media_type', $validated['type']);
        }

        if ($view === 'random') {
            $query->inRandomOrder();
        } else {
            match ($validated['sort'] ?? 'newest') {
                'oldest' => $query->orderBy('modification_time'),
                'name' => $query->orderBy('name'),
                default => $query->orderByDesc('modification_time'),
            };
        }

        $assets = $query->paginate($validated['per_page'] ?? 60);

        return response()->json([
            'data' => $assets->getCollection()->map(fn (EagleAsset $asset) => $assetData->make($asset)),
            'meta' => [
                'current_page' => $assets->currentPage(),
                'last_page' => $assets->lastPage(),
                'per_page' => $assets->perPage(),
                'total' => $assets->total(),
            ],
        ]);
    }

    public function store(
        Request $request,
        EagleLibrary $library,
        EagleAssetWriter $writer,
        EagleLibraryIndexer $indexer,
        EagleAssetData $assetData,
    ): JsonResponse {
        $validated = $request->validate([
            'files' => ['required', 'array', 'min:1', 'max:20'],
            'files.*' => [
                'required',
                File::types(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'svg', 'mp4', 'webm', 'mkv', 'mov', 'm4v'])
                    ->max(config('eagle.upload_max_kilobytes')),
            ],
            'folder_ids' => ['sometimes', 'array'],
            'folder_ids.*' => [
                'string',
                Rule::exists('eagle_folders', 'eagle_id')->where(
                    fn ($query) => $query
                        ->where('eagle_library_id', $library->id)
                        ->where('kind', 'folder'),
                ),
            ],
        ]);

        $assets = collect($validated['files'])->map(function ($file) use (
            $assetData,
            $indexer,
            $library,
            $validated,
            $writer,
        ): array {
            $eagleId = $writer->create($library, $file, $validated['folder_ids'] ?? []);
            $asset = $indexer->syncAsset($library, $eagleId);

            return $assetData->make($asset);
        });

        Cache::forget("eagle-library.{$library->id}.tags");

        return response()->json(['data' => $assets], 201);
    }

    public function update(
        Request $request,
        EagleLibrary $library,
        EagleAsset $asset,
        EagleAssetWriter $writer,
        EagleLibraryIndexer $indexer,
        EagleAssetData $assetData,
    ): JsonResponse {
        $this->ensureAssetBelongsToLibrary($asset, $library);
        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'annotation' => ['sometimes', 'nullable', 'string', 'max:20000'],
            'url' => ['sometimes', 'nullable', 'url', 'max:4000'],
            'rating' => ['sometimes', 'integer', 'between:0,5'],
            'tags' => ['sometimes', 'array', 'max:100'],
            'tags.*' => ['string', 'max:100'],
            'folder_ids' => ['sometimes', 'array'],
            'folder_ids.*' => [
                'string',
                Rule::exists('eagle_folders', 'eagle_id')->where(
                    fn ($query) => $query
                        ->where('eagle_library_id', $library->id)
                        ->where('kind', 'folder'),
                ),
            ],
            'is_deleted' => ['sometimes', 'boolean'],
        ]);

        $writer->update($asset, $validated);
        $asset = $indexer->syncAsset($library, $asset->eagle_id);

        return response()->json(['data' => $assetData->make($asset)]);
    }

    public function destroy(
        EagleLibrary $library,
        EagleAsset $asset,
        EagleAssetWriter $writer,
        EagleLibraryIndexer $indexer,
    ): JsonResponse {
        $this->ensureAssetBelongsToLibrary($asset, $library);
        $writer->update($asset, ['is_deleted' => true]);
        $indexer->syncAsset($library, $asset->eagle_id);

        return response()->json(null, 204);
    }

    private function ensureAssetBelongsToLibrary(EagleAsset $asset, EagleLibrary $library): void
    {
        abort_unless($asset->eagle_library_id === $library->id, 404);
    }
}
