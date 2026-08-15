<?php

namespace App\Console\Commands;

use App\Services\EagleLibraryIndexer;
use App\Services\EagleStorage;
use Illuminate\Console\Command;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Symfony\Component\Console\Helper\ProgressBar;
use Throwable;

class ImportEagleLibraryCommand extends Command
{
    protected $signature = 'eagle:import
        {source : Local path to an Eagle .library directory}
        {--replace : Publish the import in place of an existing library and retain the previous directory as a rollback copy}';

    protected $description = 'Upload a local Eagle library into the configured OpenCloud WebDAV root';

    public function handle(EagleStorage $storage, EagleLibraryIndexer $indexer): int
    {
        $source = realpath((string) $this->argument('source'));

        if (! is_string($source) || ! $this->isEagleLibrary($source)) {
            $this->components->error('The source must be a readable .library directory containing metadata.json and images/.');

            return self::FAILURE;
        }

        $destination = basename($source);
        $staging = "{$destination}.indexframe-importing-".bin2hex(random_bytes(6));
        $rollback = null;
        $storage->ensureRootExists();

        if ($storage->directoryExists($destination)) {
            if (! $this->option('replace')) {
                $this->components->error("{$destination} already exists in OpenCloud. Use --replace to overwrite it.");

                return self::FAILURE;
            }

            $rollback = "{$destination}.indexframe-replaced-".now()->format('Ymd-His');
            $this->components->warn("The existing library will be retained as {$rollback}.");
        }

        $progress = $this->output->createProgressBar($this->countFiles($source));
        $progress->setFormat(' %current%/%max% [%bar%] %percent:3s%% %message%');
        $progress->setMessage('Preparing upload');
        $progress->start();

        try {
            $storage->createDirectory($staging);
            $this->uploadDirectory($storage, $source, $staging, $progress);

            if (! $storage->fileExists("{$staging}/metadata.json") || ! $storage->directoryExists("{$staging}/images")) {
                throw new RuntimeException('The staged upload is not a complete Eagle library.');
            }

            $progress->finish();
            $this->newLine(2);

            try {
                if ($rollback !== null) {
                    $storage->moveSafely($destination, $rollback);
                }

                $storage->moveSafely($staging, $destination);
            } catch (Throwable $exception) {
                if ($rollback !== null
                    && ! $storage->directoryExists($destination)
                    && $storage->directoryExists($rollback)) {
                    $storage->moveSafely($rollback, $destination);
                }

                throw $exception;
            }

            $library = $indexer->syncPath(
                $destination,
                true,
                fn (string $message) => $this->line("  {$message}"),
            );
        } catch (Throwable $exception) {
            $progress->clear();

            if ($storage->directoryExists($staging)) {
                $storage->deleteDirectory($staging);
            }

            throw $exception;
        }

        $this->components->success("Imported {$library->name} with {$library->assets()->count()} indexed assets.");

        if ($rollback !== null) {
            $this->components->warn("Rollback copy retained in OpenCloud: {$rollback}");
        }

        return self::SUCCESS;
    }

    private function isEagleLibrary(string $path): bool
    {
        return str_ends_with($path, '.library')
            && is_file("{$path}/metadata.json")
            && is_dir("{$path}/images");
    }

    private function countFiles(string $source): int
    {
        $count = 0;

        foreach ($this->iterator($source) as $entry) {
            if (! $entry->isLink() && $entry->isFile()) {
                $count++;
            }
        }

        return $count;
    }

    private function uploadDirectory(
        EagleStorage $storage,
        string $source,
        string $destination,
        ProgressBar $progress,
    ): void {
        foreach ($this->iterator($source) as $entry) {
            if ($entry->isLink()) {
                continue;
            }

            $relativePath = substr($entry->getPathname(), strlen($source) + 1);
            $remotePath = "{$destination}/{$relativePath}";

            if ($entry->isDir()) {
                $storage->createDirectory($remotePath);

                continue;
            }

            if (! $entry->isFile()) {
                continue;
            }

            $progress->setMessage($relativePath);
            $stream = fopen($entry->getPathname(), 'rb');

            if (! is_resource($stream)) {
                throw new RuntimeException("Unable to read {$entry->getPathname()}.");
            }

            try {
                $storage->writeStream($remotePath, $stream);
            } finally {
                fclose($stream);
            }

            $progress->advance();
        }
    }

    /** @return RecursiveIteratorIterator<RecursiveDirectoryIterator> */
    private function iterator(string $source): RecursiveIteratorIterator
    {
        return new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($source, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST,
        );
    }
}
