<?php

namespace Tests\Unit;

use App\Services\EagleStorage;
use App\Services\OpenCloudDirectoryBrowser;
use App\Services\OpenCloudPathMapper;
use League\Flysystem\DirectoryAttributes;
use League\Flysystem\DirectoryListing;
use League\Flysystem\FilesystemOperator;
use Mockery;
use Tests\TestCase;

class OpenCloudPathMapperTest extends TestCase
{
    public function test_it_maps_absolute_space_paths_to_relative_paths(): void
    {
        $mapper = new OpenCloudPathMapper('https://cloud.example.test/dav/spaces/space-id');

        $this->assertSame(
            'Moods.library',
            $mapper->relative('/dav/spaces/space-id/Moods.library'),
        );
        $this->assertSame(
            'Moods.library',
            $mapper->relative('/dav/spaces/space-id/Collections/Moods.library', '/Collections'),
        );
        $this->assertSame(
            'Moods.library',
            $mapper->relative('paces/space-id/Collections/Moods.library', '/Collections'),
        );
    }

    public function test_the_browser_identifies_libraries_from_absolute_webdav_paths(): void
    {
        $filesystem = Mockery::mock(FilesystemOperator::class);
        $filesystem->shouldReceive('listContents')
            ->once()
            ->with('', false)
            ->andReturn(new DirectoryListing([
                new DirectoryAttributes('/dav/spaces/space-id/Moods.library'),
            ]));
        $filesystem->shouldReceive('listContents')
            ->once()
            ->with('Moods.library', false)
            ->andReturn(new DirectoryListing([
                new DirectoryAttributes('/dav/spaces/space-id/Moods.library/images'),
            ]));
        $filesystem->shouldReceive('fileExists')
            ->once()
            ->with('Moods.library/metadata.json')
            ->andReturnTrue();
        $filesystem->shouldReceive('directoryExists')
            ->once()
            ->with('Moods.library/images')
            ->andReturnTrue();

        $browser = new OpenCloudDirectoryBrowser(
            $filesystem,
            '/',
            new OpenCloudPathMapper('https://cloud.example.test/dav/spaces/space-id'),
        );

        $result = $browser->browse('/');

        $this->assertSame(1, $result['library_count']);
        $this->assertSame('/Moods.library', $result['directories'][0]['path']);
        $this->assertTrue($result['directories'][0]['is_library']);

        $library = $browser->browse($result['directories'][0]['path']);

        $this->assertSame('/Moods.library', $library['path']);
        $this->assertSame('/', $library['parent']);
        $this->assertSame('/Moods.library/images', $library['directories'][0]['path']);
    }

    public function test_eagle_storage_normalizes_absolute_webdav_listings(): void
    {
        $filesystem = Mockery::mock(FilesystemOperator::class);
        $filesystem->shouldReceive('listContents')
            ->once()
            ->with('', false)
            ->andReturn(new DirectoryListing([
                new DirectoryAttributes('/dav/spaces/space-id/Moods.library'),
            ]));

        $storage = new EagleStorage(
            $filesystem,
            pathMapper: new OpenCloudPathMapper('https://cloud.example.test/dav/spaces/space-id'),
        );

        $this->assertSame('Moods.library', $storage->list('')[0]->path());
    }
}
