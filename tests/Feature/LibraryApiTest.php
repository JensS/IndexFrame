<?php

namespace Tests\Feature;

use App\Exceptions\EagleWriteConflictException;
use App\Models\EagleLibrary;
use App\Services\EagleLibraryIndexer;
use App\Services\EagleStorage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class LibraryApiTest extends TestCase
{
    use RefreshDatabase;

    private string $libraryPath;

    private string $remoteLibraryPath = 'Test Library.library';

    private string $testingRoot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->testingRoot = sys_get_temp_dir().'/indexframe-test-'.bin2hex(random_bytes(6));
        $this->libraryPath = "{$this->testingRoot}/{$this->remoteLibraryPath}";
        config()->set('eagle.testing_root', $this->testingRoot);
        config()->set('eagle.write_backups.path', "{$this->testingRoot}/write-backups");
        config()->set('eagle.derivatives.path', "{$this->testingRoot}/derivatives");
        config()->set('eagle.derivatives.temporary_path', "{$this->testingRoot}/derivative-temp");
        config()->set('eagle.ffmpeg_path', "{$this->testingRoot}/missing-ffmpeg");
        app()->forgetInstance(EagleStorage::class);
        File::makeDirectory("{$this->libraryPath}/images/ABCDEFGHIJKLM.info", 0775, true);
        file_put_contents("{$this->libraryPath}/metadata.json", json_encode([
            'folders' => [[
                'id' => 'FOLDER0000001',
                'name' => 'Campaigns',
                'description' => '',
                'children' => [],
            ]],
            'smartFolders' => [[
                'id' => 'SMART00000001',
                'name' => 'People',
                'conditions' => [[
                    'rules' => [[
                        'property' => 'tags',
                        'method' => 'intersection',
                        'value' => ['portrait'],
                    ]],
                    'match' => 'OR',
                    'boolean' => 'TRUE',
                ]],
            ]],
            'modificationTime' => 1720000000000,
            'applicationVersion' => '4.0.0',
        ], JSON_THROW_ON_ERROR));
        file_put_contents("{$this->libraryPath}/mtime.json", json_encode([
            'ABCDEFGHIJKLM' => 1720000000000,
        ], JSON_THROW_ON_ERROR));
        file_put_contents("{$this->libraryPath}/images/ABCDEFGHIJKLM.info/portrait.jpg", 'image-contents');
        file_put_contents("{$this->libraryPath}/images/ABCDEFGHIJKLM.info/metadata.json", json_encode([
            'id' => 'ABCDEFGHIJKLM',
            'name' => 'Studio portrait',
            'size' => 14,
            'btime' => 1720000000000,
            'mtime' => 1720000000000,
            'ext' => 'jpg',
            'tags' => ['portrait'],
            'folders' => ['FOLDER0000001'],
            'isDeleted' => false,
            'annotation' => 'Blue studio setup',
            'modificationTime' => 1720000000000,
            'lastModified' => 1720000000000,
            'width' => 1200,
            'height' => 800,
            'futureEagleField' => ['preserve' => true],
        ], JSON_THROW_ON_ERROR));

        app(EagleLibraryIndexer::class)->syncPath($this->remoteLibraryPath);
        $this->withSession(['eagle_authenticated' => true]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->testingRoot);

        parent::tearDown();
    }

    public function test_it_indexes_and_searches_an_eagle_library(): void
    {
        $library = EagleLibrary::query()->firstOrFail();

        $this->getJson("/api/libraries/{$library->slug}/assets?q=studio")
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', 'ABCDEFGHIJKLM')
            ->assertJsonPath('data.0.tags.0', 'portrait');

        $this->getJson("/api/libraries/{$library->slug}/assets?smart=SMART00000001")
            ->assertOk()
            ->assertJsonPath('meta.total', 1);
    }

    public function test_it_exposes_the_complete_offline_manifest_and_smart_folder_rules(): void
    {
        $library = EagleLibrary::query()->firstOrFail();

        $this->getJson("/api/libraries/{$library->slug}/offline-assets")
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-cache, private')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', 'ABCDEFGHIJKLM')
            ->assertJsonPath('data.0.folder_ids.0', 'FOLDER0000001')
            ->assertJsonPath('data.0.preview_url', url("/media/{$library->slug}/ABCDEFGHIJKLM/image/640?v=1720000000000"))
            ->assertJsonPath('data.0.offline_url', url("/media/{$library->slug}/ABCDEFGHIJKLM/image/640?v=1720000000000"));

        $this->getJson("/api/libraries/{$library->slug}/folders")
            ->assertOk()
            ->assertJsonPath('data.smart_folders.0.conditions.0.rules.0.property', 'tags');
    }

    public function test_it_updates_eagle_metadata_and_the_search_index(): void
    {
        $library = EagleLibrary::query()->firstOrFail();

        $this->patchJson("/api/libraries/{$library->slug}/assets/ABCDEFGHIJKLM", [
            'name' => 'Updated portrait',
            'tags' => ['portrait', 'editorial'],
            'rating' => 4,
        ])->assertOk()
            ->assertJsonPath('data.name', 'Updated portrait')
            ->assertJsonPath('data.rating', 4);

        $metadata = json_decode(
            file_get_contents("{$this->libraryPath}/images/ABCDEFGHIJKLM.info/metadata.json"),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        $this->assertSame('Updated portrait', $metadata['name']);
        $this->assertContains('editorial', $metadata['tags']);
        $this->assertTrue($metadata['futureEagleField']['preserve']);
        $this->assertArrayHasKey('ABCDEFGHIJKLM', json_decode(
            file_get_contents("{$this->libraryPath}/mtime.json"),
            true,
            flags: JSON_THROW_ON_ERROR,
        ));

        $backupDirectory = "{$this->testingRoot}/write-backups/".
            hash('sha256', $this->remoteLibraryPath).'/ABCDEFGHIJKLM';
        $this->assertCount(1, File::files($backupDirectory));
    }

    public function test_it_uses_the_eagle_modification_index_for_incremental_refreshes(): void
    {
        $metadataPath = "{$this->libraryPath}/images/ABCDEFGHIJKLM.info/metadata.json";
        $metadata = json_decode(file_get_contents($metadataPath), true, flags: JSON_THROW_ON_ERROR);
        $metadata['name'] = 'Changed remotely';
        file_put_contents($metadataPath, json_encode($metadata, JSON_THROW_ON_ERROR));

        app(EagleLibraryIndexer::class)->syncPath($this->remoteLibraryPath);
        $this->assertDatabaseHas('eagle_assets', ['name' => 'Studio portrait']);

        $metadata['modificationTime'] = 1720000001000;
        $metadata['lastModified'] = 1720000001000;
        file_put_contents($metadataPath, json_encode($metadata, JSON_THROW_ON_ERROR));
        file_put_contents("{$this->libraryPath}/mtime.json", json_encode([
            'ABCDEFGHIJKLM' => 1720000001000,
        ], JSON_THROW_ON_ERROR));

        app(EagleLibraryIndexer::class)->syncPath($this->remoteLibraryPath);
        $this->assertDatabaseHas('eagle_assets', ['name' => 'Changed remotely']);
    }

    public function test_it_uploads_an_image_as_an_eagle_item(): void
    {
        $library = EagleLibrary::query()->firstOrFail();

        $response = $this->post("/api/libraries/{$library->slug}/assets", [
            'files' => [UploadedFile::fake()->image('new-mood.jpg', 640, 480)],
            'folder_ids' => ['FOLDER0000001'],
        ]);

        $response->assertCreated()->assertJsonPath('data.0.name', 'new-mood');
        $eagleId = $response->json('data.0.id');
        $this->assertMatchesRegularExpression('/^[A-Z0-9]{13}$/', $eagleId);
        $this->assertFileExists("{$this->libraryPath}/images/{$eagleId}.info/metadata.json");
        $this->assertFileExists("{$this->libraryPath}/images/{$eagleId}.info/new-mood_thumbnail.png");
    }

    public function test_library_writes_are_disabled_unless_explicitly_enabled(): void
    {
        config()->set('eagle.writes_enabled', false);
        $library = EagleLibrary::query()->firstOrFail();

        $this->post("/api/libraries/{$library->slug}/assets", [
            'files' => [UploadedFile::fake()->image('blocked.jpg')],
        ])->assertServiceUnavailable();

        $this->assertCount(1, File::directories("{$this->libraryPath}/images"));
    }

    public function test_stale_metadata_writes_are_rejected(): void
    {
        $storage = app(EagleStorage::class);
        $path = "{$this->remoteLibraryPath}/images/ABCDEFGHIJKLM.info/metadata.json";
        $document = $storage->readJsonDocument($path);
        $remoteData = $document->data;
        $remoteData['name'] = 'Changed by Eagle Desktop';
        file_put_contents(
            "{$this->libraryPath}/images/ABCDEFGHIJKLM.info/metadata.json",
            json_encode($remoteData, JSON_THROW_ON_ERROR),
        );

        $this->expectException(EagleWriteConflictException::class);
        $storage->writeJsonSafely($path, $document->data, $document->version);
    }

    public function test_the_integrity_audit_is_read_only_and_accepts_a_valid_library(): void
    {
        $metadataPath = "{$this->libraryPath}/images/ABCDEFGHIJKLM.info/metadata.json";
        $before = hash_file('sha256', $metadataPath);

        $this->artisan('eagle:audit')->assertSuccessful();

        $this->assertSame($before, hash_file('sha256', $metadataPath));
    }

    public function test_media_files_cannot_be_accessed_without_authentication(): void
    {
        $library = EagleLibrary::query()->firstOrFail();
        $this->flushSession();

        $this->get("/media/{$library->slug}/ABCDEFGHIJKLM/original")
            ->assertRedirect('/login');
    }

    public function test_it_streams_media_from_the_storage_backend(): void
    {
        $library = EagleLibrary::query()->firstOrFail();

        $response = $this->get("/media/{$library->slug}/ABCDEFGHIJKLM/original")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');

        $this->assertSame('image-contents', $response->streamedContent());
    }

    public function test_it_generates_a_private_webp_without_changing_the_eagle_source(): void
    {
        $library = EagleLibrary::query()->firstOrFail();
        $sourcePath = "{$this->libraryPath}/images/ABCDEFGHIJKLM.info/portrait.jpg";
        $image = UploadedFile::fake()->image('source.jpg', 1200, 800);
        File::copy($image->getPathname(), $sourcePath);
        $sourceHash = hash_file('sha256', $sourcePath);

        $response = $this->get("/media/{$library->slug}/ABCDEFGHIJKLM/image/640?v=1720000000000")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');

        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('immutable', (string) $response->headers->get('Cache-Control'));
        $derivativePath = $response->baseResponse->getFile()->getPathname();
        $this->assertFileExists($derivativePath);
        $this->assertSame('image/webp', getimagesize($derivativePath)['mime']);
        $this->assertLessThanOrEqual(640, getimagesize($derivativePath)[0]);
        $this->assertSame($sourceHash, hash_file('sha256', $sourcePath));
    }

    public function test_a_large_rendition_falls_back_to_the_eagle_thumbnail_when_the_original_is_unavailable(): void
    {
        $library = EagleLibrary::query()->firstOrFail();
        $asset = $library->assets()->firstOrFail();
        $thumbnailName = 'portrait_thumbnail.png';
        $thumbnailPath = "{$this->libraryPath}/images/ABCDEFGHIJKLM.info/{$thumbnailName}";
        $thumbnail = UploadedFile::fake()->image($thumbnailName, 500, 400);
        File::copy($thumbnail->getPathname(), $thumbnailPath);
        File::delete("{$this->libraryPath}/images/ABCDEFGHIJKLM.info/portrait.jpg");
        $asset->update(['thumbnail_file_name' => $thumbnailName]);

        $response = $this->get("/media/{$library->slug}/ABCDEFGHIJKLM/image/1600?v=1720000000000")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');

        $derivativePath = $response->baseResponse->getFile()->getPathname();
        $this->assertSame('image/webp', getimagesize($derivativePath)['mime']);
        $this->assertSame(500, getimagesize($derivativePath)[0]);
    }

    public function test_a_cached_smaller_rendition_remains_available_when_remote_media_disappears(): void
    {
        $library = EagleLibrary::query()->firstOrFail();
        $sourcePath = "{$this->libraryPath}/images/ABCDEFGHIJKLM.info/portrait.jpg";
        $image = UploadedFile::fake()->image('source.jpg', 1200, 800);
        File::copy($image->getPathname(), $sourcePath);
        $smallerResponse = $this->get("/media/{$library->slug}/ABCDEFGHIJKLM/image/640?v=1720000000000")
            ->assertOk();
        $smallerPath = $smallerResponse->baseResponse->getFile()->getPathname();
        File::delete($sourcePath);

        $largerResponse = $this->get("/media/{$library->slug}/ABCDEFGHIJKLM/image/1600?v=1720000000000")
            ->assertOk();

        $this->assertSame($smallerPath, $largerResponse->baseResponse->getFile()->getPathname());
        $this->assertSame('image/webp', $largerResponse->headers->get('Content-Type'));
    }
}
