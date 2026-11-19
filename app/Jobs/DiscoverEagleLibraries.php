<?php

namespace App\Jobs;

use App\Models\EagleLibrary;
use App\Services\EagleLibraryDiscovery;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class DiscoverEagleLibraries implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $uniqueFor = 240;

    public int $timeout = 120;

    public int $tries = 3;

    public int $backoff = 60;

    public function __construct(public bool $prune = false) {}

    public function handle(EagleLibraryDiscovery $discovery): void
    {
        $paths = $discovery->discover();

        if ($this->prune) {
            EagleLibrary::query()->whereNotIn('path', $paths)->delete();
        }

        foreach ($paths as $path) {
            SyncEagleLibrary::dispatch($path, $this->prune);
        }
    }
}
