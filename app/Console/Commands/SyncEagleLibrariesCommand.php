<?php

namespace App\Console\Commands;

use App\Models\EagleLibrary;
use App\Services\EagleLibraryDiscovery;
use App\Services\EagleLibraryIndexer;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class SyncEagleLibrariesCommand extends Command
{
    protected $signature = 'eagle:sync {--prune : Remove indexed records whose Eagle item directory is gone}';

    protected $description = 'Discover and index configured Eagle libraries';

    public function handle(EagleLibraryDiscovery $discovery, EagleLibraryIndexer $indexer): int
    {
        $lock = Cache::lock('eagle-library-sync', 7200);

        if (! $lock->get()) {
            $this->components->warn('Another Eagle library sync is already running.');

            return self::SUCCESS;
        }

        try {
            return $this->sync($discovery, $indexer);
        } finally {
            $lock->release();
        }
    }

    private function sync(EagleLibraryDiscovery $discovery, EagleLibraryIndexer $indexer): int
    {
        $paths = $discovery->discover();

        if ($this->option('prune')) {
            EagleLibrary::query()->whereNotIn('path', $paths ?: [''])->delete();
        }

        if ($paths === []) {
            $this->components->warn('No Eagle libraries were found in the configured OpenCloud WebDAV root.');

            return $this->option('prune') ? self::SUCCESS : self::FAILURE;
        }

        foreach ($paths as $path) {
            $this->components->info("Indexing {$path}");
            $library = $indexer->syncPath(
                $path,
                (bool) $this->option('prune'),
                fn (string $message) => $this->line("  {$message}"),
            );
            $this->components->twoColumnDetail($library->name, "{$library->assets()->count()} assets");
        }

        $this->components->success('Eagle libraries are ready.');

        return self::SUCCESS;
    }
}
