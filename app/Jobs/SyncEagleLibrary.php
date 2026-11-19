<?php

namespace App\Jobs;

use App\Models\EagleLibrary;
use App\Models\EagleLibrarySync;
use App\Services\EagleLibraryIndexer;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class SyncEagleLibrary implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $uniqueFor = 3600;

    public int $timeout = 120;

    public int $tries = 3;

    public int $backoff = 60;

    public function __construct(public string $path, public bool $prune = false) {}

    public function uniqueId(): string
    {
        return hash('sha256', $this->path);
    }

    public function handle(EagleLibraryIndexer $indexer): void
    {
        $lock = Cache::lock('eagle-library-sync', 180);

        if (! $lock->get()) {
            $this->release(60);

            return;
        }

        try {
            $this->sync($indexer);
        } finally {
            $lock->release();
        }
    }

    private function sync(EagleLibraryIndexer $indexer): void
    {
        $library = EagleLibrary::query()->where('path', $this->path)->first();
        $sync = $library ? EagleLibrarySync::query()->where('eagle_library_id', $library->id)->first() : null;

        if (! $sync) {
            $library = $indexer->registerPath($this->path);
            $plan = $indexer->planSync($library, $this->prune);
            $sync = EagleLibrarySync::query()->create([
                'eagle_library_id' => $library->id,
                ...$plan,
            ]);
        }

        $directories = array_slice($sync->directories, $sync->position, config('eagle.sync_batch_size'), true);
        $indexer->syncDirectoryBatch($library, $directories);

        // A retry can safely replay an upsert. Commit the checkpoint and its next
        // database queue job together, so a stopped cron cannot lose progress.
        DB::transaction(function () use ($sync, $directories, $library): void {
            $sync->position += count($directories);

            if ($sync->position < count($sync->directories)) {
                $sync->save();
                self::dispatch($this->path, $this->prune);

                return;
            }

            foreach (array_chunk($sync->missing_asset_ids, 500) as $assetIds) {
                $library->assets()->whereIn('id', $assetIds)->delete();
            }

            $library->forceFill(['indexed_at' => now()])->save();
            $sync->delete();
        });

        Cache::forget("eagle-library.{$library->id}.tags");
    }
}
