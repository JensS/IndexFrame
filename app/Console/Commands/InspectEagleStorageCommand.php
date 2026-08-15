<?php

namespace App\Console\Commands;

use App\Services\EagleLibraryDiscovery;
use App\Services\EagleStorage;
use Illuminate\Console\Command;
use Throwable;

class InspectEagleStorageCommand extends Command
{
    protected $signature = 'eagle:status';

    protected $description = 'Check the OpenCloud WebDAV connection and discover Eagle libraries';

    public function handle(EagleLibraryDiscovery $discovery, EagleStorage $storage): int
    {
        $this->components->twoColumnDetail('Storage mode', 'OpenCloud WebDAV');
        $this->components->twoColumnDetail('Server', (string) config('eagle.webdav.url'));
        $this->components->twoColumnDetail('User', (string) config('eagle.webdav.username'));
        $this->components->twoColumnDetail('Library root', (string) config('eagle.webdav.root'));

        try {
            $storage->ensureRootExists();
            $libraries = $discovery->discover();
        } catch (Throwable $exception) {
            $this->components->error('OpenCloud is unavailable: '.$exception->getMessage());

            return self::FAILURE;
        }

        if ($libraries === []) {
            $this->components->warn('Connected successfully; no .library directories have been imported yet.');

            return self::SUCCESS;
        }

        foreach ($libraries as $library) {
            $this->components->twoColumnDetail(basename($library), '<fg=green>available</>');
        }

        $this->components->success('Eagle storage is ready.');

        return self::SUCCESS;
    }
}
