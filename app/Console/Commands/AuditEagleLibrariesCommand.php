<?php

namespace App\Console\Commands;

use App\Models\EagleLibrary;
use App\Services\EagleLibraryAuditor;
use App\Services\EagleLibraryDiscovery;
use Illuminate\Console\Command;

class AuditEagleLibrariesCommand extends Command
{
    protected $signature = 'eagle:audit
        {library? : Library path, directory name, or indexed slug}
        {--limit=0 : Check only this many items per library; zero checks all}
        {--json : Print a machine-readable report}';

    protected $description = 'Read and validate Eagle library structure without changing it';

    public function handle(EagleLibraryDiscovery $discovery, EagleLibraryAuditor $auditor): int
    {
        $paths = $this->matchingPaths($discovery->discover());

        if ($paths === []) {
            $this->components->error('No matching Eagle library was found.');

            return self::FAILURE;
        }

        $limit = max(0, (int) $this->option('limit'));
        $reports = collect($paths)->map(fn (string $path): array => $auditor->audit($path, $limit));

        if ($this->option('json')) {
            $this->line(json_encode($reports->all(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        } else {
            foreach ($reports as $report) {
                $this->components->info($report['path']);
                $this->components->twoColumnDetail('Items checked', "{$report['checked_items']} / {$report['total_items']}");
                $this->components->twoColumnDetail('Errors', (string) count($report['errors']));
                $this->components->twoColumnDetail('Warnings', (string) count($report['warnings']));

                foreach (array_slice($report['errors'], 0, 50) as $error) {
                    $this->components->error($error);
                }

                foreach (array_slice($report['warnings'], 0, 50) as $warning) {
                    $this->components->warn($warning);
                }

                if (count($report['errors']) > 50 || count($report['warnings']) > 50) {
                    $this->line('Use --json for the complete report.');
                }
            }
        }

        if ($reports->contains(fn (array $report): bool => $report['errors'] !== [])) {
            return self::FAILURE;
        }

        $this->components->success('The checked Eagle library data is structurally valid.');

        return self::SUCCESS;
    }

    /** @param array<int, string> $discoveredPaths */
    private function matchingPaths(array $discoveredPaths): array
    {
        $library = $this->argument('library');

        if (! is_string($library) || $library === '') {
            return $discoveredPaths;
        }

        $indexedPath = EagleLibrary::query()->where('slug', $library)->value('path');
        $needle = is_string($indexedPath) ? $indexedPath : $library;

        return collect($discoveredPaths)
            ->filter(fn (string $path): bool => $path === $needle || basename($path) === $needle)
            ->values()
            ->all();
    }
}
