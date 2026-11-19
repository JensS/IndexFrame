<?php

namespace Tests\Feature;

use App\Jobs\DiscoverEagleLibraries;
use App\Jobs\SyncEagleLibrary;
use App\Models\EagleLibrary;
use App\Models\EagleLibrarySync;
use App\Services\EagleLibraryIndexer;
use App\Services\EagleStorage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Tests\TestCase;

class QueuedLibrarySyncTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = sys_get_temp_dir().'/indexframe-queued-'.bin2hex(random_bytes(6));
        File::copyDirectory(base_path('tests/Fixtures/netcup-webdav'), $this->root);
        config()->set([
            'eagle.testing_root' => $this->root,
            'eagle.sync_batch_size' => 1,
            'cache.default' => 'database',
            'queue.default' => 'database',
        ]);
        app()->forgetInstance(EagleStorage::class);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->root);

        parent::tearDown();
    }

    public function test_discovery_is_deduplicated_and_a_database_worker_indexes_unicode(): void
    {
        DiscoverEagleLibraries::dispatch(true);
        DiscoverEagleLibraries::dispatch(true);
        $this->assertDatabaseCount('jobs', 1);

        $this->drainOneJob();
        $this->assertDatabaseCount('jobs', 1);
        $this->drainOneJob();

        $this->assertDatabaseHas('eagle_assets', ['name' => 'Grüße 🎨']);
        $this->assertDatabaseHas('eagle_folders', ['name' => 'Überblick 🎨']);
        $this->assertDatabaseCount('jobs', 0);
        $this->assertDatabaseCount('eagle_library_syncs', 0);
        $this->assertNotNull(EagleLibrary::query()->firstOrFail()->indexed_at);
    }

    public function test_a_stopped_worker_resumes_at_its_checkpoint_and_only_prunes_at_completion(): void
    {
        $library = app(EagleLibraryIndexer::class)->syncPath('Demo.library');
        $this->addAsset('SECONDASSET', 'Second item');
        $this->addAsset('THIRDASSET', 'Third item');
        $this->writeManifest(['SECONDASSET' => 1720000000000, 'THIRDASSET' => 1720000000000]);
        SyncEagleLibrary::dispatch('Demo.library', true);

        $this->drainOneJob();

        $this->assertSame(1, EagleLibrarySync::query()->firstOrFail()->position);
        $this->assertDatabaseHas('eagle_assets', ['eagle_id' => 'DEMOASSET01']);
        $this->assertNull($library->refresh()->indexed_at);

        // The first batch no longer needs its source: the next invocation resumes.
        File::deleteDirectory("{$this->root}/Demo.library/images/SECONDASSET.info");
        $this->drainOneJob();

        $this->assertDatabaseMissing('eagle_assets', ['eagle_id' => 'DEMOASSET01']);
        $this->assertDatabaseHas('eagle_assets', ['eagle_id' => 'THIRDASSET']);
        $this->assertDatabaseCount('eagle_library_syncs', 0);
        $this->assertNotNull($library->refresh()->indexed_at);
    }

    public function test_missing_metadata_retains_the_checkpoint_for_a_later_retry(): void
    {
        $metadataPath = "{$this->root}/Demo.library/images/DEMOASSET01.info/metadata.json";
        $original = File::get($metadataPath);
        File::put($metadataPath, '{broken');
        $job = new SyncEagleLibrary('Demo.library', true);

        try {
            $job->handle(app(EagleLibraryIndexer::class));
            $this->fail('Invalid metadata must fail the batch.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('checkpoint was retained', $exception->getMessage());
        }

        $this->assertSame(0, EagleLibrarySync::query()->firstOrFail()->position);
        $this->assertDatabaseCount('eagle_assets', 0);
        File::put($metadataPath, $original);
        $job->handle(app(EagleLibraryIndexer::class));

        $this->assertDatabaseCount('eagle_assets', 1);
        $this->assertDatabaseCount('eagle_library_syncs', 0);
    }

    public function test_sync_without_a_modification_manifest_advances_through_every_batch(): void
    {
        File::delete("{$this->root}/Demo.library/mtime.json");
        $this->addAsset('SECONDASSET', 'Second item');
        SyncEagleLibrary::dispatch('Demo.library');

        $this->drainOneJob();
        $this->assertSame(1, EagleLibrarySync::query()->firstOrFail()->position);
        $this->drainOneJob();

        $this->assertDatabaseCount('eagle_assets', 2);
        $this->assertDatabaseCount('jobs', 0);
    }

    public function test_the_library_wide_manifest_entry_is_not_queued_as_an_asset(): void
    {
        $this->writeManifest(['DEMOASSET01' => 1720000000000, 'all' => 1720000000000]);
        SyncEagleLibrary::dispatch('Demo.library');

        $this->drainOneJob();

        $this->assertDatabaseCount('eagle_assets', 1);
        $this->assertDatabaseCount('eagle_library_syncs', 0);
        $this->assertDatabaseCount('jobs', 0);
        $this->assertNotNull(EagleLibrary::query()->firstOrFail()->indexed_at);
    }

    public function test_a_retained_checkpoint_with_the_library_wide_entry_can_finish(): void
    {
        $library = app(EagleLibraryIndexer::class)->registerPath('Demo.library');
        EagleLibrarySync::query()->create([
            'eagle_library_id' => $library->id,
            'directories' => ['Demo.library/images/all.info'],
            'missing_asset_ids' => [],
        ]);
        SyncEagleLibrary::dispatch('Demo.library');

        $this->drainOneJob();

        $this->assertDatabaseCount('eagle_assets', 0);
        $this->assertDatabaseCount('eagle_library_syncs', 0);
        $this->assertNotNull($library->refresh()->indexed_at);
    }

    public function test_mysql_uses_unicode_even_when_the_server_default_is_latin1(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            $this->markTestSkipped('Verified in the MySQL 8.4 simulation.');
        }

        $connection = DB::selectOne('SELECT @@character_set_connection AS charset, @@collation_connection AS collation');
        $this->assertSame('utf8mb4', $connection->charset);
        $this->assertSame('utf8mb4_unicode_ci', $connection->collation);
        $tables = DB::select('SELECT TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');

        foreach ($tables as $table) {
            $this->assertSame('utf8mb4_unicode_ci', $table->collation);
        }
    }

    private function drainOneJob(): void
    {
        $this->artisan('queue:work', [
            'connection' => 'database',
            '--stop-when-empty' => true,
            '--max-jobs' => 1,
            '--tries' => 1,
        ])->assertSuccessful();
        $this->assertDatabaseCount('failed_jobs', 0);
    }

    private function addAsset(string $eagleId, string $name): void
    {
        $directory = "{$this->root}/Demo.library/images/{$eagleId}.info";
        File::ensureDirectoryExists($directory);
        File::put("{$directory}/{$name}.png", 'fixture');
        File::put("{$directory}/metadata.json", json_encode([
            'id' => $eagleId,
            'name' => $name,
            'ext' => 'png',
            'size' => 7,
            'lastModified' => 1720000000000,
            'folders' => ['DEMOFOLDER01'],
            'tags' => [],
        ], JSON_THROW_ON_ERROR));
    }

    private function writeManifest(array $times): void
    {
        File::put("{$this->root}/Demo.library/mtime.json", json_encode($times, JSON_THROW_ON_ERROR));
    }
}
